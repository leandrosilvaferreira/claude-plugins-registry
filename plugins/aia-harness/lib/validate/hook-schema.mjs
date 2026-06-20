/**
 * Schema validators for ALL Claude Code hook output types.
 *
 * Every hook distributed to target projects must produce output that passes
 * the appropriate validator for ALL possible code paths. Use in tests.
 *
 * Schemas derived from:
 *   https://github.com/anthropics/claude-code/blob/main/plugins/plugin-dev/skills/hook-development/SKILL.md
 *   https://github.com/zebbern/claude-code-guide/blob/main/README.md
 *
 * Hook types (9 total):
 *   PreToolUse, PostToolUse, Stop, SubagentStop,
 *   UserPromptSubmit, SessionStart, SessionEnd, PreCompact, Notification
 *
 * Exit code semantics (all hooks):
 *   0  = success (stdout shown in transcript)
 *   2  = blocking error (effect varies per hook — see each validator)
 *   1+ = non-blocking error (not a valid output for our hooks)
 *
 * @module validate/hook-schema
 */

/**
 * @typedef {{ valid: boolean, errors: string[] }} ValidationResult
 */

const PERMISSION_DECISIONS = new Set(["allow", "deny", "ask"]);
const STOP_DECISIONS = new Set(["approve", "block"]);

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Parse non-empty stdout as JSON. Returns null for empty stdout.
 * @param {string} stdout
 * @returns {{ parsed: any, parseError: string | null }}
 */
function parseOutput(stdout) {
  const trimmed = stdout.trim();
  if (!trimmed) return { parsed: null, parseError: null };
  try {
    return { parsed: JSON.parse(trimmed), parseError: null };
  } catch (/** @type {any} */ e) {
    return { parsed: null, parseError: `stdout is not valid JSON: ${e.message}` };
  }
}

/**
 * Assert that `parsed` is a plain object (not array, not null).
 * @param {any} parsed
 * @returns {string | null} error message or null
 */
function requireObject(parsed) {
  if (typeof parsed !== "object" || Array.isArray(parsed) || parsed === null) {
    return "stdout JSON must be a plain object";
  }
  return null;
}

/**
 * Validate the common standard output fields present on all hooks.
 * @param {Record<string, any>} obj
 * @returns {string[]} errors
 */
function validateCommonFields(obj) {
  /** @type {string[]} */
  const errs = [];
  if ("continue" in obj && typeof obj.continue !== "boolean") {
    errs.push(`continue must be a boolean, got ${typeof obj.continue}`);
  }
  if ("suppressOutput" in obj && typeof obj.suppressOutput !== "boolean") {
    errs.push(`suppressOutput must be a boolean, got ${typeof obj.suppressOutput}`);
  }
  if ("systemMessage" in obj && typeof obj.systemMessage !== "string") {
    errs.push(`systemMessage must be a string, got ${typeof obj.systemMessage}`);
  }
  return errs;
}

/**
 * Standard-output-only validator: used for hooks whose output is just the
 * common fields with no hookSpecificOutput (SessionStart, SessionEnd,
 * PreCompact, Notification).
 *
 * Exit 0 or 2 are valid.
 * @param {string} stdout
 * @param {number} exitCode
 * @returns {ValidationResult}
 */
function validateStandardOutput(stdout, exitCode) {
  if (exitCode !== 0 && exitCode !== 2) {
    return { valid: false, errors: [`exit code must be 0 or 2, got ${exitCode}`] };
  }
  if (exitCode === 2) return { valid: true, errors: [] };

  const { parsed, parseError } = parseOutput(stdout);
  if (parseError) return { valid: false, errors: [parseError] };
  if (parsed === null) return { valid: true, errors: [] };

  const objErr = requireObject(parsed);
  if (objErr) return { valid: false, errors: [objErr] };

  const errs = validateCommonFields(/** @type {Record<string,any>} */ (parsed));
  return { valid: errs.length === 0, errors: errs };
}

// ---------------------------------------------------------------------------
// Public validators — one per hook type
// ---------------------------------------------------------------------------

/**
 * Validates PreToolUse hook output.
 *
 * Exit 0  → allow / ask / deny via hookSpecificOutput or no output
 * Exit 2  → block tool call (stderr fed back to Claude)
 *
 * JSON (exit 0):
 *   {
 *     hookSpecificOutput?: {
 *       permissionDecision: "allow" | "deny" | "ask",
 *       updatedInput?: object
 *     },
 *     systemMessage?: string,
 *     continue?: boolean,
 *     suppressOutput?: boolean
 *   }
 *
 * @param {string} stdout
 * @param {number} exitCode
 * @returns {ValidationResult}
 */
