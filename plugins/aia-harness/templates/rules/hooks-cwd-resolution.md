---
paths:
  - "hooks/**"
  - ".claude/hooks/**"
---

# Hooks — cwd resolution standard (event.cwd vs CLAUDE_PROJECT_DIR vs process.cwd())

## Objective

Every hook that resolves a directory — to run a git/tsc/eslint/phpstan
command in, or to check whether an edited file's path falls under it — must
resolve the *session's actual active directory*, not wherever the Claude
Code backend process happened to launch from. Getting this wrong is silent:
the hook still runs, still exits 0, and produces a plausible-looking but
wrong result (checks the wrong branch, lints the wrong tree, silently
no-ops because a binary "isn't there"). A hook that resolves the project
root from `CLAUDE_PROJECT_DIR`/`process.cwd()` alone instead of preferring
`event.cwd` will deny or misfire on every worktree session, because it keeps
checking the *original* checkout instead of the one the session is actually
in.

## The three values, and what each actually tracks

| Value | Tracks | Stable across a session? |
| --- | --- | --- |
| `event.cwd` (from the hook's stdin JSON) | The live working directory Claude Code attaches to *this specific* tool-invocation event. Tracks `EnterWorktree`/`ExitWorktree` immediately. | No — by design. Changes when the session switches worktrees. |
| `process.env.CLAUDE_PROJECT_DIR` | The project root, pinned once for the whole session. | Yes — stays the original root even after `EnterWorktree`. |
| `process.cwd()` | The *hook subprocess's own* launch-time working directory — an implementation detail of however Claude Code spawned this particular hook process. | Unreliable. Not guaranteed to equal either of the above. |

A fourth value, `event.session_id`, sits outside this table because it isn't a *directory* — it identifies the session itself. Purpose B below resolves state through it (via `sessionScratchDir(event.session_id)`), not through any of the three directory values above, precisely because none of the three is both stable within a session AND unique across parallel sessions of the same project.

## Three purposes — resolve them differently, never merge them

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
`sessionScratchDir(sessionId)` from `.claude/hooks/session-scratch.mjs`,
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
- A hash of `CLAUDE_PROJECT_DIR` stays stable across worktree entry *within
  one session* — but `CLAUDE_PROJECT_DIR` is identical across **parallel**
  sessions of the same project (root + worktree A + worktree B). Two
  parallel sessions hashing to the same file silently mix each other's
  state: session B's edited-file paths leak into session A's lint target
  list, a SQL-review flag set by session A suppresses session B's own
  review, etc. `event.session_id` is unique per session (including per
  worktree session), so keying on it directly — with no hash needed at all —
  avoids both the worktree-entry-drift problem AND the parallel-session
  collision.

**Purpose C — project-wide, cross-worktree, cross-session resource.** "Where
does this durable, project-level resource live?" This must be the SAME
resource regardless of which worktree the session is in, AND it must survive
after the session (and the worktree) that touched it is gone — the opposite
of Purpose A (must track the live worktree) and of Purpose B (must not
outlive the session that owns it).

```js
const cwdArg = typeof event.cwd === "string" && event.cwd ? event.cwd : "";
const projectRoot = process.env.CLAUDE_PROJECT_DIR || cwdArg || process.cwd();
// use projectRoot to locate the resource itself (e.g. <projectRoot>/.vault-obsidian),
// never event.cwd first.
```

This is the mirror image of the Purpose A snippet — `CLAUDE_PROJECT_DIR` goes
first, `event.cwd` is only the fallback. Why: a worktree checkout does not
carry gitignored paths (git never copies gitignored files/directories into a
new worktree), so a project-wide resource that lives under a gitignored
directory (e.g. `.vault-obsidian/`) simply does not exist under a worktree's
`event.cwd`. Resolving `event.cwd` first means the resource-presence check
fails on every worktree session, the hook exits 0 silently, and the whole
pipeline becomes a permanent no-op there — with no error, ever. Resolving
`CLAUDE_PROJECT_DIR` first finds the one true copy at the root checkout
regardless of which worktree the session is in.

**If a single hook needs more than one of these** (e.g. an operational
command AND a shared flag-file lookup, or a shared flag-file lookup AND a
project-wide resource), keep them as separate, distinctly named variables —
never let one purpose's value leak into another's path. See
`.claude/hooks/large-file-warning.mjs` for a worked example of an A+B split.

## Which one do you have? A quick test

Ask: "if the session enters or leaves a worktree mid-session, should this
value change?"

- Yes → Purpose A, use `event.cwd` first.
- No, and the value only needs to correlate two hook invocations *within the
  same session*, then can be thrown away → Purpose B, use
  `sessionScratchDir(event.session_id)`.
- No, and the value must stay identical across every worktree of the project
  AND survive after the session (and worktree) that touched it is gone →
  Purpose C, use `CLAUDE_PROJECT_DIR` first.

## Canonical examples in this codebase

- Pure Purpose A: `guard-main-branch.mjs`, `worktree-write-guard.mjs`.
- Purpose A + B split in the same file: `large-file-warning.mjs`.
- Pure Purpose B (correctly never touches `event.cwd` or `CLAUDE_PROJECT_DIR`
  for the flag path — only `sessionScratchDir(sessionId)`):
  `set-files-changed.mjs`, `memory-stop.mjs`.
- Pure Purpose C: `vault-orient.mjs`, `compile.mjs` (if the Obsidian pillar
  is installed) — the vault, `.mcp.json`, and any project-wide cache file are
  all resolved from `projectRoot` alone.

## Forbidden

- Don't resolve an operational directory from `CLAUDE_PROJECT_DIR`/`process.cwd()` alone when `event.cwd` is available — that is this exact bug.
- Don't key Purpose-B shared state on `event.cwd` — that breaks cross-invocation state correlation.
- Don't key Purpose-B shared state on a hash of `CLAUDE_PROJECT_DIR` (or any other project-identity value) — that collides across parallel sessions of the same project. Use `sessionScratchDir(event.session_id)`.
- Don't resolve a Purpose-C project-wide resource from `event.cwd` first — a worktree typically lacks its own copy of a gitignored resource, so cwd-first silently and *permanently* no-ops the whole pipeline for every worktree session, with no error.
- Don't invent a fourth resolution order per file. Use the three patterns above, verbatim.

## Acceptance criteria

- Every operational directory resolution prefers `event.cwd`, matching the Purpose A snippet above.
- Every Purpose-B shared state key uses `sessionScratchDir(event.session_id)`, matching the Purpose B snippet above — never `CLAUDE_PROJECT_DIR` or `event.cwd`.
- Every Purpose-C project-wide resource resolves `CLAUDE_PROJECT_DIR` before `event.cwd`, matching the Purpose C snippet above — never `event.cwd` first.
- A hook mixing more than one purpose uses distinctly named variables per purpose, never one shared variable.
