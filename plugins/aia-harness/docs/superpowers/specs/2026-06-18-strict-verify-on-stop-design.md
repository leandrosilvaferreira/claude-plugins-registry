# Strict verify-on-stop — design

**Date:** 2026-06-18
**Status:** approved (design), pending implementation

## Problem

The scaffolded Stop hook (`templates/hooks/verify-on-stop.mjs`) is a passive
reminder: it runs `git status` and, if the tree is dirty, emits a non-blocking
`systemMessage` suggesting a lint/test run. It never runs lint or typecheck,
never captures errors, never blocks. So a session can end with broken lint /
type errors and the agent is never told to fix them.

Best practice (Anthropic hooks docs + community): "CLAUDE.md for preferences,
hooks for guarantees." To close the loop, the Stop hook must *produce a
pass/fail signal* and *block* with the error fed back, so the agent self-corrects.

## Goal

A **strict** mode for the generated harness: the Stop hook runs the project's
detected lint + typecheck commands, and on real failure blocks the stop with
`decision:block` + the error excerpt, so the agent fixes it before finishing.

## Locked decisions

1. **Default ON.** `ctx.strict` defaults to `true` in `buildPlan`. CLI flag
   `--no-strict` disables it (mirrors the existing `--no-tools`). Every `apply`
   (incl. automation / `--yes`) gets strict unless `--no-strict` is passed.
2. **Shown in the interactive flow.** `commands/init.md` surfaces the choice in
   the consent gate, pre-selected/recommended ON, with plain text ("runs lint +
   typecheck on stop and blocks until they pass") — the user never has to know
   the flag exists. Unchecking → `apply --no-strict`.
3. **Session-scoped gating.** A PostToolUse hook records files the session
   edited; the Stop hook only runs lint/typecheck if at least one edited file is
   lintable. Avoids blocking on pre-existing errors unrelated to the session.
4. **Anti-loop = swapo-style.** Guard on `stop_hook_active`: when true, approve
   immediately. Guarantees **one** feedback/correction cycle, never an infinite
   loop. (N-cycle re-verification is out of scope.)
5. **Run commands as detected.** Use `profile.commands.lint` / `.typecheck`
   verbatim — do not invent `lint:fix`. If only one exists, run only that. If
   neither exists, strict is a no-op (keep the reminder hook).
6. **Fail-open on infra.** A missing runtime / missing command (ENOENT / exit
   127) never blocks — only a real non-zero lint/typecheck exit blocks.

## Components

### 1. `lib/generate/verify.mjs` (new, pure)

`renderVerifyOnStop(profile) -> string` — generates the strict Stop hook source,
embedding the detected commands. Returns `null` when neither lint nor typecheck
is detected (signals the caller to fall back to the static reminder).

Generated hook algorithm:
1. Read stdin JSON event. On parse failure → `exit 0`.
2. If `event.stop_hook_active` → `{decision:"approve"}`, `exit 0`. *(anti-loop)*
3. Compute the session flag-file path (sha1 of `CLAUDE_PROJECT_DIR`, 12 chars,
   under `os.tmpdir()`).
4. If flag file absent → approve. *(session changed nothing)*
5. Read recorded paths; keep lintable extensions
   (`.js .jsx .ts .tsx .mjs .cjs .vue .svelte .php`). None lintable → clear
   flag, approve.
6. Prepend `dirname(process.execPath)` to `PATH` (so `npm`/`pnpm` resolve under
   nvm-managed node), then run each detected command via `execSync(cmd 2>&1)`
   with a 120s timeout, `cwd = CLAUDE_PROJECT_DIR`.
7. Classify each run's failure: `err.code === "ENOENT"` or `err.status === 127`
   → infra, treat as skipped (fail-open). `err.status > 0` → real failure.
8. Any real failure → collect combined output, emit
   `{decision:"block", reason:<header + excerpt (<=80 lines)>,
   hookSpecificOutput:{hookEventName:"Stop", additionalContext:<which cmd>}}`.
   Do **not** clear the flag.
9. All clean (or only infra-skipped) → clear flag, approve.
10. Outer catch → `exit 0` (fail-open).

### 2. `templates/hooks/set-files-changed.mjs` (new, static)

PostToolUse `Edit|Write|MultiEdit`. Reads stdin JSON, takes
`tool_input.file_path ?? tool_input.path`, appends it + `\n` to the session
flag-file (same path derivation as the Stop hook). Fail-open: any error → exit 0.
Mirrors `format-on-edit.mjs` structure. The flag-file helper (~5 lines) is
duplicated inline in both hooks — hooks are standalone, no shared import.

### 3. `lib/generate/settings.mjs`

`renderSettings(profile, extraHooks = {}, opts = {})` gains `opts.strict`. When
strict, add a PostToolUse entry wiring `set-files-changed.mjs` (alongside the
existing `format-on-edit.mjs`). The Stop wiring is unchanged (same
`verify-on-stop.mjs` path; only its *content* differs in strict mode).

### 4. `lib/plan.mjs`

- `ctx.strict` (default `true`).
- Determine `strict = ctx.strict !== false && renderVerifyOnStop(profile) != null`.
- Remove `verify-on-stop.mjs` from the static `HOOK_FILES` loop; add it
  explicitly: strict → `content: renderVerifyOnStop(profile)`; else → `copyFrom`
  the static reminder template.
- When strict, add the `set-files-changed.mjs` artifact (`copyFrom` static).
- Pass `{ strict }` to `renderSettings`.

### 5. `bin/harness.mjs`

Parse `--no-strict` → `strict: false`; thread `ctx.strict` into `buildPlan` for
both `plan` and `apply`. Update help text.

### 6. `commands/init.md`

Consent gate: add a "Stop verification (lint + typecheck, blocks until clean)"
choice, recommended/checked by default. If the user declines, run
`apply ... --no-strict`. No mention of the flag in user-facing text.

### 7. `CLAUDE.md` (this repo)

Update the safety invariant line: verify-on-stop now **blocks on real lint /
typecheck failures** but stays **fail-open on infra failures** (missing
runtime/command). Document that strict is the default and `--no-strict` opts out.

## Edge cases

- No git: unaffected — strict path doesn't use git (gating is the flag-file).
- Neither lint nor typecheck detected: `renderVerifyOnStop` returns `null` →
  fall back to the reminder hook; no `set-files-changed` artifact.
- Pre-existing errors: only surface if the session touched a lintable file
  (accepted limitation — matches swapo).
- Multiple Stops in one session: first clean stop clears the flag; later edits
  re-create it via PostToolUse.

## Testing (node --test, `tests/*.test.mjs` style)

- `renderVerifyOnStop`: embeds detected commands; contains `stop_hook_active`
  guard; emits `decision:"block"`; returns `null` when no lint/typecheck.
- `renderSettings`: strict wires `set-files-changed` PostToolUse; non-strict
  does not; Stop wiring present in both.
- `buildPlan`: strict (default) → `verify-on-stop` artifact has `content` and a
  `set-files-changed` artifact exists; `--no-strict` (`strict:false`) →
  `verify-on-stop` is `copyFrom` and no `set-files-changed`.
- `bin` `--no-strict` propagates (assert via `plan --json` artifact shape).

## Out of scope (YAGNI)

- N-cycle re-verification (only one correction cycle).
- Mapping file extension → specific command (any lintable change runs all
  detected verify commands).
- Running tests on stop (lint + typecheck only).
- `lint:fix` auto-fix behavior.