export function validatePreToolUseOutput(stdout, exitCode) {
  /** @type {string[]} */
  const errors = [];

  if (exitCode !== 0 && exitCode !== 2) {
    return { valid: false, errors: [`exit code must be 0 or 2, got ${exitCode}`] };
  }
  if (exitCode === 2) return { valid: true, errors: [] };

  const { parsed, parseError } = parseOutput(stdout);
  if (parseError) return { valid: false, errors: [parseError] };
  if (parsed === null) return { valid: true, errors: [] };

  const objErr = requireObject(parsed);
  if (objErr) return { valid: false, errors: [objErr] };

  const obj = /** @type {Record<string,any>} */ (parsed);

  if ("hookSpecificOutput" in obj) {
    const hso = obj.hookSpecificOutput;
    if (typeof hso !== "object" || Array.isArray(hso) || hso === null) {
      errors.push("hookSpecificOutput must be an object");
    } else {
      if (!("permissionDecision" in hso)) {
        errors.push("hookSpecificOutput.permissionDecision is required when hookSpecificOutput is present");
      } else if (!PERMISSION_DECISIONS.has(hso.permissionDecision)) {
        errors.push(
          `hookSpecificOutput.permissionDecision must be "allow", "deny", or "ask", got "${hso.permissionDecision}"`,
        );
      }
      if ("updatedInput" in hso) {
        if (typeof hso.updatedInput !== "object" || Array.isArray(hso.updatedInput) || hso.updatedInput === null) {
          errors.push("hookSpecificOutput.updatedInput must be a non-null object");
        }
      }
    }
  }

  errors.push(...validateCommonFields(obj));
  return { valid: errors.length === 0, errors };
}

/**
 * Validates PostToolUse hook output.
 *
 * Exit 0  → success (stdout shown in transcript)
 * Exit 2  → stderr fed back to Claude AFTER the tool result (non-blocking for
 *            the completed tool call, but the error is surfaced to the model)
 *
 * JSON:
 *   { continue?: boolean, suppressOutput?: boolean, systemMessage?: string }
 *
 * @param {string} stdout
 * @param {number} exitCode
 * @returns {ValidationResult}
 */
export function validatePostToolUseOutput(stdout, exitCode) {
  return validateStandardOutput(stdout, exitCode);
}

/**
 * Validates Stop hook output.
 *
 * Exit 0  → approve / message injection
 * Exit 2  → block stop (stderr fed back to Claude; agent self-corrects)
 *
 * JSON (exit 0):
 *   { decision?: "approve" | "block", reason?: string,
 *     systemMessage?: string, continue?: boolean, suppressOutput?: boolean }
 *
 * @param {string} stdout
 * @param {number} exitCode
 * @returns {ValidationResult}
 */
export function validateStopOutput(stdout, exitCode) {
  /** @type {string[]} */
  const errors = [];

  if (exitCode !== 0 && exitCode !== 2) {
    return { valid: false, errors: [`exit code must be 0 or 2, got ${exitCode}`] };
  }
  if (exitCode === 2) return { valid: true, errors: [] };

  const { parsed, parseError } = parseOutput(stdout);
  if (parseError) return { valid: false, errors: [parseError] };
  if (parsed === null) return { valid: true, errors: [] };

  const objErr = requireObject(parsed);
  if (objErr) return { valid: false, errors: [objErr] };

  const obj = /** @type {Record<string,any>} */ (parsed);

  if ("decision" in obj && !STOP_DECISIONS.has(obj.decision)) {
    errors.push(`decision must be "approve" or "block", got "${obj.decision}"`);
  }
  if ("reason" in obj && typeof obj.reason !== "string") {
    errors.push(`reason must be a string, got ${typeof obj.reason}`);
  }
  errors.push(...validateCommonFields(obj));
  return { valid: errors.length === 0, errors };
}

/**
 * Validates SubagentStop hook output.
 *
 * Identical schema to Stop — fires when a subagent completes rather than
 * the top-level agent. Exit 2 feeds stderr to Claude after subagent stops.
 *
 * @param {string} stdout
 * @param {number} exitCode
 * @returns {ValidationResult}
 */
export function validateSubagentStopOutput(stdout, exitCode) {
  return validateStopOutput(stdout, exitCode);
}

