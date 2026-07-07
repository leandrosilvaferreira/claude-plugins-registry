---
paths:
  - "hooks/**"
  - ".claude/hooks/**"
  - "templates/hooks/**"
  - "lib/validate/**"
  - "tests/hook-*"
---

# Hook output schema — full 30-event reference

Every hook under `templates/hooks/` distributed to target projects must have unit tests covering **all possible output paths**, and every output must pass the validator from `lib/validate/hook-schema.mjs` matching the hook's event type. `hook-schema.mjs` validates the **full 30-event `HOOK_EVENTS` set** from `@anthropic-ai/claude-agent-sdk` — not just the subset this harness currently ships hooks for — so a future hook targeting an unused event type starts with a ready, schema-correct validator. Shapes are cross-checked at compile time against the SDK's real TypeScript declarations by `lib/validate/hook-schema-sdk-typecheck.mjs` (`npm run typecheck` fails if the SDK's declared shape drifts from what a validator checks). Order below matches the SDK's own `HOOK_EVENTS` array:

| Hook event | Validator | Exit codes | `hookSpecificOutput` fields |
| --- | --- | --- | --- |
| `PreToolUse` | `validatePreToolUseOutput` | 0 (allow/ask), 2 (block tool) | `hookEventName:"PreToolUse"`, `permissionDecision?` (`"allow"\|"deny"\|"ask"\|"defer"`), `permissionDecisionReason?`, `updatedInput?`, `additionalContext?` — `permissionDecision` is optional: a hook may emit `additionalContext` alone to inject context without a decision (hookSpecificOutput must carry at least one of the three) |
| `PostToolUse` | `validatePostToolUseOutput` | 0 (success), 2 (stderr to Claude) | `hookEventName:"PostToolUse"`, `additionalContext?`, `updatedToolOutput?`, `updatedMCPToolOutput?` |
| `PostToolUseFailure` | `validatePostToolUseFailureOutput` | 0 (success), 2 (stderr to Claude) | `hookEventName:"PostToolUseFailure"`, `additionalContext?` |
| `PostToolBatch` *(TS SDK)* | `validatePostToolBatchOutput` | 0 (success), 2 (stderr to Claude) | `hookEventName:"PostToolBatch"`, `additionalContext?` |
| `Notification` | `validateNotificationOutput` | 0 (success), 2 (stderr to user) | `hookEventName:"Notification"`, `additionalContext?` |
| `UserPromptSubmit` | `validateUserPromptSubmitOutput` | 0 (allow), 2 (block+erase) | `hookEventName:"UserPromptSubmit"`, `additionalContext?`, `sessionTitle?`, `suppressOriginalPrompt?` — also top-level `decision:"block"` |
| `UserPromptExpansion` | `validateUserPromptExpansionOutput` | 0 (success), 2 (blocking error) | `hookEventName:"UserPromptExpansion"`, `additionalContext?` |
| `SessionStart` | `validateSessionStartOutput` | 0 (success), 2 (stderr to user) | `hookEventName:"SessionStart"`, `additionalContext?`, `initialUserMessage?`, `sessionTitle?`, `watchPaths?` (string[]), `reloadSkills?` (boolean) |
| `SessionEnd` | `validateSessionEndOutput` | 0 (success), 2 (stderr to user) | none (standard only) |
| `Stop` | `validateStopOutput` | 0 (approve), 2 (block stop) | top-level `decision` (`"approve"\|"block"`), `reason?`; optionally `hookEventName:"Stop"`, `additionalContext?` |
| `StopFailure` | `validateStopFailureOutput` | 0 (success), 2 (blocking error) | none (standard only) |
| `SubagentStart` | `validateSubagentStartOutput` | 0 (success), 2 (stderr to Claude) | `hookEventName:"SubagentStart"`, `additionalContext?` |
| `SubagentStop` | `validateSubagentStopOutput` | 0 (approve), 2 (block) | same as Stop; `hookSpecificOutput.hookEventName` discriminant (if present) is `"SubagentStop"` |
| `PreCompact` | `validatePreCompactOutput` | 0 (success), 2 (stderr to user) | none (standard only) |
| `PostCompact` | `validatePostCompactOutput` | 0 (success), 2 (blocking error) | none (standard only) |
| `PermissionRequest` | `validatePermissionRequestOutput` | 0 (allow), 2 (deny) | `hookEventName:"PermissionRequest"`, `decision` (required object: `{behavior:"allow",updatedInput?,updatedPermissions?}` \| `{behavior:"deny",message?,interrupt?}`) |
| `PermissionDenied` | `validatePermissionDeniedOutput` | 0 (success), 2 (blocking error) | `hookEventName:"PermissionDenied"`, `retry?` (boolean) |
| `Setup` *(TS SDK)* | `validateSetupOutput` | 0 (success), 2 (stderr to user) | `hookEventName:"Setup"`, `additionalContext?` |
| `TeammateIdle` | `validateTeammateIdleOutput` | 0 (success), 2 (blocking error) | none (standard only) |
| `TaskCreated` | `validateTaskCreatedOutput` | 0 (success), 2 (blocking error) | none (standard only) |
| `TaskCompleted` | `validateTaskCompletedOutput` | 0 (success), 2 (blocking error) | none (standard only) |
| `Elicitation` | `validateElicitationOutput` | 0 (success), 2 (blocking error) | `hookEventName:"Elicitation"`, `action?` (`"accept"\|"decline"\|"cancel"`), `content?` (object) |
| `ElicitationResult` | `validateElicitationResultOutput` | 0 (success), 2 (blocking error) | same shape as `Elicitation` |
| `ConfigChange` | `validateConfigChangeOutput` | 0 (success), 2 (blocking error) | none (standard only) |
| `WorktreeCreate` | `validateWorktreeCreateOutput` | 0 (success), 2 (blocking error) | `hookEventName:"WorktreeCreate"`, `worktreePath` (**required** string — the only event where a hookSpecificOutput field isn't optional) |
| `WorktreeRemove` | `validateWorktreeRemoveOutput` | 0 (success), 2 (blocking error) | none (standard only) |
| `InstructionsLoaded` | `validateInstructionsLoadedOutput` | 0 (success), 2 (blocking error) | none (standard only) |
| `CwdChanged` | `validateCwdChangedOutput` | 0 (success), 2 (blocking error) | `hookEventName:"CwdChanged"`, `watchPaths?` (string[]) |
| `FileChanged` | `validateFileChangedOutput` | 0 (success), 2 (blocking error) | `hookEventName:"FileChanged"`, `watchPaths?` (string[]) |
| `MessageDisplay` | `validateMessageDisplayOutput` | 0 (success), 2 (blocking error) | `hookEventName:"MessageDisplay"`, `displayContent?` (string) |

Standard JSON fields (all hooks): `{ continue?: boolean, suppressOutput?: boolean, stopReason?: string, systemMessage?: string, terminalSequence?: string, reason?: string }`. Exit codes 0 and 2 are always valid; any other exit code is a bug. `hookSpecificOutput.hookEventName` is the discriminator — include it whenever emitting `hookSpecificOutput` so the runtime routes it correctly. Rows marked "blocking error" (the 16 event types not yet used by any shipped hook) don't have an independently confirmed stderr-routing target in this codebase — only that exit 0/2 are the valid codes; update the wording once a real hook exercises one.

Every hook test also asserts the raw captured stdout is byte-clean via `assertCleanStdoutJson` (`tests/hook-runner.mjs`): no leading/trailing whitespace around the JSON, and — when non-empty — an exact `JSON.stringify(JSON.parse(stdout))` round-trip. `JSON.parse` alone tolerates surrounding whitespace, so this catches stray blank lines, debug prints, or pretty-printing that would otherwise slip past schema validation unnoticed.

**Full 30-event → SDK type reference** (all exported from `@anthropic-ai/claude-agent-sdk`'s `sdk.d.ts`; the output envelope itself is `SyncHookJSONOutput`, `hookSpecificOutput?` is a discriminated union of the per-event `*HookSpecificOutput` types below):

| Event | SDK `HookInput` type | SDK `HookSpecificOutput` type |
| --- | --- | --- |
| `PreToolUse` | `PreToolUseHookInput` | `PreToolUseHookSpecificOutput` |
| `PostToolUse` | `PostToolUseHookInput` | `PostToolUseHookSpecificOutput` |
| `PostToolUseFailure` | `PostToolUseFailureHookInput` | `PostToolUseFailureHookSpecificOutput` |
| `PostToolBatch` | `PostToolBatchHookInput` | `PostToolBatchHookSpecificOutput` |
| `Notification` | `NotificationHookInput` | `NotificationHookSpecificOutput` |
| `UserPromptSubmit` | `UserPromptSubmitHookInput` | `UserPromptSubmitHookSpecificOutput` |
| `UserPromptExpansion` | `UserPromptExpansionHookInput` | `UserPromptExpansionHookSpecificOutput` |
| `SessionStart` | `SessionStartHookInput` | `SessionStartHookSpecificOutput` |
| `SessionEnd` | `SessionEndHookInput` | — (standard only) |
| `Stop` | `StopHookInput` | `StopHookSpecificOutput` |
| `StopFailure` | `StopFailureHookInput` | — (standard only) |
| `SubagentStart` | `SubagentStartHookInput` | `SubagentStartHookSpecificOutput` |
| `SubagentStop` | `SubagentStopHookInput` | `SubagentStopHookSpecificOutput` |
| `PreCompact` | `PreCompactHookInput` | — (standard only) |
| `PostCompact` | `PostCompactHookInput` | — (standard only) |
| `PermissionRequest` | `PermissionRequestHookInput` | `PermissionRequestHookSpecificOutput` |
| `PermissionDenied` | `PermissionDeniedHookInput` | `PermissionDeniedHookSpecificOutput` |
| `Setup` | `SetupHookInput` | `SetupHookSpecificOutput` |
| `TeammateIdle` | `TeammateIdleHookInput` | — (standard only) |
| `TaskCreated` | `TaskCreatedHookInput` | — (standard only) |
| `TaskCompleted` | `TaskCompletedHookInput` | — (standard only) |
| `Elicitation` | `ElicitationHookInput` | `ElicitationHookSpecificOutput` |
| `ElicitationResult` | `ElicitationResultHookInput` | `ElicitationResultHookSpecificOutput` |
| `ConfigChange` | `ConfigChangeHookInput` | — (standard only) |
| `WorktreeCreate` | `WorktreeCreateHookInput` | `WorktreeCreateHookSpecificOutput` |
| `WorktreeRemove` | `WorktreeRemoveHookInput` | — (standard only) |
| `InstructionsLoaded` | `InstructionsLoadedHookInput` | — (standard only) |
| `CwdChanged` | `CwdChangedHookInput` | `CwdChangedHookSpecificOutput` |
| `FileChanged` | `FileChangedHookInput` | `FileChangedHookSpecificOutput` |
| `MessageDisplay` | `MessageDisplayHookInput` | `MessageDisplayHookSpecificOutput` |

When you **create or modify** a hook under `templates/hooks/`, you **must** add or update its compliance test in `tests/hook-<name>.test.mjs`, import the matching validator, assert every branch via that validator AND `assertCleanStdoutJson`, and run `npm test` to verify before committing. When bumping the `@anthropic-ai/claude-agent-sdk` devDependency version, re-review `lib/validate/hook-schema-sdk-typecheck.mjs` — a `tsc` failure there means the SDK changed a shape one of the validators relies on.
