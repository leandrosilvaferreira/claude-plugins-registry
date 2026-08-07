---
description: Safely remove worktree — validates no lost work
argument-hint: "[branch|issue-number|path]"
---

Config PM: !`cat .claude/pm-config.json 2>/dev/null || echo "NOT_FOUND"`
Worktrees: !`git worktree list 2>/dev/null`
Current branch: !`git branch --show-current`

Use the `github-pm` skill to safely remove the worktree.
Argument: `$ARGUMENTS` (branch, issue number, path, or empty for the current worktree).

**Worktree-safe execution:** run every `git` command below as its own separate,
plain Bash call — never chain two of them with `&&`, `;`, or `$(...)` command
substitution. Per the [official worktree docs](https://code.claude.com/docs/en/worktrees#how-claude-code-enforces-isolation),
Claude Code blocks any Bash command that redirects git into the main checkout —
`git -C`, `--git-dir`, a `GIT_DIR`/`GIT_WORK_TREE` variable, or a `cd` into the
main checkout before running git — plus, separately, any command it can't
otherwise verify stays inside the worktree (a live check, re-evaluated on every
attempt, not a cached verdict). **Never use `git -C`/`--git-dir` to reach the
main checkout from here** — see Step 3. Every `<PLACEHOLDER>` below is a value
**you** substitute literally into the command before running it — never a shell
variable. A shell variable does not survive from one Bash call to the next, so
writing `"$WT_PATH"` would expand to an empty string and silently target the
wrong thing.

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

Check `$CLAUDE_WORKTREE_PATH` again here — Step 2 only clears isolation when the
worktree *removed* is the one the session was in; removing a **different**
worktree while the session stays isolated elsewhere leaves it set.

- **Still set** → the session is still isolated somewhere. Do not touch the main
  checkout at all — `git -C`/`--git-dir` into it from here is refused, live, on
  every attempt (see the note above Step 1). Skip straight to Step 4, and once
  done tell the user: "Main checkout not refreshed — run `git checkout
  <DEFAULT_BRANCH>` and `git pull --ff-only` from the main checkout yourself, or
  re-run `/pm:worktree-remove` from a non-isolated session."
- **Unset** → not isolated, so the session's cwd is already the main checkout.
  Continue below with plain, unprefixed git commands — never `git -C`.

`<DEFAULT_BRANCH>` is the branch shown in brackets on the **first** line of the
`Worktrees:` list in the dynamic context above (`git worktree list` always
prints the main checkout first).

```bash
git status --porcelain
```

If dirty → ABORT: "Main checkout has unsaved changes."

Then update it — two separate commands, run one at a time (not joined by `&&`):

```bash
git checkout <DEFAULT_BRANCH>
```

```bash
git pull --ff-only
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
