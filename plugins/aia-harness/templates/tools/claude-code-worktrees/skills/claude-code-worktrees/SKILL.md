---
name: claude-code-worktrees
description: This skill should be used when the user asks to create, enter, switch to, or exit a worktree ("work in a worktree", "create a worktree", "enter the worktree X", "exit the worktree") — acting on that request means calling the EnterWorktree tool, never `git worktree add` — and when the user asks about "worktree", "worktrees", "parallel sessions with worktree", "--worktree flag", "EnterWorktree", "ExitWorktree", ".worktreeinclude", "WorktreeCreate hook", "WorktreeRemove hook", "worktree.baseRef", "isolate subagents", "isolation worktree", "isolated sessions in Claude Code", "run Claude in parallel with worktrees", or any question about running parallel Claude Code sessions in isolated git worktrees.
version: 0.2.0
---

# Claude Code — Git Worktrees

Skill for **acting on worktree requests** (create / enter / switch / exit) and for **answering questions** about worktrees in Claude Code.

> `superpowers:using-git-worktrees` decides *whether* a task needs an isolated workspace.
> This skill is how the isolation is actually performed here — its "git worktree fallback"
> path must not be used in this project (see [Creating or entering a worktree](#creating-or-entering-a-worktree--required-path)).

---

## Quick concept

A git worktree is a separate working directory with its own branch, sharing the same history and remote as the main repo. Each Claude Code session in its own worktree avoids edit collisions between parallel sessions.

---

## Creating or entering a worktree — required path

When the user asks to "create a worktree", "work in a worktree", "enter the worktree
`<name>`", or anything equivalent, the **only** correct action is the `EnterWorktree` tool.
Never `git worktree add`, never `cd` into a worktree directory, never launch a second
`claude` process to get there.

| Situation | Call |
|---|---|
| Create a new worktree | `EnterWorktree({ name: "feature-auth" })` |
| Enter or switch to an existing one | `EnterWorktree({ path: ".claude/worktrees/feature-auth" })` |
| User gave no name | `EnterWorktree({})` — Claude Code generates one |
| Leave (**only** when the user asks) | `ExitWorktree({ action: "keep" \| "remove" })` |

Constraints the tool itself enforces:

- A **new** worktree (`name`) cannot be created while the session is already inside one — switch with `path`, or `ExitWorktree` first.
- `path` must already appear in `git worktree list` for this repository.
- A `path` outside the repo's `.claude/worktrees/` prompts the user every time; no permission rule suppresses it (only `bypassPermissions` mode skips it).
- Re-entering an existing name/path opens that worktree instead of creating a new one.

### Why the tool, and not `git worktree add`

`EnterWorktree` is what fires this project's worktree hooks — raw git fires nothing. A
worktree created by hand is a bare tracked-files checkout: no `node_modules`, no
`.husky/_` (native git hooks silently **inactive**), no `.env`, no `.docker`, no
`graphify-out`.

Two wirings in `.claude/settings.json` route to the same `.claude/hooks/worktree-create.mjs`:

| Event | Fires on | Role |
|---|---|---|
| `WorktreeCreate` | `--worktree`, subagents with `isolation: "worktree"`, background sessions — **replaces** the native `git worktree add` | creates the worktree, seeds it, prints its absolute path on stdout |
| `PostToolUse` (matcher `EnterWorktree`) | **every** `EnterWorktree` call, `name` or `path` | idempotent re-seed safety net — this is what covers the in-session tool |

The official hook docs list `WorktreeCreate`'s triggers as `--worktree` / `isolation:
"worktree"` / background sessions, **not** `EnterWorktree` — the `PostToolUse` wiring is
what makes in-session entry seed correctly, and it is idempotent, so both firing is
harmless.

What the hook seeds, each skipped if already present:

- `node_modules` — copied with every symlink dereferenced (never symlinked: `.bin/*` pointing back at the root's copy yields two module instances in one process). No root `node_modules` → background `npm`/`pnpm`/`yarn`/`bun install` per lockfile.
- `.husky/_` — Husky's generated shim, otherwise `pre-commit`/`pre-push` are silently skipped in the worktree.
- `.docker`, `graphify-out` (plus a background `graphify update .`).
- Every `.worktreeinclude` pattern — the hook reimplements that copy, because configuring `WorktreeCreate` disables Claude Code's native `.worktreeinclude` processing.

**Recovering a hand-made worktree**: call `EnterWorktree({ path })` on it. The
`PostToolUse` pass seeds it in place — no need to delete and recreate.

Confirm the wiring exists before relying on it: `WorktreeCreate` and a `PostToolUse`
entry with matcher `EnterWorktree`, both in `.claude/settings.json`.

### After entering — verify, then keep paths explicit

1. **Check the base ref.** `git -C <worktree-path> rev-parse HEAD` must match the tip you expect from the main checkout. A stale base silently drops unpushed commits; fix with `git -C <worktree-path> merge <branch> --ff-only` rather than recreating.
2. **Never rely on an inherited cwd.** The session's Bash cwd can drift back to the main checkout with no `cd` issued. Every git-mutating command uses `git -C "<worktree-abs-path>" …`, or an explicit `cd "<path>" && …` chained in the *same* Bash call.
3. **Subagents inherit nothing.** A subagent dispatched from a worktree session is not pinned to it — pass the absolute worktree path in the prompt, or give the agent `isolation: "worktree"` for its own. After any subagent that commits, verify with `git -C <worktree-path> log --oneline -3` instead of trusting its report.

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

`worktree.baseRef` in `settings.json` accepts only `"fresh"` or `"head"` — never a branch name:

```json
{
  "worktree": {
    "baseRef": "head"
  }
}
```

- `"fresh"` (Claude Code's default) → the repo's default branch **on the remote**. Inside a worktree, `"head"` resolves to *that worktree's* HEAD, not the main checkout's.
- `"head"` → local `HEAD`, keeping unpushed commits. A harness-scaffolded project ships this value for exactly that reason.

`worktree-create.mjs` reads the same setting itself (any read failure defaults to
`"fresh"`) and falls back to local `HEAD` whenever the remote lookup or fetch fails —
offline, no origin, or the 5s cap hit. So a `"fresh"` base is best-effort, which is why
the HEAD check in [After entering](#after-entering--verify-then-keep-paths-explicit) is
worth doing before dispatching work.

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

`EnterWorktree` / `ExitWorktree` — full procedure in
[Creating or entering a worktree](#creating-or-entering-a-worktree--required-path).
Subagents dispatched with `isolation: "worktree"` get temporary worktrees automatically.

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

> **Bypasses every hook.** Nothing below fires `WorktreeCreate` or the `EnterWorktree`
> re-seed, so the resulting worktree has no `node_modules`, no `.husky/_`, and none of the
> `.worktreeinclude` files. Use it only to inspect or clean up worktrees, or when a
> worktree must sit outside `.claude/worktrees/` or start from a specific existing branch —
> then hand it to `EnterWorktree({ path })` to get it seeded.

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

Receives JSON via stdin with the `name` field. A `"type": "command"` hook must print the
created directory path to stdout as a **bare string** — the `hookSpecificOutput.worktreePath`
JSON shape is only for `"type": "http"` hooks. A non-zero exit, or a stdout that isn't the
directory, fails worktree creation.

> This project already ships one — `.claude/hooks/worktree-create.mjs`, wired to both
> `WorktreeCreate` and `PostToolUse`/`EnterWorktree`. Extend that file rather than adding a
> second `WorktreeCreate` hook, and keep hooks as `.mjs` invoked through exec form
> (`"command": "node"` + `args`) — never the `bash -c` + `jq` shape below, which breaks on
> native Windows.

SVN example (upstream illustration for non-git VCS, not the pattern to copy here):
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
