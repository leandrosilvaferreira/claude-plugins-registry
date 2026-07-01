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

**Purpose B — stable session identity key.** Some hooks hash a directory to
compute a shared temp-file path used to pass state from one hook invocation
to a *later, different* hook invocation in the same session (e.g.
`set-files-changed.mjs` writes a flag keyed on this hash; `memory-stop.mjs`,
`large-file-warning.mjs`, and the generated strict `verify-on-stop` hook all
read it later). This key **must stay on `CLAUDE_PROJECT_DIR`, never
`event.cwd`** — `event.cwd` can differ between the write and the read if the
session entered or left a worktree in between, which would silently break
the correlation (the reader would never find what the writer wrote).

```js
const projectDir = process.env.CLAUDE_PROJECT_DIR ?? process.cwd(); // Purpose B — do not add event.cwd here
const hash = createHash("sha1").update(projectDir).digest("hex").slice(0, 12);
```

**If a single hook needs both** (an operational command AND a shared
flag-file lookup), keep them as two separate variables — never let the
Purpose-A value leak into the Purpose-B hash, or vice versa. See
`templates/hooks/large-file-warning.mjs` and `templates/hooks/sql-idempotent-review.mjs`
for worked examples of the split.

## Which one do you have? A quick test

Ask: "if the session enters or leaves a worktree mid-session, should this
value change?" — Yes → Purpose A, use `event.cwd` first. No, it must stay
whatever it was at session start → Purpose B, use `CLAUDE_PROJECT_DIR` only.

## Canonical examples in this codebase

- Pure Purpose A: `guard-main-branch.mjs`, `worktree-write-guard.mjs`.
- Purpose A + B split in the same file: `large-file-warning.mjs`,
  `sql-idempotent-review.mjs`.
- Pure Purpose B (correctly never touches `event.cwd`): `set-files-changed.mjs`, `memory-stop.mjs`.

## Forbidden

- Don't resolve an operational directory from `CLAUDE_PROJECT_DIR`/`process.cwd()` alone when `event.cwd` is available — that is this exact bug.
- Don't key a shared flag-file hash on `event.cwd` — that breaks cross-invocation state correlation.
- Don't invent a third resolution order per file. Use the two patterns above, verbatim.
- Don't assume `templates/hooks/<name>.mjs` is the only copy — this repo dogfoods its own harness, so `.claude/hooks/<name>.mjs` may hold a separate, divergent local copy of the same hook (wired live in this repo's own `.claude/settings.json`) that needs the identical fix. Check both when fixing a hook that exists in both places.

## Acceptance criteria

- Every operational directory resolution prefers `event.cwd`, matching the Purpose A snippet above.
- Every shared flag-file hash stays on `CLAUDE_PROJECT_DIR` alone, matching the Purpose B snippet above.
- A hook mixing both purposes uses two distinctly named variables, never one.
- New hooks under `templates/hooks/` get a regression test proving `event.cwd` is actually what gets used when it differs from `CLAUDE_PROJECT_DIR` (see `tests/hook-guard-main-branch.test.mjs` for the pattern: two independent temp dirs, one per role).
