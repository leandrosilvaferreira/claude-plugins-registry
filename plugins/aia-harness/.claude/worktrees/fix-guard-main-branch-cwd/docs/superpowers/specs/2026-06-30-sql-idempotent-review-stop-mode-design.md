# Design: sql-idempotent-review Stop mode (catch externally-generated SQL)

**Date:** 2026-06-30
**Status:** Approved

## Summary

`sql-idempotent-review.mjs` today only fires on `PostToolUse` matched to
`Edit|Write|MultiEdit` — it never sees `.sql` files produced as a *side effect*
of a Bash command (`npx drizzle-kit generate`, a Maven/Hibernate DDL export, a
Prisma/Liquibase/Alembic generator, …), because those tools write the file
directly; no Claude Edit/Write tool call ever touches it. The hook becomes
dual-mode: the existing `PostToolUse` behavior is preserved byte-for-byte, and
a new `Stop`-mode branch sweeps `git status` once at the end of the turn to
catch any `.sql` file that changed this session but was never surfaced for
review — regardless of which tool produced it — and **blocks** the turn until
the agent reviews it. This mirrors the exact dual-mode pattern already
shipped in `templates/hooks/large-file-warning.mjs`.

## Goals

- Force review of `.sql` files created/modified by external generators
  (migration tools, ORMs, build plugins) during the session, even though no
  Claude tool call wrote them.
- Preserve the current `PostToolUse` advisory behavior exactly as-is — same
  output, same tests, zero regressions.
- Reuse the idempotency checklist text (one source of truth) across both modes.
- Never double-block a file the agent already got advisory context for via
  its own Edit/Write.
- Stay stack-independent — no hardcoded generator command names.

## Non-goals

