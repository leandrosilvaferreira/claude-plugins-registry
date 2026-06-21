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
After building, commit the graph output so teammates share it immediately:
```bash
git add graphify-out/
git commit -m "chore: add graphify code graph"
```
**IMPORTANT — what to commit vs ignore:**

- `graphify-out/graph.json` ✅ commit — full graph, team sharing
- `graphify-out/graph.html` ✅ commit — browser visualization
- `graphify-out/GRAPH_REPORT.md` ✅ commit — architecture insights
- `graphify-out/manifest.json` ✅ commit — portable (relative paths), enables incremental updates
- `graphify-out/cost.json` ❌ already gitignored — local API cost tracker
- `graphify-out/cache/` ❌ already gitignored — regenerable, keeps repo smaller

Do NOT add a `graphify-out/` entry to `.gitignore` — only the specific files above are ignored.

Never run any installer without the confirmation. After installing, remind the
user to **restart Claude Code** so new hooks/skills load.
