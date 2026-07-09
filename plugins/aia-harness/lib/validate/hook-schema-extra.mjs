/**
 * Validators for hook event types not currently shipped by any harness hook
 * — the remainder of the SDK's 30-entry HOOK_EVENTS constant, validated
 * anyway so a future hook targeting one starts with a ready, schema-correct
 * validator. Re-exported from hook-schema.mjs, the public entry point —
 * import from there, not this file directly.
 *
 * @module validate/hook-schema-extra
 */

/** @typedef {import("./hook-schema-helpers.mjs").ValidationResult} ValidationResult */

import {
  validateCommonFields,
  validateStandardOutput,
  checkHookSpecificOutput,
  checkStringArrayField,
  checkBooleanField,
  checkObjectField,
  checkEnumField,
  parseStdout,
  parseOutput,
  requireObject,
  makeContextValidator,
} from "./hook-schema-helpers.mjs";

// ---------------------------------------------------------------------------
// Event types with a hookSpecificOutput schema
// ---------------------------------------------------------------------------

/**
 * Validates UserPromptExpansion hook output. Fires when a slash command or
 * prompt template expands, before the expanded prompt is sent.
 * hookSpecificOutput: { hookEventName: "UserPromptExpansion", additionalContext?: string }
 * @type {(stdout: string, exitCode: number) => ValidationResult}
 */
export const validateUserPromptExpansionOutput = makeContextValidator("UserPromptExpansion");

const ELICITATION_ACTIONS = new Set(["accept", "decline", "cancel"]);

/**
 * Shared validator for Elicitation and ElicitationResult — identical schema.
 * hookSpecificOutput: { hookEventName, action?: "accept"|"decline"|"cancel", content?: object }
 * @param {string} stdout @param {number} exitCode @param {string} eventName
 * @returns {ValidationResult}
 */
function validateElicitationLikeOutput(stdout, exitCode, eventName) {
  const r = parseStdout(stdout, exitCode);
  if (!r.ok) return r.result;
  const { obj } = r;
  /** @type {string[]} */
  const errors = [];
  if ("hookSpecificOutput" in obj) {
    const hso = obj.hookSpecificOutput;
    errors.push(...checkHookSpecificOutput(hso, eventName, []));
    if (typeof hso === "object" && !Array.isArray(hso) && hso !== null) {
      errors.push(...checkEnumField(hso, "action", ELICITATION_ACTIONS));
      errors.push(...checkObjectField(hso, "content"));
    }
  }
  errors.push(...validateCommonFields(obj));
  return { valid: errors.length === 0, errors };
}

/**
 * Validates Elicitation hook output. Fires when an MCP server requests user
 * input; hooks can auto-respond (accept/decline) instead of showing the dialog.
 * @param {string} stdout @param {number} exitCode @returns {ValidationResult}
 */
export function validateElicitationOutput(stdout, exitCode) {
  return validateElicitationLikeOutput(stdout, exitCode, "Elicitation");
}

/**
 * Validates ElicitationResult hook output. Fires after the user responds to
 * an MCP elicitation; hooks can override the response before it is sent.
 * @param {string} stdout @param {number} exitCode @returns {ValidationResult}
 */
export function validateElicitationResultOutput(stdout, exitCode) {
  return validateElicitationLikeOutput(stdout, exitCode, "ElicitationResult");
}

/**
 * Validates WorktreeCreate hook output. Command hooks are expected to print
 * the worktree path on plain stdout in most cases; when hookSpecificOutput
 * IS used, worktreePath is REQUIRED (not optional, unlike every other event).
 * hookSpecificOutput: { hookEventName: "WorktreeCreate", worktreePath: string }
 * @param {string} stdout @param {number} exitCode @returns {ValidationResult}
 */
export function validateWorktreeCreateOutput(stdout, exitCode) {
  if (exitCode !== 0 && exitCode !== 2) {
    return { valid: false, errors: [`exit code must be 0 or 2, got ${exitCode}`] };
  }
  if (exitCode === 2) return { valid: true, errors: [] };

  const { parsed, parseError } = parseOutput(stdout);
  if (parseError) {
    // "type":"command" hooks (the only kind this harness ships) print the
    // worktree path as a BARE string on stdout, not JSON — confirmed by the
    // WorktreeCreateHookSpecificOutput doc comment in the installed
    // @anthropic-ai/claude-agent-sdk sdk.d.ts ("Command hooks print the path
    // on stdout instead") and independently by the compiled binary's embedded
    // error string. parseOutput() already treats genuinely empty/whitespace
    // stdout as `parseError: null` above, so reaching this branch means real,
    // non-empty, non-JSON content — that bare path.
    return { valid: true, errors: [] };
  }
  if (parsed === null) return { valid: true, errors: [] };
  const objErr = requireObject(parsed);
  if (objErr) return { valid: false, errors: [objErr] };

  const obj = /** @type {Record<string, any>} */ (parsed);
  /** @type {string[]} */
  const errors = [];
  if ("hookSpecificOutput" in obj) {
    const hso = obj.hookSpecificOutput;
    errors.push(...checkHookSpecificOutput(hso, "WorktreeCreate", []));
    if (typeof hso === "object" && !Array.isArray(hso) && hso !== null) {
      if (typeof hso.worktreePath !== "string") {
        errors.push(
          `hookSpecificOutput.worktreePath is required and must be a string, got ${typeof hso.worktreePath}`,
        );
      }
    }
  }
  errors.push(...validateCommonFields(obj));
  return { valid: errors.length === 0, errors };
}

/**
 * Shared validator for CwdChanged and FileChanged — identical schema.
 * hookSpecificOutput: { hookEventName, watchPaths?: string[] }
 * @param {string} stdout @param {number} exitCode @param {string} eventName
 * @returns {ValidationResult}
 */
