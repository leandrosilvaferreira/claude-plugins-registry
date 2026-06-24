/**
 * Schema validators for ALL Claude Code hook output types (14 event types).
 *
 * Every hook distributed to target projects must produce output that passes
 * the appropriate validator for ALL possible code paths. Use in tests.
 *
 * Schemas derived from:
 *   https://code.claude.com/docs/en/hooks
 *   https://code.claude.com/docs/en/agent-sdk/typescript
 *   https://code.claude.com/docs/en/agent-sdk/python
 *
 * Exit code semantics (all hooks):
 *   0  = success / allow (stdout shown in transcript)
 *   2  = blocking error (effect varies per hook — see each validator)
 *
 * @module validate/hook-schema
 */

/** @typedef {import("./hook-schema-helpers.mjs").ValidationResult} ValidationResult */

import {
  PERMISSION_DECISIONS,
  STOP_DECISIONS,
  requireObject,
  validateCommonFields,
  validateStandardOutput,
  checkHookSpecificOutput,
  parseStdout,
  makeContextValidator,
} from "./hook-schema-helpers.mjs";

// ---------------------------------------------------------------------------
// Complex validators (event-specific logic beyond standard fields)
// ---------------------------------------------------------------------------

/**
 * Validates PreToolUse hook output.
 * Exit 0 → allow/ask/deny/defer via hookSpecificOutput; exit 2 → block tool.
 *
 * hookSpecificOutput: { hookEventName: "PreToolUse",
 *   permissionDecision: "allow"|"deny"|"ask"|"defer",
 *   permissionDecisionReason?: string, updatedInput?: object,
 *   additionalContext?: string }
 *
 * @param {string} stdout @param {number} exitCode @returns {ValidationResult}
 */
