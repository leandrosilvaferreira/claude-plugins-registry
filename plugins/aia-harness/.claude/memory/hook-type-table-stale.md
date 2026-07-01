---
name: hook-type-table-stale
description: CLAUDE.md and lib/validate/hook-schema.mjs claim "all 14 Claude Code hook types are covered" — the platform now has significantly more (UserPromptExpansion, TaskCreated, ConfigChange, FileChanged, TeammateIdle, PostCompact, StopFailure, Elicitation/ElicitationResult, PermissionDenied, WorktreeCreate/Remove, InstructionsLoaded, CwdChanged, MessageDisplay, and more)
metadata:
  type: architecture
---

CLAUDE.md's "Hook output schema compliance" section and `lib/validate/hook-schema.mjs`
document exactly 14 hook event types and assert that set is complete. Confirmed against
the raw official docs (`code.claude.com/docs/en/hooks`, fetched directly, not via a
summarizing tool) that the platform's lifecycle now includes many more events: at least
`UserPromptExpansion` (fires when a user-typed slash command expands into a prompt —
distinct from `UserPromptSubmit`, matches on `command_name`, payload has `command_name`/
`command_args`/`command_source`), plus `TaskCreated`, `TaskCompleted`, `ConfigChange`,
`FileChanged`, `TeammateIdle`, `PreCompact`/`PostCompact`, `StopFailure`, `Elicitation`/
`ElicitationResult`, `PermissionDenied`, `WorktreeCreate`/`WorktreeRemove`,
`InstructionsLoaded`, `CwdChanged`, `MessageDisplay`.

**Why this matters:** the "14 types, all covered" claim is no longer accurate as a
description of the platform — it accurately describes what THIS repo's validator
currently handles, not the full space of hook events Claude Code supports. This surfaced
while designing a `UserPromptExpansion`-based feature; that event turned out to be real
(unlike an initial research pass that got some other details wrong), just not one this
repo has a validator for yet.

**How to apply:** don't treat CLAUDE.md's 14-type table as an exhaustive list of "what
Claude Code hooks exist" — it's an exhaustive list of "what this repo's own tooling
validates so far." If a future task wires a hook type outside that table (as
`UserPromptExpansion` would be), it needs a new validator added to
`lib/validate/hook-schema.mjs` and the CLAUDE.md table updated in the same change, per
this project's own "Hook output schema compliance — mandatory" rule — don't assume
existing coverage extends to a new event type without checking first.