function validateWatchPathsOutput(stdout, exitCode, eventName) {
  const r = parseStdout(stdout, exitCode);
  if (!r.ok) return r.result;
  const { obj } = r;
  /** @type {string[]} */
  const errors = [];
  if ("hookSpecificOutput" in obj) {
    const hso = obj.hookSpecificOutput;
    errors.push(...checkHookSpecificOutput(hso, eventName, []));
    if (typeof hso === "object" && !Array.isArray(hso) && hso !== null) {
      errors.push(...checkStringArrayField(hso, "watchPaths"));
    }
  }
  errors.push(...validateCommonFields(obj));
  return { valid: errors.length === 0, errors };
}

/**
 * Validates CwdChanged hook output. Fires when the session's working
 * directory changes (e.g. EnterWorktree/ExitWorktree).
 * @param {string} stdout @param {number} exitCode @returns {ValidationResult}
 */
export function validateCwdChangedOutput(stdout, exitCode) {
  return validateWatchPathsOutput(stdout, exitCode, "CwdChanged");
}

/**
 * Validates FileChanged hook output. Fires when a watched file changes on disk.
 * @param {string} stdout @param {number} exitCode @returns {ValidationResult}
 */
export function validateFileChangedOutput(stdout, exitCode) {
  return validateWatchPathsOutput(stdout, exitCode, "FileChanged");
}

/**
 * Validates MessageDisplay hook output. Fires with each batch of newly
 * completed lines while an assistant message streams; display-only.
 * hookSpecificOutput: { hookEventName: "MessageDisplay", displayContent?: string }
 * @param {string} stdout @param {number} exitCode @returns {ValidationResult}
 */
export function validateMessageDisplayOutput(stdout, exitCode) {
  const r = parseStdout(stdout, exitCode);
  if (!r.ok) return r.result;
  const { obj } = r;
  /** @type {string[]} */
  const errors = [];
  if ("hookSpecificOutput" in obj) {
    errors.push(
      ...checkHookSpecificOutput(obj.hookSpecificOutput, "MessageDisplay", ["displayContent"]),
    );
  }
  errors.push(...validateCommonFields(obj));
  return { valid: errors.length === 0, errors };
}

/**
 * Validates PermissionDenied hook output. Fires after a permission request
 * is denied; a hook may set retry to reprompt instead of failing the tool call.
 * hookSpecificOutput: { hookEventName: "PermissionDenied", retry?: boolean }
 * @param {string} stdout @param {number} exitCode @returns {ValidationResult}
 */
export function validatePermissionDeniedOutput(stdout, exitCode) {
  const r = parseStdout(stdout, exitCode);
  if (!r.ok) return r.result;
  const { obj } = r;
  /** @type {string[]} */
  const errors = [];
  if ("hookSpecificOutput" in obj) {
    const hso = obj.hookSpecificOutput;
    errors.push(...checkHookSpecificOutput(hso, "PermissionDenied", []));
    if (typeof hso === "object" && !Array.isArray(hso) && hso !== null) {
      errors.push(...checkBooleanField(hso, "retry"));
    }
  }
  errors.push(...validateCommonFields(obj));
  return { valid: errors.length === 0, errors };
}

// ---------------------------------------------------------------------------
// Standard-output-only event types (no hookSpecificOutput in the SDK schema)
// ---------------------------------------------------------------------------

/**
 * Validates StopFailure hook output. Fires when the Stop turn itself errors.
 * @param {string} stdout @param {number} exitCode @returns {ValidationResult}
 */
export function validateStopFailureOutput(stdout, exitCode) {
  return validateStandardOutput(stdout, exitCode);
}

/**
 * Validates PostCompact hook output. Fires after context compaction completes.
 * @param {string} stdout @param {number} exitCode @returns {ValidationResult}
 */
export function validatePostCompactOutput(stdout, exitCode) {
  return validateStandardOutput(stdout, exitCode);
}

/**
 * Validates TeammateIdle hook output. Fires when a teammate session becomes idle.
 * @param {string} stdout @param {number} exitCode @returns {ValidationResult}
 */
export function validateTeammateIdleOutput(stdout, exitCode) {
  return validateStandardOutput(stdout, exitCode);
}

/**
 * Validates TaskCreated hook output. Fires when a background task is created.
 * @param {string} stdout @param {number} exitCode @returns {ValidationResult}
 */
export function validateTaskCreatedOutput(stdout, exitCode) {
  return validateStandardOutput(stdout, exitCode);
}

/**
 * Validates TaskCompleted hook output. Fires when a background task completes.
 * @param {string} stdout @param {number} exitCode @returns {ValidationResult}
 */
export function validateTaskCompletedOutput(stdout, exitCode) {
  return validateStandardOutput(stdout, exitCode);
}

/**
 * Validates ConfigChange hook output. Fires when settings/skills config
 * changes on disk (user, project, local, policy, or skills source).
 * @param {string} stdout @param {number} exitCode @returns {ValidationResult}
 */
export function validateConfigChangeOutput(stdout, exitCode) {
  return validateStandardOutput(stdout, exitCode);
}

/**
 * Validates WorktreeRemove hook output. Fires after a worktree is removed.
 * @param {string} stdout @param {number} exitCode @returns {ValidationResult}
 */
export function validateWorktreeRemoveOutput(stdout, exitCode) {
  return validateStandardOutput(stdout, exitCode);
}

/**
 * Validates InstructionsLoaded hook output. Fires when a CLAUDE.md/memory
 * file is loaded (session start, nested traversal, glob match, include, compact).
 * @param {string} stdout @param {number} exitCode @returns {ValidationResult}
 */
export function validateInstructionsLoadedOutput(stdout, exitCode) {
  return validateStandardOutput(stdout, exitCode);
}
