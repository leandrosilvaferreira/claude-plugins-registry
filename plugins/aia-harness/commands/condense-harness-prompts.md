---
description: Validate/fix Claude Code artifact frontmatters and semantically condense harness .md files (.claude/agents, commands, rules, skills) with Opus + deterministic gate.
argument-hint: "[path]"
allowed-tools:
  - Bash
  - AskUserQuestion
  - Skill
  - Agent
  - TodoWrite
---

# /aia-harness:condense-harness-prompts

Target directory: `$1` if provided, else `$CLAUDE_PROJECT_DIR`.

<!-- aia-harness:target-dir-resolution -->
Resolve this **once**, at the
start of this command, into a concrete literal absolute path. `$CLAUDE_PROJECT_DIR` is documented
as available "when hooks are executed" but is not guaranteed inside the general-purpose Bash tool
used to run these instructions — it can silently expand empty there, and the CLI then falls back
to the shell's *current* working directory, which is wrong if the agent has since `cd`'d elsewhere
(e.g. into the scratchpad for intermediate file work). Reuse that one resolved literal path in
every subsequent invocation below — including the `condense.mjs` calls — never re-expand a bare
`$CLAUDE_PROJECT_DIR` in a later, separately-issued Bash call, since each Bash tool call is a
fresh shell (only cwd persists, not exported variables) and an earlier `cd` silently redirects any
later bare-env-var fallback to the wrong place.

Runs two sequential stages on the target project's `.claude/` artifacts:

**Stage 1 — Frontmatter validation + auto-fix**
**Stage 2 — Semantic condensation** (via skill `condense-harness-prompts-workflow`)

---

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

## 1. Determine scope

Use `AskUserQuestion` (header `Scope`) with the options below — **unless** the user already provided the scope in the prompt, in which case skip directly.

| Option | Flags for condense.mjs |
|--------|------------------------|
| Everything (agents+commands+rules) | `--all` |
| A folder | 2nd question: agents / commands / rules → `--type <folder>` |
| A skill | ask for skill name → `--type skills --name <name>` |
| A file | ask for path → `--file <path>` |

**Skills: only 1 per run** — never in batch.

Record internally whether the user requested `--skip-dedup` (skips dedup review in stage 2).

---

## 2. Enumerate files

```bash
node "${CLAUDE_PLUGIN_ROOT}/skills/condense-harness-prompts-workflow/lib/condense.mjs" \
  enumerate --root "${1:-$CLAUDE_PROJECT_DIR}" <scope flags>
```

Output: `<bytes>\t<size>\t<path>` per line, sorted largest → smallest. If empty: warn and stop.

Present the list to the user **largest → smallest** with size alongside.

---

## 3. Stage 1 — Frontmatter validation + auto-fix

Before compressing, fix invalid frontmatters in all enumerated files.

```bash
node "${CLAUDE_PLUGIN_ROOT}/skills/condense-harness-prompts-workflow/lib/condense.mjs" \
  frontmatter <file1> <file2> ...
```

The command detects the artifact type from the path (`agent` / `skill` / `command` / `rule`) and validates/auto-fixes:

| Type | Required fields | Auto-applied fixes |
|------|-----------------|-------------------|
| `agent` | `name`, `description` | `allowed-tools` → `tools`; normalize CSV of tools |
| `skill` | `name`, `description` | `tools` → `allowed-tools`; normalize CSV |
| `command` | `description` | `tools` → `allowed-tools`; normalize CSV |
| `rule` | — | — (warnings only: missing `paths`) |

Report to user:

- How many files were fixed and which errors were found
- Non-blocking warnings (e.g. agent without `model`, agent without `tools`)
- Files whose type was not recognized (skipped)

After stage 1 report, proceed to stage 2.

---

## 4. Stage 2 — Semantic condensation

Invoke the `condense-harness-prompts-workflow` skill to condense the same files enumerated in
step 2: use the `Skill` tool with `skill: "aia-harness:condense-harness-prompts-workflow"` and
`args: <resolved path>`. The scope is already determined — **skip the scope question** in it
and go straight to its step 3 (todo list) and step 4 (subagent dispatch).

Follow that workflow exactly:

1. `TodoWrite` one item per file (if 2+ files)
2. Parallel dispatch of Opus subagents (1 per file, all in the same turn)
3. `commit` via condense.mjs after all return
4. Optional fix-loop for blocked files (max 1-2 rounds)
5. Global Dedup Review (skill step 5c) — unless `--skip-dedup` was requested

---

## 5. Final report

Present consolidated table:

```
Stage 1 — Frontmatter
  N fixed · N ok · N with warnings

Stage 2 — Condensation
  N written · N blocked · Xb saved

Blocked (inspect .tmp):
  <list of .condensed.tmp paths>
```

If dedup review ran: include summary of substitutions applied and bytes saved.

---

## 6. Offer the prompt audit

<!-- aia-harness:offer-audit-prompts -->
When the report above is done, offer the sibling command `/aia-harness:audit-prompts` once. Skip this step unless the command produced its report.

Ask with one `AskUserQuestion` (header `Prompt audit`):

> Run `/aia-harness:audit-prompts` now? It reviews this project's CLAUDE.md files, rules, skills, agents and commands for prompt text written for older Claude models — shouting emphasis, step-by-step scripts, stale examples, instructions that contradict each other — and proposes a diff fitted to the models the project pins. Nothing is written until you approve.

Options:

- **Yes, run it now (Recommended)** — best after moving to newer Claude models and after each new model release, because current models follow instructions more literally and leftover text tuned for older ones steers them wrong. It runs one subagent over every prompt file and can take ten minutes or more, using real tokens.
- **Not now** — skip it; run `/aia-harness:audit-prompts` later, ideally after each new Claude model release.

On "Yes", call the `Skill` tool with `skill: "aia-harness:audit-prompts"` and `args:` the resolved target directory wrapped in literal double-quote characters (a path with spaces then stays one argument; the quotes are not part of the path), then stop — that command owns the rest. It repeats the plugin version check; if that reports a stale plugin, continue on the current version without asking again. On "Not now", end.
<!-- /aia-harness:offer-audit-prompts -->
