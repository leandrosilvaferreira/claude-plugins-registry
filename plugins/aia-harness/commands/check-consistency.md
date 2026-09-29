---
description: Audit an existing harness end to end — every cross-reference between skills, agents, rules, commands, scripts and CLAUDE.md files, plus whether each artifact still fits the project's real stack — then fix what you approve.
argument-hint: "[path]"
allowed-tools:
  - Bash
  - AskUserQuestion
  - Skill
  - Agent
  - TodoWrite
  - Read
  - Edit
---

# Check consistency of an existing harness

Target directory: `$1` if provided, else `$CLAUDE_PROJECT_DIR`.

<!-- aia-harness:target-dir-resolution -->
Resolve this **once**, at the
start of this command, into a concrete literal absolute path. `$CLAUDE_PROJECT_DIR` is documented
as available "when hooks are executed" but is not guaranteed inside the general-purpose Bash tool
used to run these instructions — it can silently expand empty there, and the CLI then falls back
to the shell's *current* working directory, which is wrong if the agent has since `cd`'d elsewhere
(e.g. into the scratchpad for intermediate file work). Reuse that one resolved literal path in
every subsequent invocation below, never re-expand a bare `$CLAUDE_PROJECT_DIR` in a later,
separately-issued Bash call, since each Bash tool call is a fresh shell (only cwd persists, not
exported variables) and an earlier `cd` silently redirects any later bare-env-var fallback to the
wrong place.

<!-- aia-harness:version-check -->
## Before anything else — plugin version check

```bash
node "${CLAUDE_PLUGIN_ROOT}/bin/harness.mjs" version-check --json
```

Read `status` from the JSON:

- `"stale"` — report `running` → `latest`, then `AskUserQuestion`: **Update now** (run the
  returned `updateCommand`, then stop and tell the user to run `/reload-plugins` or start a new
  session and re-issue this command — a running plugin copy cannot hot-swap itself) or
  **Continue on the current version** (go straight to the next step).
- `"current"` or `"unknown"` — say nothing, continue.

This check never blocks: it exits 0 even when it cannot reach the registry, and `"unknown"`
means the answer is unavailable, not that something is wrong.
<!-- /aia-harness:version-check -->

Invoke the `check-consistency-workflow` skill with that resolved path: use the `Skill` tool
with `skill: "aia-harness:check-consistency-workflow"` and `args: <resolved path>`.

Do **not** re-implement the audit here — the skill owns the full Phase 1-7 workflow
(deterministic inventory, parallel auditor wave, consolidation, approval, fix waves,
re-verification, report). This command exists to guarantee the target-dir-resolution
boilerplate above runs identically to `/aia-harness:doctor` and `/aia-harness:patch`
before handing off, and to offer the prompt audit once the skill has reported.

## Last step — offer the prompt audit

<!-- aia-harness:offer-audit-prompts -->
When the report above is done, offer the sibling command `/aia-harness:audit-prompts` once. Skip this step unless the command produced its report.

Ask with one `AskUserQuestion` (header `Prompt audit`):

> Run `/aia-harness:audit-prompts` now? It reviews this project's CLAUDE.md files, rules, skills, agents and commands for prompt text written for older Claude models — shouting emphasis, step-by-step scripts, stale examples, instructions that contradict each other — and proposes a diff fitted to the models the project pins. Nothing is written until you approve.

Options:

- **Yes, run it now (Recommended)** — best after moving to newer Claude models and after each new model release, because current models follow instructions more literally and leftover text tuned for older ones steers them wrong. It runs one subagent over every prompt file and can take ten minutes or more, using real tokens.
- **Not now** — skip it; run `/aia-harness:audit-prompts` later, ideally after each new Claude model release.

On "Yes", call the `Skill` tool with `skill: "aia-harness:audit-prompts"` and `args:` the resolved target directory wrapped in literal double-quote characters (a path with spaces then stays one argument; the quotes are not part of the path), then stop — that command owns the rest. It repeats the plugin version check; if that reports a stale plugin, continue on the current version without asking again. On "Not now", end.
<!-- /aia-harness:offer-audit-prompts -->
