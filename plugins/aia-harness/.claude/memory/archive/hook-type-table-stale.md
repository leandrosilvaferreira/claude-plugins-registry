---
name: hook-type-table-stale
description: RESOLVED 2026-07-02 — CLAUDE.md and lib/validate/hook-schema.mjs now cover all 30 official hook event types, not 14. Archived; no longer actionable.
metadata:
  type: architecture
---

**Status: resolved.** CLAUDE.md's "Hook output schema compliance" section and
`lib/validate/hook-schema.mjs` now document and validate the full 30-event
`HOOK_EVENTS` set from `@anthropic-ai/claude-agent-sdk` (installed as a
devDependency, types-only usage), cross-checked at compile time by
`lib/validate/hook-schema-sdk-typecheck.mjs`. `README.md` and
`.claude/agents/aia-harness-code-reviewer.md` were updated to match.

Original finding, kept for history: CLAUDE.md and `lib/validate/hook-schema.mjs`
used to claim "all 14 Claude Code hook types are covered" — the platform has
significantly more (`UserPromptExpansion`, `TaskCreated`, `TaskCompleted`,
`ConfigChange`, `FileChanged`, `TeammateIdle`, `PreCompact`/`PostCompact`,
`StopFailure`, `Elicitation`/`ElicitationResult`, `PermissionDenied`,
`WorktreeCreate`/`WorktreeRemove`, `InstructionsLoaded`, `CwdChanged`,
`MessageDisplay`). This surfaced while designing a `UserPromptExpansion`-based
feature. Confirmed against the real `@anthropic-ai/claude-agent-sdk` package's
`sdk.d.ts` (not a paraphrased doc) during the fix — the SDK's own
`HOOK_EVENTS` constant is the ground truth for this repo's validator coverage,
not any external prose description of "the docs."
