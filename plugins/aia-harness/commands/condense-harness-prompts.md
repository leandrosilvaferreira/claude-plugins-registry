---
description: Validate/fix Claude Code artifact frontmatters and semantically condense harness .md files (.claude/agents, commands, rules, skills) with Opus + deterministic gate.
argument-hint: "[path]"
allowed-tools:
  - Bash
  - AskUserQuestion
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
**Stage 2 — Semantic condensation** (via skill `condense-harness-prompts`)

---

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
node "${CLAUDE_PLUGIN_ROOT}/skills/condense-harness-prompts/lib/condense.mjs" \
  enumerate --root "${1:-$CLAUDE_PROJECT_DIR}" <scope flags>
```

Output: `<bytes>\t<size>\t<path>` per line, sorted largest → smallest. If empty: warn and stop.

Present the list to the user **largest → smallest** with size alongside.

---

## 3. Stage 1 — Frontmatter validation + auto-fix

Before compressing, fix invalid frontmatters in all enumerated files.

```bash
node "${CLAUDE_PLUGIN_ROOT}/skills/condense-harness-prompts/lib/condense.mjs" \
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

Invoke the `condense-harness-prompts` skill to condense the same files enumerated in step 2. The scope is already determined — **skip the scope question** in the skill and go directly to step 3 (todo list) and 4 (subagent dispatch).

Follow the skill workflow exactly:

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