export function validatePreToolUseOutput(stdout, exitCode) {
  const r = parseStdout(stdout, exitCode);
  if (!r.ok) return r.result;
  const { obj } = r;
  /** @type {string[]} */
  const errors = [];

  if ("hookSpecificOutput" in obj) {
    const hso = obj.hookSpecificOutput;
    errors.push(
      ...checkHookSpecificOutput(hso, "PreToolUse", [
        "permissionDecisionReason",
        "additionalContext",
      ]),
    );
    if (typeof hso === "object" && !Array.isArray(hso) && hso !== null) {
      if (!("permissionDecision" in hso)) {
        errors.push(
          "hookSpecificOutput.permissionDecision is required when hookSpecificOutput is present",
        );
      } else if (!PERMISSION_DECISIONS.has(hso.permissionDecision)) {
        errors.push(
          `hookSpecificOutput.permissionDecision must be "allow", "deny", "ask", or "defer", got "${hso.permissionDecision}"`,
        );
      }
      if ("updatedInput" in hso) {
        if (
          typeof hso.updatedInput !== "object" ||
          Array.isArray(hso.updatedInput) ||
          hso.updatedInput === null
        ) {
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
 * Exit 0 → success; exit 2 → stderr fed to Claude after tool ran.
 *
 * hookSpecificOutput: { hookEventName: "PostToolUse",
 *   additionalContext?: string, updatedToolOutput?: any }
 *
 * @param {string} stdout @param {number} exitCode @returns {ValidationResult}
 */
export const validatePostToolUseOutput = makeContextValidator("PostToolUse");

/**
 * Validates PostToolUseFailure hook output.
 * Fires when a tool execution fails. Exit 2 → stderr to Claude.
 *
 * hookSpecificOutput: { hookEventName: "PostToolUseFailure", additionalContext?: string }
 *
 * @type {(stdout: string, exitCode: number) => ValidationResult}
 */
export const validatePostToolUseFailureOutput = makeContextValidator("PostToolUseFailure");

/**
 * Validates Stop hook output.
 * Exit 0 → approve/message injection; exit 2 → block stop, stderr to Claude.
 *
 * { decision?: "approve"|"block", reason?: string, systemMessage?: string, ... }
 *
 * @param {string} stdout @param {number} exitCode @returns {ValidationResult}
 */
export function validateStopOutput(stdout, exitCode) {
  const r = parseStdout(stdout, exitCode);
  if (!r.ok) return r.result;
  const { obj } = r;
  /** @type {string[]} */
  const errors = [];
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
 * Validates SubagentStop hook output. Identical schema to Stop.
 * @param {string} stdout @param {number} exitCode @returns {ValidationResult}
 */
export function validateSubagentStopOutput(stdout, exitCode) {
  return validateStopOutput(stdout, exitCode);
}

/**
 * Validates UserPromptSubmit hook output.
 * Exit 0 → allow (plain text or JSON); exit 2 → block + erase prompt.
 * Plain text stdout is valid and added as context to Claude.
 *
 * { decision?: "block", reason?: string,
 *   hookSpecificOutput?: { hookEventName: "UserPromptSubmit",
 *     additionalContext?: string, sessionTitle?: string }, ... }
 *
 * @param {string} stdout @param {number} exitCode @returns {ValidationResult}
 */
export function validateUserPromptSubmitOutput(stdout, exitCode) {
  if (exitCode !== 0 && exitCode !== 2) {
    return { valid: false, errors: [`exit code must be 0 or 2, got ${exitCode}`] };
  }
  if (exitCode === 2) return { valid: true, errors: [] };

  const trimmed = stdout.trim();
  if (!trimmed) return { valid: true, errors: [] };

  let parsed;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    return { valid: true, errors: [] };
  }

  const objErr = requireObject(parsed);
  if (objErr) return { valid: false, errors: [objErr] };

  const obj = /** @type {Record<string,any>} */ (parsed);
  /** @type {string[]} */
  const errors = [];

  if ("decision" in obj && obj.decision !== "block") {
    errors.push(`UserPromptSubmit decision must be "block" or omitted, got "${obj.decision}"`);
  }
  if ("reason" in obj && typeof obj.reason !== "string") {
    errors.push(`reason must be a string, got ${typeof obj.reason}`);
  }
  if ("hookSpecificOutput" in obj) {
    errors.push(
      ...checkHookSpecificOutput(obj.hookSpecificOutput, "UserPromptSubmit", [
        "additionalContext",
        "sessionTitle",
      ]),
    );
  }
  errors.push(...validateCommonFields(obj));
  return { valid: errors.length === 0, errors };
}

/**
 * Validates PermissionRequest hook output.
 * Fires when the agent needs a permission decision. Exit 2 → deny + stderr.
 *
 * hookSpecificOutput: { hookEventName: "PermissionRequest",
 *   decision: { behavior: "allow", updatedInput?, updatedPermissions? }
 *            | { behavior: "deny", message?, interrupt? } }
 *
 * @param {string} stdout @param {number} exitCode @returns {ValidationResult}
 */
export function validatePermissionRequestOutput(stdout, exitCode) {
  const r = parseStdout(stdout, exitCode);
  if (!r.ok) return r.result;
  const { obj } = r;
  /** @type {string[]} */
  const errors = [];

  if ("hookSpecificOutput" in obj) {
    const hso = obj.hookSpecificOutput;
    const baseErrs = checkHookSpecificOutput(hso, "PermissionRequest", []);
    errors.push(...baseErrs);
    if (baseErrs.length === 0 && typeof hso === "object" && !Array.isArray(hso) && hso !== null) {
      if (!("decision" in hso)) {
        errors.push("hookSpecificOutput.decision is required for PermissionRequest");
      } else if (
        typeof hso.decision !== "object" ||
        Array.isArray(hso.decision) ||
        hso.decision === null
      ) {
        errors.push("hookSpecificOutput.decision must be a non-null object");
      }
    }
  }

  errors.push(...validateCommonFields(obj));
  return { valid: errors.length === 0, errors };
}

// ---------------------------------------------------------------------------
// Standard + additionalContext validators (factory-generated)
// ---------------------------------------------------------------------------

/**
 * Validates SubagentStart hook output.
 * Fires when a subagent begins execution.
 * hookSpecificOutput: { hookEventName: "SubagentStart", additionalContext?: string }
 * @type {(stdout: string, exitCode: number) => ValidationResult}
 */
export const validateSubagentStartOutput = makeContextValidator("SubagentStart");

/**
 * Validates Setup hook output (TypeScript SDK).
 * hookSpecificOutput: { hookEventName: "Setup", additionalContext?: string }
 * @type {(stdout: string, exitCode: number) => ValidationResult}
 */
export const validateSetupOutput = makeContextValidator("Setup");

/**
 * Validates PostToolBatch hook output (TypeScript SDK).
 * hookSpecificOutput: { hookEventName: "PostToolBatch", additionalContext?: string }
 * @type {(stdout: string, exitCode: number) => ValidationResult}
 */
export const validatePostToolBatchOutput = makeContextValidator("PostToolBatch");

/**
 * Validates SessionStart hook output.
 * hookSpecificOutput: { hookEventName: "SessionStart", additionalContext?: string }
 * @type {(stdout: string, exitCode: number) => ValidationResult}
 */
export const validateSessionStartOutput = makeContextValidator("SessionStart");

/**
 * Validates Notification hook output.
 * hookSpecificOutput: { hookEventName: "Notification", additionalContext?: string }
 * @type {(stdout: string, exitCode: number) => ValidationResult}
 */
export const validateNotificationOutput = makeContextValidator("Notification");

// ---------------------------------------------------------------------------
// Standard-output-only validators (no hookSpecificOutput in schema)
// ---------------------------------------------------------------------------

/**
 * Validates SessionEnd hook output.
 * Standard JSON: { continue?, suppressOutput?, systemMessage? }
 * @param {string} stdout @param {number} exitCode @returns {ValidationResult}
 */
export function validateSessionEndOutput(stdout, exitCode) {
  return validateStandardOutput(stdout, exitCode);
}

/**
 * Validates PreCompact hook output. Fires before context compaction.
 * Standard JSON: { continue?, suppressOutput?, systemMessage? }
 * @param {string} stdout @param {number} exitCode @returns {ValidationResult}
 */
export function validatePreCompactOutput(stdout, exitCode) {
  return validateStandardOutput(stdout, exitCode);
}
