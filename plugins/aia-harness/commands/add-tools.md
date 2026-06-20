---
description: Install project-level token-economy / code-graph tools (caveman, ponytail, rtk, graphify). Vendor+wire is automatic; binary/pkg installs run after one confirmation.
argument-hint: "[path]"
allowed-tools:
  - Bash
  - Read
  - Edit
  - AskUserQuestion
---

# Add project-level tools

Target directory: `$1` if provided, else `$CLAUDE_PROJECT_DIR`. **Everything stays
project-level** — never install to `~/.claude` or user scope.

## 1. Vendor + wire (automatic, offline)

Apply the file-based tools (caveman, ponytail) and the guarded rtk hook directly
into the repo via the engine:

```bash
"${CLAUDE_PLUGIN_ROOT}/bin/aia-harness" apply "${1:-$CLAUDE_PROJECT_DIR}" --yes
```

This copies caveman/ponytail skills → `.claude/skills/`, their hooks →
`.claude/hooks/<tool>/`, wires `SessionStart`/`UserPromptSubmit` (and the guarded
rtk `PreToolUse`) into `.claude/settings.json`, and writes `.graphifyignore`.
To scope which tools: `--tools=caveman,ponytail` or `--no-tools`.

## 2. Detect machine dependencies

Report what each needs and what is present:

```bash
command -v node; command -v rtk; command -v uv || command -v pipx; command -v graphify
```

- **caveman / ponytail** — need only `node` (already vendored + wired). Done.
- **rtk** — needs the `rtk` binary. The hook is already wired and **no-ops until the
  binary exists**, so this is optional.
- **graphify** — needs `uv` (or pipx) + the `graphifyy` package.

## 3. One confirmation, then install machine deps

Use a single `AskUserQuestion` to confirm which machine installs to run. Only on
approval, run the approved commands:

**rtk** (binary):
```bash
brew install rtk   # macOS; or: curl -fsSL https://raw.githubusercontent.com/rtk-ai/rtk/refs/heads/master/install.sh | sh
```

**graphify** (project-level), from the target dir:
```bash
uv tool install graphifyy
graphify install --project          # skill into .claude/skills/graphify/
graphify claude install             # make Claude Code always use the graph
graphify hook install               # auto-rebuild on git commit + graph.json merge driver
graphify .                          # build the graph
```
Then add `graphify-out/` to git (commit it; `graphify-out/cost.json` is gitignored).

Never run any installer without the confirmation. After installing, remind the
user to **restart Claude Code** so new hooks/skills load.