- `SubagentStop` wiring (a subagent's own generator run is only caught when
  the *main* thread's `Stop` fires, i.e. after the subagent returns control).
  Can be added later the same way if needed.
- Verifying the fix actually made the file idempotent. Same trade-off already
  accepted by `large-file-warning.mjs`: one forced pass per stop-chain
  (anti-loop via `stop_hook_active`), not a correctness-verifying loop.
- Pattern-matching specific generator commands (`drizzle-kit generate`,
  `hibernate ddl-auto`, `prisma migrate`, `liquibase`, `alembic revision`, …).
  Rejected during brainstorming: an unbounded, fragile allowlist that
  contradicts the hook's existing stack-independent design. `git status`
  detects the *effect* (an uncommitted `.sql` file) instead of trying to
  recognize every possible *cause*.

---

## Architecture

### Trigger

Two always-on wirings of the **same file**, both active simultaneously
(additive, not a mode flag like `large-files`):

| Event | Matcher | Behavior |
| --- | --- | --- |
| `PostToolUse` | `Edit\|Write\|MultiEdit` | unchanged — advisory `additionalContext`, fires every time, no dedup |
| `Stop` | — | **new** — sweeps `git status`, blocks once per stop-chain if unreviewed `.sql` files are found |

### File locations

Single file, no new template:

| Path | Purpose |
| --- | --- |
| `templates/hooks/sql-idempotent-review.mjs` | dual-mode hook, distributed to target projects |

### Logic flow

```
stdin (event)
  │
  ├─ hook_event_name !== "Stop" → postToolUse() (covers "PostToolUse" AND the
  │    undefined case the 22 pre-existing tests use — they predate this
  │    dispatch and never set hook_event_name; production always sets it)
  │    ├─ tool_input.file_path|path missing/not .sql → exit 0 (unchanged)
  │    ├─ emit additionalContext (unchanged text/shape)
  │    └─ best-effort: append `${sessionId}\t${absPath}` to shared notified-flag
  │
  └─ hook_event_name === "Stop" → blockOnStop()
       ├─ stop_hook_active === true → exit 0 (anti-loop, unchanged pattern)
       ├─ `git status --porcelain --untracked-files=all` fails / not a repo → exit 0 (fail-open)
       ├─ filter lines: extension .sql (case-insensitive), skip deletions AND renames
       │    (D/R in status — the `old -> new` arrow isn't parsed, so a rename would
       │    otherwise be mis-read as a bogus but ".sql"-extensioned candidate path)
       ├─ drop candidates already in the shared notified-flag
       ├─ none left → exit 0 (silent)
       └─ some left → mark them in the flag, emit {decision:"block", reason: <list + shared rules>}
```

---

## Shared idempotency rules — DRY extraction

The existing `additionalContext` array (today: lines 44–89 of
`sql-idempotent-review.mjs`) splits into:

- **Header** (mode-specific, built separately by each branch)
- **Rules body** (`MIGRATION SAFETY …` through `Preserve the original SQL
  dialect …`) — extracted **verbatim, unchanged text**, into
  `buildIdempotencyRules(): string`, called by both branches.

Keeping the rules text byte-identical is required so every existing content
assertion in `tests/hook-sql-idempotent-review.test.mjs` (`IF NOT EXISTS`,
`CREATE OR REPLACE`, `duplicate_object`, `DO $$`, `ADD VALUE IF NOT EXISTS`,
`committed|applied` + `hash`, `SET DATA TYPE`, `do NOT add BEGIN/COMMIT`,
`CONCURRENTLY`, …) keeps passing unchanged.

```js
function buildIdempotencyRules() {
  return [
    `MIGRATION SAFETY (check this first):`,
    // ... exact existing lines, unmoved ...
    `  • Preserve the original SQL dialect (PostgreSQL, MySQL, SQLite, MSSQL, Oracle)`,
  ].join("\n");
}
```

## `postToolUse()` branch (refactor, output unchanged)

Wraps today's top-level script body as-is. Only addition: after building
`additionalContext` (same as today), best-effort append to the shared flag:

```js
function postToolUse() {
  const ti = event?.tool_input ?? {};
  const file = ti.file_path || ti.path;
  if (!file || typeof file !== "string") return;
  if (path.extname(file).toLowerCase() !== ".sql") return;

  const additionalContext = [
    `SQL file edited: ${file}`,
    `Review it and make EVERY statement idempotent so the file can be executed`,
    `multiple times in production without errors. Apply these rules:`,
    ``,
    buildIdempotencyRules(),
  ].join("\n");

  process.stdout.write(
    JSON.stringify({ hookSpecificOutput: { hookEventName: "PostToolUse", additionalContext } }),
  );

  // Bookkeeping only — does not affect stdout/exit code/tests above.
  markNotified(file);
}
```

`markNotified` resolves the file to an absolute path and appends
`${sessionId}\t${absPath}\n` to the shared flag, swallowing any error
(same best-effort try/catch style as `set-files-changed.mjs`).

## `blockOnStop()` branch (new)

```js
function blockOnStop() {
  if (event && event.stop_hook_active) return; // anti-loop, same as large-file-warning

  let status;
  try {
    status = execFileSync("git", ["status", "--porcelain", "--untracked-files=all"], {
      cwd: projectDir,
      encoding: "utf8",
      windowsHide: true,
    });
  } catch {
    return; // not a git repo / git missing → fail open
  }

  const candidates = status
    .split(/\r?\n/)
    .filter(Boolean)
    .filter((line) => !/[DR]/.test(line.slice(0, 2))) // skip deletions/renames (same tolerance as large-file-warning)
    .map((line) => path.join(projectDir, line.slice(3).trim()))
    .filter((abs) => path.extname(abs).toLowerCase() === ".sql");

  const notified = readNotifiedSet(); // Set<string> of "sessionId\tabsPath"
  const sessionId = typeof event.session_id === "string" ? event.session_id : "nosession";
  const fresh = [...new Set(candidates)].filter((abs) => !notified.has(`${sessionId}\t${abs}`));
  if (fresh.length === 0) return;

  fresh.forEach((abs) => appendNotified(sessionId, abs));

  const rels = fresh.map((abs) => path.relative(projectDir, abs));
  const list = rels.map((r) => `  • ${r}`).join("\n");
  const reason = [
    `${rels.length} SQL file(s) changed this session but were never reviewed for`,
    `idempotency (likely written by an external tool — migration generator, ORM,`,
    `build plugin — not a direct Claude edit):`,
    list,
    ``,
    `Review EACH file above and make every statement idempotent so it can run`,
    `multiple times in production without errors. Apply these rules:`,
    ``,
    buildIdempotencyRules(),
  ].join("\n");

  process.stdout.write(JSON.stringify({ decision: "block", reason }));
}
```

### Shared notified-flag

New, distinct from `large-file-warning`'s own flag:

```
path.join(os.tmpdir(), `aia-harness-sql-notified-${projHash}`)
```

Lines: `${sessionId}\t${absPath}`. Written by **both** branches:
`postToolUse()` marks a file the moment the agent's own edit surfaces it (so
`blockOnStop()` never double-blocks something already advised); `blockOnStop()`
marks a file the moment it blocks on it (so a second `Stop` in the same
retry chain — combined with `stop_hook_active` — doesn't loop).

Why shared state matters: without it, an agent-edited `.sql` file would get
the current advisory *and* a new block at end of turn — strengthening the
existing agent-edited path beyond what was asked. The flag scopes the new
`Stop` block to exactly the gap described in the request: files that never
went through `postToolUse()` at all.

---

## Wiring change — `lib/generate/settings.mjs`

One line added to the existing `Stop` group (alongside `verify-on-stop.mjs`,
`memory-stop.mjs`):

```js
Stop: [
  {
    hooks: [
      { type: "command", ...hookCmd("verify-on-stop.mjs"), timeout: 300 },
      { type: "command", ...hookCmd("memory-stop.mjs"), timeout: 30 },
      { type: "command", ...hookCmd("sql-idempotent-review.mjs"), timeout: 15 }, // ← add
    ],
  },
],
```

The existing `PostToolUse[0].hooks` entry for `sql-idempotent-review.mjs`
(matcher `Edit|Write|MultiEdit`) is untouched. No new CLI flag / plan option —
unlike `--large-files`, this isn't a mode choice, it's strictly additive, so
it ships unconditionally to every project that gets the hook (i.e. all of
them; the file is stack-independent in `PROJECT_HOOK_FILES`).

**No change needed:**
- `lib/data/project-catalog.mjs` — file already listed in `PROJECT_HOOK_FILES`.
- `lib/plan/hook-artifacts.mjs` — already copies it generically.
- `.claude/settings.json` (aia-harness's own dev config) — this repo has no
  `.sql` files and does not currently wire `sql-idempotent-review.mjs` at all
  (confirmed: absent from `.claude/settings.json`), so there's nothing to
  dogfood here, unlike `validate-settings-schema.mjs`.

---

## Unit tests — `tests/hook-sql-idempotent-review.test.mjs`

All 22 existing tests stay unchanged (they exercise `postToolUse()` only,
whose output is untouched). New `Stop`-branch tests, using the existing
`mkGitRepo()` helper from `tests/hook-runner.mjs`:

| # | Scenario | Expected |
| --- | --- | --- |
| 1 | Non-git dir, `hook_event_name:"Stop"` | exit 0, silent, schema-valid (`validateStopOutput`) |
| 2 | Empty stdin, `Stop` | exit 0, silent |
| 3 | Git repo, no changes | exit 0, silent |
| 4 | Git repo, untracked `.sql` file | `decision:"block"`, reason names the file + mentions `IF NOT EXISTS` |
| 5 | Git repo, tracked `.sql` file modified | `decision:"block"` |
| 6 | Git repo, `.sql` file deleted (status `D`) | exit 0, silent (excluded) |
| 7 | Git repo, non-`.sql` file renamed to `.sql` (status `R`, porcelain `old -> new`) | exit 0, silent (excluded — arrow not parsed, see Logic flow note) |
| 8 | Git repo, non-`.sql` file changed (e.g. `.ts`) | exit 0, silent |
| 9 | `stop_hook_active: true` with a pending untracked `.sql` | exit 0, silent (anti-loop) |
| 10 | Multiple new `.sql` files | `decision:"block"`, reason lists all of them |
| 11 | File already marked in the shared flag (simulating a prior `postToolUse()` call this session) | exit 0, silent — no double-block |
| 12 | Same file, different `session_id` | blocks again (flag is per-session, mirrors `large-file-warning`) |
| 13 | Second `Stop` call after the first already flagged the file (no `stop_hook_active`) | exit 0, silent — already in flag from step 1's own write |
| 14 | CRLF line endings from `git status` output | parses correctly, still blocks |

Also add one cross-mode regression test: `postToolUse()` on a `.sql` file
followed by a `Stop` call in the same session/dir → `Stop` stays silent
(proves the shared-flag suppression works end-to-end, not just via a
pre-seeded flag file).

Import additions: `validateStopOutput` from `lib/validate/hook-schema.mjs`,
`mkGitRepo` from `./hook-runner.mjs`.

---

## Cross-platform compliance

Follows `.claude/rules/hooks-cross-platform.md`:

- `.mjs` ESM, exec form (`node` + `args`), no shell.
- `execFileSync("git", [...], { windowsHide: true, ... })` — mandatory flag set.
- `os.tmpdir()` / `path.join()` for the new shared flag — no hardcoded paths.
- Fail-open on every infra error (no git, not a repo, spawn failure) — never
  throws, never blocks on infrastructure, only on an actual finding.
- No `jq`, no npm/npx shim, no platform-specific binary.

---

## File change summary

| File | Change |
| --- | --- |
| `templates/hooks/sql-idempotent-review.mjs` | refactor to dual-mode: extract `buildIdempotencyRules()`, wrap current logic in `postToolUse()` (output unchanged) + flag bookkeeping, add `blockOnStop()`, branch on `event.hook_event_name` |
| `lib/generate/settings.mjs` | add one entry to `hooks.Stop[0].hooks` |
| `tests/hook-sql-idempotent-review.test.mjs` | add 14 new `Stop`-branch tests + 1 cross-mode regression test; import `validateStopOutput`, `mkGitRepo` |
| `lib/data/project-catalog.mjs` | no change |
| `lib/plan/hook-artifacts.mjs` | no change |
| `.claude/settings.json` | no change (hook not dogfooded in this repo) |
