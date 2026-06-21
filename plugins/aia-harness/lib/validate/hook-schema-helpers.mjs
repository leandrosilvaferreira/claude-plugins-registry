/**
 * Internal helpers shared by hook-schema.mjs validators.
 * Not part of the public API — import from hook-schema.mjs instead.
 *
 * @module validate/hook-schema-helpers
 */

/**
 * @typedef {{ valid: boolean, errors: string[] }} ValidationResult
 */

export const PERMISSION_DECISIONS = new Set(["allow", "deny", "ask", "defer"]);
export const STOP_DECISIONS = new Set(["approve", "block"]);

/**
 * Parse non-empty stdout as JSON. Returns null for empty stdout.
 * @param {string} stdout
 * @returns {{ parsed: any, parseError: string | null }}
 */
export function parseOutput(stdout) {
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
export function requireObject(parsed) {
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
export function validateCommonFields(obj) {
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
 * Parse stdout + validate exit code in one call.
 * Returns `{ ok: true, obj }` on success or `{ ok: false, result }` to return early.
 * @param {string} stdout
 * @param {number} exitCode
 * @returns {{ ok: true, obj: Record<string,any> } | { ok: false, result: import("./hook-schema-helpers.mjs").ValidationResult }}
 */
export function parseStdout(stdout, exitCode) {
  if (exitCode !== 0 && exitCode !== 2) {
    return { ok: false, result: { valid: false, errors: [`exit code must be 0 or 2, got ${exitCode}`] } };
  }
  if (exitCode === 2) return { ok: false, result: { valid: true, errors: [] } };
  const { parsed, parseError } = parseOutput(stdout);
  if (parseError) return { ok: false, result: { valid: false, errors: [parseError] } };
  if (parsed === null) return { ok: false, result: { valid: true, errors: [] } };
  const objErr = requireObject(parsed);
  if (objErr) return { ok: false, result: { valid: false, errors: [objErr] } };
  return { ok: true, obj: /** @type {Record<string,any>} */ (parsed) };
}

/**
 * Build a validator for hook events whose only hookSpecificOutput field is
 * an optional `additionalContext` string (PostToolUse, SubagentStart, etc.).
 * @param {string} eventName
 * @returns {(stdout: string, exitCode: number) => import("./hook-schema-helpers.mjs").ValidationResult}
 */
export function makeContextValidator(eventName) {
  return function validateOutput(stdout, exitCode) {
    const r = parseStdout(stdout, exitCode);
    if (!r.ok) return r.result;
    /** @type {string[]} */
    const errors = [];
    if ("hookSpecificOutput" in r.obj) {
      errors.push(...checkHookSpecificOutput(r.obj.hookSpecificOutput, eventName, ["additionalContext"]));
    }
    errors.push(...validateCommonFields(r.obj));
    return { valid: errors.length === 0, errors };
  };
}

/**
 * Validate a `hookSpecificOutput` object for a given hook event.
 * Checks that it is a plain object, that `hookEventName` (if present) matches
 * `eventName`, and that every field named in `stringFields` is a string.
 *
 * Returns an array of error messages (empty = valid). Does NOT require
 * `hookEventName` to be present — only validates it when it IS present.
 *
 * @param {any} hso
 * @param {string} eventName
 * @param {string[]} stringFields
 * @returns {string[]}
 */
export function checkHookSpecificOutput(hso, eventName, stringFields) {
  if (typeof hso !== "object" || Array.isArray(hso) || hso === null) {
    return ["hookSpecificOutput must be an object"];
  }
  /** @type {string[]} */
  const errs = [];
  if ("hookEventName" in hso && hso.hookEventName !== eventName) {
    errs.push(`hookSpecificOutput.hookEventName must be "${eventName}", got "${hso.hookEventName}"`);
  }
  for (const field of stringFields) {
    if (field in hso && typeof hso[field] !== "string") {
      errs.push(`hookSpecificOutput.${field} must be a string, got ${typeof hso[field]}`);
    }
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
export function validateStandardOutput(stdout, exitCode) {
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