/**
 * Validates UserPromptSubmit hook output.
 *
 * Exit 0  → allow (recommended path; blocking via JSON `decision: "block"`)
 * Exit 2  → block + erase prompt (stderr shown to user only, not Claude)
 *
 * JSON (exit 0):
 *   {
 *     decision?: "block",           // only "block" is meaningful; omit to allow
 *     reason?: string,              // shown to user when blocking
 *     hookSpecificOutput?: {
 *       hookEventName?: "UserPromptSubmit",
 *       additionalContext?: string  // injected into Claude's context when allowing
 *     },
 *     systemMessage?: string,
 *     continue?: boolean,
 *     suppressOutput?: boolean
 *   }
 *
 * Note: plain text stdout (non-JSON) is also valid and is added as context.
 *
 * @param {string} stdout
 * @param {number} exitCode
 * @returns {ValidationResult}
 */
export function validateUserPromptSubmitOutput(stdout, exitCode) {
  /** @type {string[]} */
  const errors = [];

  if (exitCode !== 0 && exitCode !== 2) {
    return { valid: false, errors: [`exit code must be 0 or 2, got ${exitCode}`] };
  }
  if (exitCode === 2) return { valid: true, errors: [] };

  // Plain text stdout is valid (added as context to Claude).
  const trimmed = stdout.trim();
  if (!trimmed) return { valid: true, errors: [] };

  // Attempt JSON parse; if it fails, treat as plain-text context (valid).
  let parsed;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    return { valid: true, errors: [] };
  }

  const objErr = requireObject(parsed);
  if (objErr) return { valid: false, errors: [objErr] };

  const obj = /** @type {Record<string,any>} */ (parsed);

  if ("decision" in obj && obj.decision !== "block") {
    errors.push(`UserPromptSubmit decision must be "block" or omitted, got "${obj.decision}"`);
  }
  if ("reason" in obj && typeof obj.reason !== "string") {
    errors.push(`reason must be a string, got ${typeof obj.reason}`);
  }
  if ("hookSpecificOutput" in obj) {
    const hso = obj.hookSpecificOutput;
    if (typeof hso !== "object" || Array.isArray(hso) || hso === null) {
      errors.push("hookSpecificOutput must be an object");
    } else {
      if ("hookEventName" in hso && hso.hookEventName !== "UserPromptSubmit") {
        errors.push(`hookSpecificOutput.hookEventName must be "UserPromptSubmit", got "${hso.hookEventName}"`);
      }
      if ("additionalContext" in hso && typeof hso.additionalContext !== "string") {
        errors.push(`hookSpecificOutput.additionalContext must be a string, got ${typeof hso.additionalContext}`);
      }
    }
  }
  errors.push(...validateCommonFields(obj));
  return { valid: errors.length === 0, errors };
}

/**
 * Validates SessionStart hook output.
 *
 * Exit 0  → success (stdout shown in transcript)
 * Exit 2  → stderr shown to the user only (not Claude)
 *
 * Standard JSON: { continue?: boolean, suppressOutput?: boolean, systemMessage?: string }
 *
 * @param {string} stdout
 * @param {number} exitCode
 * @returns {ValidationResult}
 */
export function validateSessionStartOutput(stdout, exitCode) {
  return validateStandardOutput(stdout, exitCode);
}

/**
 * Validates SessionEnd hook output.
 *
 * Exit 0  → success (stdout shown in transcript)
 * Exit 2  → stderr shown to the user only
 *
 * Standard JSON: { continue?: boolean, suppressOutput?: boolean, systemMessage?: string }
 *
 * @param {string} stdout
 * @param {number} exitCode
 * @returns {ValidationResult}
 */
export function validateSessionEndOutput(stdout, exitCode) {
  return validateStandardOutput(stdout, exitCode);
}

/**
 * Validates PreCompact hook output.
 *
 * Fires before Claude Code compacts the conversation context.
 * Use to inject context that must survive compaction.
 *
 * Exit 0  → success (stdout shown in transcript)
 * Exit 2  → stderr shown to the user only
 *
 * Standard JSON: { continue?: boolean, suppressOutput?: boolean, systemMessage?: string }
 *
 * @param {string} stdout
 * @param {number} exitCode
 * @returns {ValidationResult}
 */
export function validatePreCompactOutput(stdout, exitCode) {
  return validateStandardOutput(stdout, exitCode);
}

/**
 * Validates Notification hook output.
 *
 * Fires when Claude Code sends a notification to the user.
 * Use for logging or reactions.
 *
 * Exit 0  → success (stdout shown in transcript)
 * Exit 2  → stderr shown to the user only
 *
 * Standard JSON: { continue?: boolean, suppressOutput?: boolean, systemMessage?: string }
 *
 * @param {string} stdout
 * @param {number} exitCode
 * @returns {ValidationResult}
 */
export function validateNotificationOutput(stdout, exitCode) {
  return validateStandardOutput(stdout, exitCode);
}
