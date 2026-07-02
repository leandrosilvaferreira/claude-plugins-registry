/**
 * Compile-time-only tripwires: assert that the hand-rolled runtime
 * validators in hook-schema.mjs / hook-schema-helpers.mjs stay structurally
 * aligned with the official @anthropic-ai/claude-agent-sdk type
 * declarations. Every binding below is a fully-populated literal typed
 * against the SDK's real exported type — if Anthropic renames, removes, or
 * narrows a field one of our validators checks, `npm run typecheck` fails
 * on that line instead of the drift going unnoticed at runtime.
 *
 * Nothing here is imported by runtime code or tests — tsconfig's
 * `include: ["**\/*.mjs"]` typechecks this file automatically. Re-review
 * when bumping the @anthropic-ai/claude-agent-sdk devDependency version.
 *
 * @module validate/hook-schema-sdk-typecheck
 */

/** @typedef {import("@anthropic-ai/claude-agent-sdk").SyncHookJSONOutput} SyncHookJSONOutput */
/** @typedef {import("@anthropic-ai/claude-agent-sdk").HookPermissionDecision} HookPermissionDecision */
/** @typedef {NonNullable<SyncHookJSONOutput["hookSpecificOutput"]>} HookSpecificOutput */

// ---------------------------------------------------------------------------
// Enums — one literal per value our validators accept (PERMISSION_DECISIONS,
// STOP_DECISIONS in hook-schema-helpers.mjs).
// ---------------------------------------------------------------------------

/** @type {HookPermissionDecision[]} */
export const PRE_TOOL_USE_PERMISSION_DECISIONS = ["allow", "deny", "ask", "defer"];

/** @type {NonNullable<SyncHookJSONOutput["decision"]>[]} */
export const STOP_DECISIONS_SDK = ["approve", "block"];

// ---------------------------------------------------------------------------
// Common envelope — every top-level field validateCommonFields() knows about.
// ---------------------------------------------------------------------------

/** @type {SyncHookJSONOutput} */
export const COMMON_ENVELOPE_SHAPE = {
  continue: true,
  suppressOutput: false,
  stopReason: "",
  decision: "approve",
  systemMessage: "",
  terminalSequence: "",
  reason: "",
};

// ---------------------------------------------------------------------------
// hookSpecificOutput — one fully-populated literal per event validated in
// hook-schema.mjs, typed against the exact discriminated-union arm.
// ---------------------------------------------------------------------------

/** @type {Extract<HookSpecificOutput, { hookEventName: "PreToolUse" }>} */
export const PRE_TOOL_USE_SHAPE = {
  hookEventName: "PreToolUse",
  permissionDecision: "defer",
  permissionDecisionReason: "",
  updatedInput: {},
  additionalContext: "",
};

/** @type {Extract<HookSpecificOutput, { hookEventName: "PostToolUse" }>} */
export const POST_TOOL_USE_SHAPE = {
  hookEventName: "PostToolUse",
  additionalContext: "",
  updatedToolOutput: null,
  updatedMCPToolOutput: null,
};

/** @type {Extract<HookSpecificOutput, { hookEventName: "PostToolUseFailure" }>} */
export const POST_TOOL_USE_FAILURE_SHAPE = {
  hookEventName: "PostToolUseFailure",
  additionalContext: "",
};

/** @type {Extract<HookSpecificOutput, { hookEventName: "PostToolBatch" }>} */
export const POST_TOOL_BATCH_SHAPE = {
  hookEventName: "PostToolBatch",
  additionalContext: "",
};

/** @type {Extract<HookSpecificOutput, { hookEventName: "Stop" }>} */
export const STOP_SHAPE = {
  hookEventName: "Stop",
  additionalContext: "",
};

/** @type {Extract<HookSpecificOutput, { hookEventName: "SubagentStop" }>} */
export const SUBAGENT_STOP_SHAPE = {
  hookEventName: "SubagentStop",
  additionalContext: "",
};

/** @type {Extract<HookSpecificOutput, { hookEventName: "SubagentStart" }>} */
export const SUBAGENT_START_SHAPE = {
  hookEventName: "SubagentStart",
  additionalContext: "",
};

/** @type {Extract<HookSpecificOutput, { hookEventName: "SessionStart" }>} */
export const SESSION_START_SHAPE = {
  hookEventName: "SessionStart",
  additionalContext: "",
  initialUserMessage: "",
  sessionTitle: "",
  watchPaths: [],
  reloadSkills: true,
};

/** @type {Extract<HookSpecificOutput, { hookEventName: "UserPromptSubmit" }>} */
export const USER_PROMPT_SUBMIT_SHAPE = {
  hookEventName: "UserPromptSubmit",
  additionalContext: "",
  sessionTitle: "",
  suppressOriginalPrompt: true,
};

/** @type {Extract<HookSpecificOutput, { hookEventName: "Notification" }>} */
export const NOTIFICATION_SHAPE = {
  hookEventName: "Notification",
  additionalContext: "",
};

/** @type {Extract<HookSpecificOutput, { hookEventName: "Setup" }>} */
export const SETUP_SHAPE = {
  hookEventName: "Setup",
  additionalContext: "",
};

/** @type {Extract<HookSpecificOutput, { hookEventName: "PermissionRequest" }>} */
export const PERMISSION_REQUEST_ALLOW_SHAPE = {
  hookEventName: "PermissionRequest",
  decision: { behavior: "allow", updatedInput: {}, updatedPermissions: [] },
};

/** @type {Extract<HookSpecificOutput, { hookEventName: "PermissionRequest" }>} */
export const PERMISSION_REQUEST_DENY_SHAPE = {
  hookEventName: "PermissionRequest",
  decision: { behavior: "deny", message: "", interrupt: true },
};

/** @type {Extract<HookSpecificOutput, { hookEventName: "UserPromptExpansion" }>} */
export const USER_PROMPT_EXPANSION_SHAPE = {
  hookEventName: "UserPromptExpansion",
  additionalContext: "",
};

/** @type {Extract<HookSpecificOutput, { hookEventName: "Elicitation" }>} */
export const ELICITATION_SHAPE = {
  hookEventName: "Elicitation",
  action: "accept",
  content: {},
};

/** @type {Extract<HookSpecificOutput, { hookEventName: "ElicitationResult" }>} */
export const ELICITATION_RESULT_SHAPE = {
  hookEventName: "ElicitationResult",
  action: "decline",
  content: {},
};

/** @type {Extract<HookSpecificOutput, { hookEventName: "WorktreeCreate" }>} */
export const WORKTREE_CREATE_SHAPE = {
  hookEventName: "WorktreeCreate",
  worktreePath: "",
};

/** @type {Extract<HookSpecificOutput, { hookEventName: "CwdChanged" }>} */
export const CWD_CHANGED_SHAPE = {
  hookEventName: "CwdChanged",
  watchPaths: [],
};

/** @type {Extract<HookSpecificOutput, { hookEventName: "FileChanged" }>} */
export const FILE_CHANGED_SHAPE = {
  hookEventName: "FileChanged",
  watchPaths: [],
};

/** @type {Extract<HookSpecificOutput, { hookEventName: "MessageDisplay" }>} */
export const MESSAGE_DISPLAY_SHAPE = {
  hookEventName: "MessageDisplay",
  displayContent: "",
};

/** @type {Extract<HookSpecificOutput, { hookEventName: "PermissionDenied" }>} */
export const PERMISSION_DENIED_SHAPE = {
  hookEventName: "PermissionDenied",
  retry: true,
};
