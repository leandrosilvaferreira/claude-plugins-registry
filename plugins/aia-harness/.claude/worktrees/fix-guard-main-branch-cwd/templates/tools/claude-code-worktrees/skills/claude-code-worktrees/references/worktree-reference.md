# Complete Reference — Claude Code Worktrees

## Scenario and action table

| Goal | Action |
|------|--------|
| New isolated session | `claude --worktree feature-name` |
| Auto-generated name | `claude --worktree` |
| Start from specific PR | `claude --worktree "#1234"` |
| Copy `.env` to worktrees | Create `.worktreeinclude` at project root |
| Start from local HEAD | `worktree.baseRef: "head"` in settings |
| Ad-hoc isolated subagent | Ask: "use worktrees for your agents" |
| Permanent isolated subagent | `isolation: worktree` in frontmatter |
| Enter worktree mid-session | Ask: "work in a worktree" (uses `EnterWorktree`) |
| Exit worktree mid-session | Ask: "exit worktree" (uses `ExitWorktree`) |
| Clean up non-interactive worktree | `git worktree remove .claude/worktrees/name` |
| List active worktrees | `git worktree list` |
| Non-git VCS | Configure `WorktreeCreate` + `WorktreeRemove` hooks |
| Parallel sessions without configuration | Desktop app (creates worktree per session automatically) |

---

## Comparison: Worktrees vs Subagents vs Agent Teams

| Aspect | Worktrees | Subagents | Agent Teams |
|--------|-----------|-----------|-------------|
| What they isolate | File edits | Delegated work | Session coordination |
| When to use | Parallel sessions with file conflict | Delegate task within session | Multiple coordinated Claudes |
| Creation | `--worktree` flag or `EnterWorktree` | `Agent tool` with `isolation: worktree` | Team configuration |
| Cleanup | Automatic (with changes = asks) | Automatic on finishing without changes | Manual |

---

## Directory structure created

```
project/
├── .claude/
│   └── worktrees/
│       ├── feature-auth/     # claude --worktree feature-auth
│       ├── bugfix-123/       # claude --worktree bugfix-123
│       └── pr-1234/          # claude --worktree "#1234"
├── .worktreeinclude          # gitignored files to copy
└── .gitignore                # must include .claude/worktrees/
```

---

## `.worktreeinclude` — Syntax and behavior

```text
# Comment
.env
.env.local
config/secrets.json
*.local
```

**Rules:**
- Uses `.gitignore` syntax
- Only copies if the file is **also** in `.gitignore`
- Tracked files are never duplicated
- Applies to: `--worktree`, subagent worktrees, desktop app

---

## `worktree.baseRef` — Details

Configuration in `settings.json` (project or user):

```json
{
  "worktree": {
    "baseRef": "fresh"
  }
}
```

| Value | Behavior |
|-------|----------|
| `"fresh"` (default) | Starts from `origin/HEAD` — clean checkout from remote |
| `"head"` | Starts from local `HEAD` — includes unpushed commits and feature branch state |

**Fallback:** If no remote is configured or the fetch fails, falls back to local `HEAD` regardless of config.

---

## Complete lifecycle of a `--worktree` worktree

```
claude --worktree name
  ↓
Check workspace trust (already accepted?)
  ↓
Fetch origin/HEAD (or use local HEAD if baseRef=head)
  ↓
git worktree add .claude/worktrees/name -b worktree-name
  ↓
Copy files from .worktreeinclude
  ↓
Start Claude session in the worktree directory
  ↓
[work happens]
  ↓
User exits (Ctrl+C / /exit)
  ↓
Has changes/commits?
  ├── No + no session name → removes automatically
  ├── No + has session name → asks
  └── Yes → asks (keep or remove)
```

---

## Subagent worktree lifecycle

```
Agent tool called with isolation: "worktree"
  ↓
Temporary worktree created (same baseRef as --worktree)
  ↓
Subagent executes
  ↓
Finished without changes? → removes automatically
Finished with changes? → returns path + branch in result
  ↓
Orphaned subagents (crash) → removed on startup
  if: older than cleanupPeriodDays
     AND no uncommitted changes
     AND no untracked files
     AND no unpushed commits
```

---

## `WorktreeCreate` / `WorktreeRemove` hooks

### Input schema (`WorktreeCreate`)

JSON via stdin:
```json
{
  "name": "worktree-name"
}
```

### Expected output (`WorktreeCreate`)

Absolute path of the created directory, printed to stdout:
```
/home/user/.claude/worktrees/worktree-name
```

### `WorktreeRemove` — Input schema

```json
{
  "name": "worktree-name",
  "path": "/home/user/.claude/worktrees/worktree-name"
}
```

### Complete SVN example

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
    ],
    "WorktreeRemove": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "bash -c 'PATH=$(jq -r .path); rm -rf \"$PATH\"'"
          }
        ]
      }
    ]
  }
}
```

> When `WorktreeCreate` is active: `.worktreeinclude` is **not** processed. Copy configs inside the hook.

---

## Troubleshooting

### `--worktree` fails with trust error

```
Error: Workspace trust not accepted
```

Solution: Run `claude` (without flags) in the directory once and accept the dialog.

### Worktree appears as untracked in main checkout

Add to `.gitignore`:
```
.claude/worktrees/
```

### Non-interactive worktree does not clean up

`--worktree` with `-p` (non-interactive) does not perform automatic cleanup. Remove manually:
```bash
git worktree remove .claude/worktrees/name
# or
git worktree prune  # removes entries for already-deleted worktrees
```

### Subagent with `isolation: worktree` failed mid-run

The orphaned worktree remains at `.claude/worktrees/`. It will be removed on the next Claude startup if it has no changes and is older than `cleanupPeriodDays`. To remove now:
```bash
git worktree list  # locate it
git worktree remove .claude/worktrees/generated-name
```

### `.worktreeinclude` is not copying the file

Check:
1. Is the file in `.gitignore`?
2. Is the file not tracked by git?
3. Is `.worktreeinclude` at the **root** of the repo?
4. Is the `.worktreeinclude` syntax correct (test with `git check-ignore -v file`)?

### Changing the base branch of an already-created worktree

Existing worktrees do not change retroactively. `baseRef` only affects new worktrees. To recreate:
```bash
git worktree remove .claude/worktrees/name
claude --worktree name  # recreates with current baseRef
```

---

## Relevant settings in `settings.json`

```json
{
  "worktree": {
    "baseRef": "fresh"
  },
  "cleanupPeriodDays": 7
}
```

| Field | Default | Description |
|-------|---------|-------------|
| `worktree.baseRef` | `"fresh"` | Base branch: `"fresh"` = origin/HEAD, `"head"` = local HEAD |
| `cleanupPeriodDays` | 7 | Days before orphaned subagent worktrees are cleaned up on startup |

---

## Checklist: Project setup for worktrees

```bash
# 1. Add to .gitignore
echo ".claude/worktrees/" >> .gitignore

# 2. Create .worktreeinclude (if needed)
cat > .worktreeinclude << 'EOF'
.env
.env.local
config/secrets.json
EOF

# 3. Verify .worktreeinclude works
git check-ignore -v .env  # should show .gitignore

# 4. Test first worktree
claude --worktree test-setup

# 5. Verify .env was copied
ls .claude/worktrees/test-setup/.env
```
