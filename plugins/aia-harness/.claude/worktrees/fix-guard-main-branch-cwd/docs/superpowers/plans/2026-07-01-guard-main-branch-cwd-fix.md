# guard-main-branch cwd Resolution Fix Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Fix `templates/hooks/guard-main-branch.mjs` so it checks the branch of
the worktree/directory a `git commit`/`git push` is actually about to run in,
not the directory the Claude Code backend process happened to launch from.

**Bug report (field-observed, verbatim diagnosis from the affected agent):**
An agent working inside an isolated worktree (`worktree-landing-animations`)
had every `git commit` denied by `guard-main-branch`, even though it was
correctly positioned in its feature-branch worktree. Root cause it
self-diagnosed: the hook resolves `cwd` via `CLAUDE_PROJECT_DIR` (unset in
that environment) → falls back to `process.cwd()` of the hook's own
subprocess, which is anchored to the *original checkout*, not the worktree.
The original checkout had since moved to `main` (a different agent had
finished and merged there), so the hook started denying every commit from
every worktree session, system-wide, until someone fixed it from outside.

**Root cause (confirmed by reading the code):** `currentBranch()` in
`templates/hooks/guard-main-branch.mjs` (line ~38-49) runs
`git branch --show-current` with
`cwd: process.env.CLAUDE_PROJECT_DIR ?? process.cwd()`. Neither value
reflects the live working directory of the specific tool call being guarded.
Claude Code attaches that live directory to every hook event as `event.cwd`.
Four sibling hooks in this exact file already rely on this and document it
explicitly: `worktree-session-ctx.mjs`, `worktree-prompt-ctx.mjs`,
`worktree-subagent-ctx.mjs`, and `worktree-write-guard.mjs` all read
`event.cwd` with the comment "Claude Code propagates the dynamic cwd into
every hook event." `guard-main-branch.mjs` is the only cwd-touching hook that
never reads `event.cwd` — it is the outlier, not a novel case.

**Architecture:** Single hook file logic fix + matching regression tests.
No catalog, settings, or output-schema changes: the hook is already
registered in `lib/data/project-catalog.mjs` and wired in
`lib/generate/settings.mjs`; only its *input* resolution (which directory to
check) is wrong, not its output shape.

**Tech Stack:** Node.js ESM (`.mjs`), `node --test` + `node:assert/strict`,
existing `tests/hook-runner.mjs` harness (`runHook`, `mkGitRepo`).

## Global Constraints

- All source code must be in English.
- Hook remains `.mjs`, exec-form only, fail-open on any I/O/parse error — do not change these invariants (see `.claude/rules/hooks-cross-platform.md`).
- Preserve exact current behavior when `event.cwd` is absent/empty: fall back to `process.env.CLAUDE_PROJECT_DIR`, then `process.cwd()`, unchanged. All 12 existing tests in `tests/hook-guard-main-branch.test.mjs` must keep passing **without modification** — they never set `event.cwd`, so they exercise exactly this fallback path.
- Output schema is unchanged (still either empty stdout pass-through, or `hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: "deny", permissionDecisionReason }`). No changes needed to `lib/validate/hook-schema.mjs` or the CLAUDE.md hook-type table.
- No new files. No catalog/settings changes — the hook is already registered.
- Do not add a test for a non-string/malformed `event.cwd` value: Claude Code only ever sends a string `cwd` or omits the field entirely, and `event?.cwd || ...` already falls through safely for any falsy value (`undefined`, `""`); a truthy non-string is not a shape Claude Code sends. Adding a speculative third input-shape test would be speculative coverage, not regression coverage — YAGNI.
- Use the fix verbatim as given below (already hand-validated on the affected target project) — do not substitute a stricter `typeof event?.cwd === "string"` variant even though sibling hooks use that idiom; fidelity to the field-tested fix matters more here than idiom consistency.
- `npm test` must pass (924 tests baseline recorded on this worktree before starting).

---

### Task 1: Resolve branch from `event.cwd` first in `guard-main-branch.mjs`

**Files:**
- Modify: `templates/hooks/guard-main-branch.mjs`
- Modify: `tests/hook-guard-main-branch.test.mjs`

**Context:**
`templates/hooks/guard-main-branch.mjs` is a `PreToolUse` hook (matcher
`Bash`) that denies direct `git commit`/`git push` to `main`/`master`. It
already parses the incoming hook event JSON into a top-level `event` variable
(line 22-28) before `currentBranch()` is defined, so `event` is in scope
inside `currentBranch()` with no restructuring needed.

**Exact change to `templates/hooks/guard-main-branch.mjs`:**

Replace:

