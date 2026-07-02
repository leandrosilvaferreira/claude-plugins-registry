/**
 * Schema validators for ALL Claude Code hook output types — the full 30
 * event types enumerated by the official SDK's HOOK_EVENTS constant
 * (@anthropic-ai/claude-agent-sdk), not just the ~14 this harness currently
 * ships hooks for. Unused-today event types are validated too, so a future
 * hook targeting them starts with a ready, schema-correct validator.
 *
 * Every hook distributed to target projects must produce output that passes
 * the appropriate validator for ALL possible code paths. Use in tests.
 *
 * Schemas cross-checked against @anthropic-ai/claude-agent-sdk's real
 * TypeScript declarations (sdk.d.ts: SyncHookJSONOutput, HookInput,
 * per-event *HookSpecificOutput types) — see hook-schema-sdk-typecheck.mjs
 * for the compile-time tripwires that keep this file honest, and CLAUDE.md's
 * "Hook output schema compliance" section for the full 30-event reference
 * table (event name -> SDK HookInput / HookSpecificOutput type names).
 * Also derived from:
 *   https://code.claude.com/docs/en/hooks
 *   https://code.claude.com/docs/en/agent-sdk/typescript
 *   https://code.claude.com/docs/en/agent-sdk/python
 *
 * Exit code semantics (all hooks):
 *   0  = success / allow (stdout shown in transcript)
 *   2  = blocking error (effect varies per hook — see each validator)
 *
 * This is a barrel module: implementations live in hook-schema-core.mjs
 * (event types this harness currently ships hooks for) and
 * hook-schema-extra.mjs (the remaining event types, validated for future
 * use). Import from here, not the two implementation files, so the public
 * surface stays a single stable path regardless of internal file layout.
 *
 * @module validate/hook-schema
 */

export {
  validatePreToolUseOutput,
  validatePostToolUseOutput,
  validatePostToolUseFailureOutput,
  validateStopOutput,
  validateSubagentStopOutput,
  validateUserPromptSubmitOutput,
  validatePermissionRequestOutput,
  validateSubagentStartOutput,
  validateSetupOutput,
  validatePostToolBatchOutput,
  validateSessionStartOutput,
  validateNotificationOutput,
  validateSessionEndOutput,
  validatePreCompactOutput,
} from "./hook-schema-core.mjs";

export {
  validateUserPromptExpansionOutput,
  validateElicitationOutput,
  validateElicitationResultOutput,
  validateWorktreeCreateOutput,
  validateCwdChangedOutput,
  validateFileChangedOutput,
  validateMessageDisplayOutput,
  validatePermissionDeniedOutput,
  validateStopFailureOutput,
  validatePostCompactOutput,
  validateTeammateIdleOutput,
  validateTaskCreatedOutput,
  validateTaskCompletedOutput,
  validateConfigChangeOutput,
  validateWorktreeRemoveOutput,
  validateInstructionsLoadedOutput,
} from "./hook-schema-extra.mjs";
