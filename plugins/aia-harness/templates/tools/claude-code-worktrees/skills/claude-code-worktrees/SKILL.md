---
name: claude-code-worktrees
description: This skill should be used when the user asks about "worktree", "worktrees", "sessões paralelas com worktree", "--worktree flag", "EnterWorktree", "ExitWorktree", ".worktreeinclude", "WorktreeCreate hook", "WorktreeRemove hook", "worktree.baseRef", "isolate subagents", "isolation worktree", "sessões isoladas no Claude Code", "rodar Claude em paralelo com worktrees", or any question about running parallel Claude Code sessions in isolated git worktrees.
version: 0.1.0
---

# Claude Code — Git Worktrees

Skill for **answering questions** and **performing utility actions** about worktrees in Claude Code.

> To create an isolated workspace before implementing features, use `superpowers:using-git-worktrees`.
> This skill covers Claude Code's native features: CLI flags, tools, hooks, configuration, and subagents.

---

## Quick concept

A git worktree is a separate working directory with its own branch, sharing the same history and remote as the main repo. Each Claude Code session in its own worktree avoids edit collisions between parallel sessions.

---

## Starting Claude in a worktree

### `--worktree` / `-w` flag

```bash
# Creates worktree at .claude/worktrees/feature-auth/ with branch worktree-feature-auth
claude --worktree feature-auth

# Second isolated session in parallel
claude --worktree bugfix-123

# Auto-generated name (e.g. bright-running-fox)
claude --worktree
```

Add `.claude/worktrees/` to `.gitignore` so it does not appear as untracked in the main checkout.

### First time in a directory

Before using `--worktree` in a new directory, run `claude` once to accept the workspace trust dialog. Without this, `--worktree` exits with an error.

### Worktree base branch

By default, the worktree starts from `origin/HEAD` (clean remote). To change:

```json
{
  "worktree": {
    "baseRef": "head"
  }
}
```

`"head"` → starts from local `HEAD` (includes unpushed commits). Only accepts `"fresh"` or `"head"`.

### Worktree from a PR

```bash
# By PR number
claude --worktree "#1234"

# Or by full GitHub PR URL
claude --worktree "https://github.com/org/repo/pull/1234"
```

Creates worktree at `.claude/worktrees/pr-1234` by fetching `pull/1234/head`.

---

## Copying gitignored files to worktrees

Worktrees are clean checkouts — `.env`, `.env.local`, etc. **are not present**. To copy them automatically, create `.worktreeinclude` at the project root:

```text
.env
.env.local
config/secrets.json
```

Uses `.gitignore` syntax. Only copies files that are **also** in `.gitignore` — tracked files are never duplicated.

Applies to: `--worktree`, subagent worktrees, and parallel sessions in the desktop app.

---

## Native tools (within a session)

During a Claude Code session, ask Claude:

- `"work in a worktree"` → Claude uses the `EnterWorktree` tool to create and enter a worktree
- `"exit worktree"` → Claude uses `ExitWorktree`

Subagents created with the `Agent tool` with `isolation: "worktree"` receive temporary worktrees automatically.

---

## Subagent isolation

### Ad-hoc (asking Claude)

> "use worktrees for your agents"

### Permanent in a custom subagent

Agent frontmatter:

```yaml
isolation: worktree
```

Each subagent receives a temporary worktree removed automatically upon finishing **without changes**.

Subagent worktrees start from the same `baseRef` configured for `--worktree`.

---

## Cleanup and lifecycle

| State on exit | Behavior |
|---------------|----------|
| No commits, no changes, no untracked files | Worktree and branch removed automatically |
| Session has name (`--name`) + no changes | Claude asks before removing |
| Has commits or changes | Claude asks: keep or remove |
| Non-interactive run (`--worktree` + `-p`) | Does **not** clean up automatically — remove manually |

Clean up non-interactive worktree:
```bash
git worktree remove .claude/worktrees/worktree-name
```

Orphaned subagent worktrees (crash/interruption) are removed on the next startup if they are older than `cleanupPeriodDays` and have no changes.

---

## Manual management with git

```bash
# Create worktree on new branch
git worktree add ../project-feature-a -b feature-a

# Create worktree from existing branch
git worktree add ../project-bugfix bugfix-123

# Start Claude in the worktree
cd ../project-feature-a && claude

# List worktrees
git worktree list

# Remove worktree
git worktree remove ../project-feature-a
```

Each new worktree needs project setup (deps, virtual env, etc.).

---

## Hooks for advanced customization

### `WorktreeCreate`

Replaces the default `git worktree add` logic. Useful for: non-git VCS (SVN, Perforce, Mercurial), custom placement, custom branch logic.

Receives JSON via stdin with the `name` field. Must print the created directory path to stdout.

SVN example:
```json
{
  "hooks": {
    "WorktreeCreate": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "bash -c 'NAME=$(jq -r .name); DIR=\"$HOME/.claude/worktrees/$NAME\"; svn checkout https://svn.example.com/repo/trunk \"$DIR\" >&2 && echo \"$DIR\"'"
          }
        ]
      }
    ]
  }
}
```

### `WorktreeRemove`

Partner of `WorktreeCreate` — cleans up at end of session.

> When `WorktreeCreate` is configured, `.worktreeinclude` is **not** processed automatically. Copy local configs inside the hook script.

---

## Desktop App

The desktop app creates a worktree for **each new session** automatically — no flag needed. See [desktop parallel sessions](/en/desktop#work-in-parallel-with-sessions).

---

## Additional references

- **`references/worktree-reference.md`** — full scenario table, troubleshooting, and comparison with subagents/agent teams
