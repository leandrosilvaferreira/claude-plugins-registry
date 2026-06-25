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

**NEVER skip the gates below:**

**Step 1 — Safety gate**

```bash
node .claude/skills/github-pm/scripts/worktree-safety-check.mjs \
  "$ARGUMENTS" "<OWNER>/<REPO>"
```

- Exit 0 → capture RESULT_WT_PATH and RESULT_WT_BRANCH from stdout, proceed
- Exit 1 → BLOCK. Show checklist ✅/❌. Stop without removing.
- Exit 2 → worktree not found. List available worktrees with `git worktree list`.

**Step 2 — Exit the worktree (if the session is inside it)**
Check if `$CLAUDE_WORKTREE_PATH` matches WT_PATH.
If yes: ExitWorktree with action "keep" before any removal.

**Step 3 — Gate 2: clean main checkout**

```bash
MAIN_ROOT=$(git rev-parse --show-toplevel)
git -C "$MAIN_ROOT" status --porcelain
```

If dirty → ABORT: "Main checkout has unsaved changes."

```bash
git -C "$MAIN_ROOT" checkout main && git -C "$MAIN_ROOT" pull --ff-only
```

**Step 4 — Remove**

```bash
git worktree remove --force "$RESULT_WT_PATH"
git branch -D "$RESULT_WT_BRANCH"
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