```js
/** @returns {string} */
function currentBranch() {
  try {
    return execFileSync("git", ["branch", "--show-current"], {
      cwd: process.env.CLAUDE_PROJECT_DIR ?? process.cwd(),
      encoding: "utf8",
      timeout: 5000,
      windowsHide: true,
    }).trim();
  } catch {
    return "";
  }
}
```

With (this is the exact fix already field-validated by hand on the affected
target project — use it verbatim, comment included):

```js
/** @returns {string} */
function currentBranch() {
  // event.cwd reflects the session's actual active directory (tracks EnterWorktree);
  // $CLAUDE_PROJECT_DIR stays pinned to the original repo root for the whole session,
  // so preferring it here would check the wrong checkout's branch when the session
  // has switched into a git worktree.
  const dir = event?.cwd || process.env.CLAUDE_PROJECT_DIR || process.cwd();
  try {
    return execFileSync("git", ["branch", "--show-current"], {
      cwd: dir,
      encoding: "utf8",
      timeout: 5000,
      windowsHide: true,
    }).trim();
  } catch {
    return "";
  }
}
```

No header doc-comment rewrite is needed: the inline comment above `const dir`
carries the explanation, right next to the non-obvious line it explains —
don't also duplicate it into the file's top-of-file docstring.

**Add two regression tests to `tests/hook-guard-main-branch.test.mjs`,**
placed after the existing "Output path 5" tests (end of file, before the
final closing of the last test block). Use `mkGitRepo` (already imported)
to build two *separate* git repos per test — one standing in for
`CLAUDE_PROJECT_DIR` (the original checkout) and one standing in for
`event.cwd` (the worktree) — so the two are provably independent:

1. **`event.cwd` (worktree, feature branch) must override `CLAUDE_PROJECT_DIR`
   (main) → pass through.** This is the exact field-reported regression:
   original checkout sits on `main`, the actual commit runs from a
   feature-branch worktree, and the hook must not block it.

   ```js
   test("guard-main-branch: event.cwd (worktree, feature branch) overrides CLAUDE_PROJECT_DIR (main) → pass through, schema-valid", () => {
     const projectDir = mkGitRepo("main");
     const worktreeDir = mkGitRepo("feature/my-feature");
     try {
       const r = runHook(
         HOOK,
         { cwd: worktreeDir, tool_input: { command: 'git commit -m "feat: add thing"' } },
         { env: { CLAUDE_PROJECT_DIR: projectDir } },
       );
       assertPassThrough(r);
     } finally {
       fs.rmSync(projectDir, { recursive: true, force: true });
       fs.rmSync(worktreeDir, { recursive: true, force: true });
     }
   });
   ```

2. **`event.cwd` on `main` must still deny even when `CLAUDE_PROJECT_DIR`
   points at a feature branch** — proves the fix actually checks
   `event.cwd`'s branch (not just "ignore `CLAUDE_PROJECT_DIR`").

   ```js
   test("guard-main-branch: event.cwd on main overrides CLAUDE_PROJECT_DIR feature branch → denies (hard-blocks), schema-valid", () => {
     const projectDir = mkGitRepo("feature/other-work");
     const worktreeDir = mkGitRepo("main");
     try {
       const r = runHook(
         HOOK,
         { cwd: worktreeDir, tool_input: { command: 'git commit -m "oops"' } },
         { env: { CLAUDE_PROJECT_DIR: projectDir } },
       );
       assertDenyPermission(r);
     } finally {
       fs.rmSync(projectDir, { recursive: true, force: true });
       fs.rmSync(worktreeDir, { recursive: true, force: true });
     }
   });
   ```

Both tests pass `cwd` as a top-level field of the event object given to
`runHook` (its second argument is JSON-serialized verbatim to the hook's
stdin), exactly like `event.tool_input` is passed today.

- [ ] **Step 1: Apply the `currentBranch()` change** described above, verbatim
  including the inline comment.

- [ ] **Step 2: Add the two regression tests** described above to
  `tests/hook-guard-main-branch.test.mjs`.

- [ ] **Step 3: Run the focused test file, then the full suite**

  ```bash
  node --test tests/hook-guard-main-branch.test.mjs
  npm test
  ```
  Expected: 14/14 in the focused file, 926/926 in the full suite (924
  baseline + 2 new), 0 failures, typecheck and lint clean.

- [ ] **Step 4: Commit**

  ```bash
  git add templates/hooks/guard-main-branch.mjs tests/hook-guard-main-branch.test.mjs
  git commit -m "fix(hook): guard-main-branch resolves branch from event.cwd, not launch-dir cwd"
  ```
