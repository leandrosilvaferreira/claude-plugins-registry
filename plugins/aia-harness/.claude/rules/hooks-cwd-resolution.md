---
paths:
  - "hooks/**"
  - ".claude/hooks/**"
  - "templates/hooks/**"
  - "tests/hook-*"
---

# Hooks — cwd resolution standard (event.cwd vs CLAUDE_PROJECT_DIR vs process.cwd())

## Objective

Every hook that resolves a directory — to run a git/tsc/eslint/phpstan
command in, or to check whether an edited file's path falls under it — must
resolve the *session's actual active directory*, not wherever the Claude
Code backend process happened to launch from. Getting this wrong is silent:
the hook still runs, still exits 0, and produces a plausible-looking but
wrong result (checks the wrong branch, lints the wrong tree, silently
no-ops because a binary "isn't there"). This bit us for real:
`guard-main-branch.mjs` denied every commit from a correctly-isolated
worktree session because it kept checking the *original* checkout's branch.

## The three values, and what each actually tracks

| Value | Tracks | Stable across a session? |
| --- | --- | --- |
| `event.cwd` (from the hook's stdin JSON) | The live working directory Claude Code attaches to *this specific* tool-invocation event. Tracks `EnterWorktree`/`ExitWorktree` immediately. | No — by design. Changes when the session switches worktrees. |
| `process.env.CLAUDE_PROJECT_DIR` | The project root, pinned once for the whole session. | Yes — stays the original root even after `EnterWorktree`. |
| `process.cwd()` | The *hook subprocess's own* launch-time working directory — an implementation detail of however Claude Code spawned this particular hook process. | Unreliable. Not guaranteed to equal either of the above. |

A fourth value, `event.session_id`, sits outside this table because it isn't a *directory* — it identifies the session itself. Purpose B below resolves state through it (via `sessionScratchDir(event.session_id)`), not through any of the three directory values above, precisely because none of the three is both stable within a session AND unique across parallel sessions of the same project.

## Two purposes — resolve them differently, never merge them

**Purpose A — operational directory.** "Where should this command actually
run, or which root does this file path need to be checked against?" This
must reflect the session's *live* location.

```js
const cwdArg = typeof event.cwd === "string" && event.cwd ? event.cwd : "";
const projectDir = cwdArg || process.env.CLAUDE_PROJECT_DIR || process.cwd();
// use projectDir as the execFileSync/spawnSync `cwd:` option, or as the
// base for path.relative()/path.join() against the edited file's path.
```

**Purpose B — stable session identity key.** Some hooks need a shared
storage location to pass state from one hook invocation to a *later,
different* hook invocation in the same session (e.g. `set-files-changed.mjs`
writes a flag; `memory-stop.mjs`, `large-file-warning.mjs`, and the generated
strict `verify-on-stop` hook all read it later). **Use
`sessionScratchDir(sessionId)` from `templates/hooks/session-scratch.mjs`,
keyed by `event.session_id` — never `event.cwd`, and never a hash of
`CLAUDE_PROJECT_DIR`.**

```js
const sessionId = typeof event.session_id === "string" ? event.session_id : "nosession";
const flag = path.join(sessionScratchDir(sessionId), "files-changed"); // Purpose B
```

Two independent reasons neither of the other two values works for Purpose B:

- `event.cwd` can differ between the write and the read if the session
  entered or left a worktree in between, silently breaking the correlation
  (the reader would never find what the writer wrote).
- A hash of `CLAUDE_PROJECT_DIR` (the pattern this project used before) stays
  stable across worktree entry *within one session* — but `CLAUDE_PROJECT_DIR`
  is identical across **parallel** sessions of the same project (root +
  worktree A + worktree B — exactly the workflow `claude-code-worktrees`
  supports). Two parallel sessions hashing to the same file silently mix each
  other's state: session B's edited-file paths leak into session A's lint
  target list, a SQL-review flag set by session A suppresses session B's own
  review, etc. `event.session_id` is unique per session (including per
  worktree session), so keying on it directly — with no hash needed at all —
  fixes both the worktree-entry-drift problem the old pattern solved AND the
  parallel-session collision it didn't anticipate.

**If a single hook needs both** (an operational command AND a shared
flag-file lookup), keep them as two separate variables — never let the
Purpose-A value leak into the Purpose-B path, or vice versa. See
`templates/hooks/large-file-warning.mjs` and `templates/hooks/sql-idempotent-review.mjs`
for worked examples of the split.

## Which one do you have? A quick test

Ask: "if the session enters or leaves a worktree mid-session, should this
value change?" — Yes → Purpose A, use `event.cwd` first. No, it must stay
whatever it was at session start → Purpose B, use `sessionScratchDir(event.session_id)`.

## Canonical examples in this codebase

- Pure Purpose A: `guard-main-branch.mjs`, `worktree-write-guard.mjs`.
- Purpose A + B split in the same file: `large-file-warning.mjs`,
  `sql-idempotent-review.mjs`.
- Pure Purpose B (correctly never touches `event.cwd` or `CLAUDE_PROJECT_DIR`
  for the flag path — only `sessionScratchDir(sessionId)`):
  `set-files-changed.mjs`, `memory-stop.mjs`, `worktree-prompt-ctx.mjs`.

## Forbidden

- Don't resolve an operational directory from `CLAUDE_PROJECT_DIR`/`process.cwd()` alone when `event.cwd` is available — that is this exact bug.
- Don't key Purpose-B shared state on `event.cwd` — that breaks cross-invocation state correlation.
- Don't key Purpose-B shared state on a hash of `CLAUDE_PROJECT_DIR` (or any other project-identity value) — that collides across parallel sessions of the same project. Use `sessionScratchDir(event.session_id)`.
- Don't invent a third resolution order per file. Use the two patterns above, verbatim.
- Don't assume `templates/hooks/<name>.mjs` is the only copy — this repo dogfoods its own harness, so `.claude/hooks/<name>.mjs` may hold a separate, divergent local copy of the same hook (wired live in this repo's own `.claude/settings.json`) that needs the identical fix. Check both when fixing a hook that exists in both places.

## Acceptance criteria

- Every operational directory resolution prefers `event.cwd`, matching the Purpose A snippet above.
- Every Purpose-B shared state key uses `sessionScratchDir(event.session_id)`, matching the Purpose B snippet above — never `CLAUDE_PROJECT_DIR` or `event.cwd`.
- A hook mixing both purposes uses two distinctly named variables, never one.
- New hooks under `templates/hooks/` get a regression test proving `event.cwd` is actually what gets used when it differs from `CLAUDE_PROJECT_DIR` (see `tests/hook-guard-main-branch.test.mjs` for the pattern: two independent temp dirs, one per role).
