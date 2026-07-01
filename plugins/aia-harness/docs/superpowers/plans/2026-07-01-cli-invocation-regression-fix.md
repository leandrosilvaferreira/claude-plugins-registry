# Fix: broken CLI invocation + fragile $CLAUDE_PROJECT_DIR resolution in commands

Branch: main (worktree declined by user)
Base commit: 95c586e6a0577d81cad61eb93229c824eff2b158

## Context

User ran `/aia-harness:doctor` against a real target project (fiagril website)
using the published 0.3.4 plugin cache. The transcript showed two real,
confirmed regressions:

### Bug 1 — every command invokes a deleted binary (exit 127)

Commit `5f47b08` ("fix(cross-platform): remove bash launcher bin/aia-harness")
deleted `bin/aia-harness` (the old bash wrapper), asserting it was "only
referenced in old docs and memory files, not in active source code." That
claim was wrong: `commands/*.md` (10 files) and
`skills/harness-engineering/SKILL.md` still invoke
`"${CLAUDE_PLUGIN_ROOT}/bin/aia-harness"` directly as an executable — ~30
call sites total. A Claude Code plugin install
(`~/.claude/plugins/cache/...`) never runs `npm install`, so there is no
npm-bin-generated `aia-harness` shim; only `bin/harness.mjs` physically
exists there. Every one of these commands (`scan`, `doctor`, `init`,
`patch`, `check-deps`, `add-tools`, `add-mcp`, `add-plugins`,
`add-github-pm`, `help`) fails with exit 127 on its very first Bash step.
In the observed session the agent recovered by improvising
`node .../bin/harness.mjs` manually — that manual recovery is exactly the
"agent ficou perdido" the user described.

### Bug 2 — `$CLAUDE_PROJECT_DIR` silently resolves empty outside hooks, causing a wrong-directory `apply`

All command docs use the pattern `"${1:-$CLAUDE_PROJECT_DIR}"` to resolve
the target directory, repeated in every Bash snippet across a command's
multi-step flow. `$CLAUDE_PROJECT_DIR` is documented as available "when
hooks are executed" — it is not guaranteed inside the general-purpose Bash
tool the agent uses to run these command instructions. In the observed
transcript, `echo "CLAUDE_PROJECT_DIR=[$CLAUDE_PROJECT_DIR]"` printed `[]`
(confirmed empty) once the agent had `cd`'d into the scratchpad for `jq`
work. Because each Bash tool call is a fresh shell (cwd persists, exported
vars do not) and `harness.mjs`'s CLI falls back to `process.cwd()` when
given an empty string (`path.resolve("")` === `path.resolve(".")` ===
cwd — verified directly), the subsequent `apply` dry-run silently ran
against the scratchpad directory instead of the real target — reporting
`created: <all 90 artifacts>` as if nothing existed. The agent in that
session caught the anomaly by cross-checking; a less careful session would
not have, and with `--yes` this could scaffold files into the wrong
directory.

`${CLAUDE_PLUGIN_ROOT}` does not have this problem — it resolved correctly
throughout the transcript (it's a plugin-wide templating value, not a
hook-only one).

## Global constraints (bind both tasks)

- The deleted `bin/aia-harness` must **not** come back —
  `.claude/rules/scripts-cross-platform.md` correctly forbids shell
  wrappers; the fix is to correct every call site to invoke the real
  `.mjs` entrypoint via `node`, not to restore the wrapper.
- Exact mechanical replacement for every executable-invocation occurrence
  of the string `"${CLAUDE_PLUGIN_ROOT}/bin/aia-harness"` (in
  `commands/*.md` and `skills/harness-engineering/SKILL.md`): replace with
  `node "${CLAUDE_PLUGIN_ROOT}/bin/harness.mjs"`. No other change to those
  lines (flags/args stay as-is).
- `commands/condense-harness-prompts.md` does **not** reference
  `bin/aia-harness` at all (it shells out to a different script,
  `skills/condense-harness-prompts/lib/condense.mjs`, already correctly
  `node`-prefixed) — it is in scope for the Bug 2 fix only, not Bug 1.
