---
description: Safely remove worktree — validates no lost work
argument-hint: "[branch|issue-number|path]"
allowed-tools: Bash(gh *), Bash(git *), Bash(bash *)
---

Config PM: !`cat .claude/pm-config.json 2>/dev/null || echo "NOT_FOUND"`
Worktrees: !`git worktree list 2>/dev/null`
Current branch: !`git branch --show-current`

Use the `github-pm` skill to safely remove the worktree.
Argument: `$ARGUMENTS` (branch, issue number, path, or empty for the current worktree).

**Worktree-safe execution:** run every `git` command below as its own separate,
plain Bash call — never chain two of them with `&&`, `;`, or `$(...)` command
substitution. A worktree-isolated session refuses any command it cannot statically
verify stays inside the worktree, and a compound git invocation (variable assigned
from a git command substitution, then reused) is exactly what gets refused. Every
`<PLACEHOLDER>` below is a value **you** substitute literally into the command
before running it — never a shell variable. A shell variable does not survive from
one Bash call to the next, so writing `"$WT_PATH"` would expand to an empty string
and silently target the wrong thing.

**NEVER skip the gates below:**

**Step 1 — Safety gate**

```bash
node .claude/skills/github-pm/scripts/worktree-safety-check.mjs "$ARGUMENTS" "<OWNER>/<REPO>"
```

- Exit 0 → read WT_PATH and WT_BRANCH from stdout and keep them for the
  `<WT_PATH>` / `<WT_BRANCH>` substitutions below, then proceed
- Exit 1 → BLOCK. Show checklist ✅/❌. Stop without removing.
- Exit 2 → worktree not found. List available worktrees with `git worktree list`.

**Step 2 — Exit the worktree (if the session is inside it)**
Check if `$CLAUDE_WORKTREE_PATH` matches WT_PATH.
If yes: ExitWorktree with action "keep" before any removal.

**Step 3 — Gate 2: clean main checkout**

`<MAIN_ROOT>` is the path on the **first** line of the `Worktrees:` list in the
dynamic context above, and `<DEFAULT_BRANCH>` is the branch that same line shows
in brackets (`main` on most repos, `master` on older ones) — `git worktree list`
always prints the main checkout first, linked worktrees after. Do not compute
either with `git rev-parse --show-toplevel`: besides needing a `$(...)` that gets
refused, it returns the *current* worktree's root, which is the wrong tree
whenever this command runs from inside any worktree — including the common case
of removing worktree B while the session sits in worktree A.

```bash
git -C "<MAIN_ROOT>" status --porcelain
```

If dirty → ABORT: "Main checkout has unsaved changes."

Then update it — two separate commands, run one at a time (not joined by `&&`):

```bash
git -C "<MAIN_ROOT>" checkout <DEFAULT_BRANCH>
```

```bash
git -C "<MAIN_ROOT>" pull --ff-only
```

**Step 4 — Remove**

Three separate commands, one Bash call each, with `<WT_PATH>` and `<WT_BRANCH>`
substituted from Step 1:

```bash
git worktree remove --force "<WT_PATH>"
```

```bash
git branch -D "<WT_BRANCH>"
```

```bash
git worktree prune
```

**Step 5 — Confirm**

```bash
git worktree list
```

Inform the user that the worktree has been removed.

CRITICAL RULES:

- NEVER `rm -rf` before Step 2 (exit first)
- NEVER remove with a red checklist — list what is missing
- DO NOT delete the remote branch (already removed by merge with --delete-branch)