- `commands/help.md` needs the Bug 1 fix on its one executable line
  (`... version`) AND its prose (the "wrappers over the deterministic
  binary `bin/aia-harness` (= `bin/harness.mjs`)" paragraph and the
  illustrative `aia-harness scan [dir]...` usage block, which implies a
  global PATH install that the plugin flow never creates — make those
  examples `node bin/harness.mjs ...` too, for consistency).
- Bug 2 fix is a documentation/prompt change, not code: extend each
  command's existing "Target directory: `$1` if provided, else
  `$CLAUDE_PROJECT_DIR`" line/paragraph (10 files: scan, doctor, init,
  patch, check-deps, add-tools, add-mcp, add-plugins, add-github-pm,
  condense-harness-prompts) with guidance to (a) resolve the target
  directory **once**, at the start, into a concrete literal absolute path,
  (b) state plainly why: `$CLAUDE_PROJECT_DIR` is not guaranteed outside
  hook execution and silently falls back to the shell's current directory,
  and (c) reuse that literal resolved path for every later
  `aia-harness`/CLI invocation in the same command — never re-expand a
  bare `$CLAUDE_PROJECT_DIR` in a later, separately-issued Bash call. Keep
  it to a short paragraph per file, adapted to each file's existing voice
  — substance matters more than exact wording here.
- Root `CLAUDE.md` (line ~10) and `skills/harness-engineering/SKILL.md`
  (line ~9) each have one prose mention of `bin/aia-harness` as if it's a
  real exposed binary — correct both to describe `bin/harness.mjs` invoked
  via `node`.
- `.claude/memory/node-runtime-nvm.md` (this repo's own dev memory, not a
  distributed template) has a stale "How to apply" line referencing both a
  `bin/node-run.sh` (confirmed via grep: never existed in this repo) and
  the now-deleted `bin/aia-harness`. Fix by removing both dangling
  references from that one line; keep the rest of the memory entry (the
  nvm-path-resolution fact itself is still true and useful).
- Do **not** touch `docs/superpowers/plans/*.md` or `.superpowers/sdd/*` —
  those are historical/immutable records of past work, including the
  record of the very commit that caused this bug. Leave them as-is.
- Do **not** re-add a `.sh`/`.bat` wrapper of any kind —
  `.claude/rules/scripts-cross-platform.md` is binding.

## Task 1 — regression test (write first, must go RED against current content)

Add `tests/commands-cli-invocation.test.mjs` (follow the existing
`node:test` + `node:assert` style used throughout `tests/*.test.mjs`, e.g.
`tests/cli-integration.test.mjs`). It must:

- Enumerate every file under `commands/*.md` plus
  `skills/harness-engineering/SKILL.md`.
- Assert **zero** occurrences of the bare broken pattern
  `"${CLAUDE_PLUGIN_ROOT}/bin/aia-harness"` (a reference not preceded by
  `node `) anywhere in those files.
- Positively assert that at least one file (e.g. `commands/scan.md`)
  contains the corrected `node "${CLAUDE_PLUGIN_ROOT}/bin/harness.mjs"`
  invocation — so the test cannot pass vacuously (e.g. against emptied
  files).
- Run it against the **current, unfixed** repo state and confirm it fails
  (RED) before Task 2 starts — paste the failing output in the task
  report. This is the proof the test is real, not hollow.

## Task 2 — apply the fix (turns Task 1's test GREEN)

Apply every bullet in "Global constraints" above across:
`commands/scan.md`, `commands/doctor.md`, `commands/init.md`,
`commands/patch.md`, `commands/check-deps.md`, `commands/add-tools.md`,
`commands/add-mcp.md`, `commands/add-plugins.md`,
`commands/add-github-pm.md`, `commands/condense-harness-prompts.md`,
`commands/help.md`, `skills/harness-engineering/SKILL.md`, `CLAUDE.md`,
`.claude/memory/node-runtime-nvm.md`. Run `npm test` after — Task 1's new
test must now pass, and nothing else may break.
