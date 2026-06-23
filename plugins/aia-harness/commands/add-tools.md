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

## 2. Verificar dependências do sistema

```bash
"${CLAUDE_PLUGIN_ROOT}/bin/aia-harness" check "${1:-$CLAUDE_PROJECT_DIR}" \
  --tools=rtk,caveman,ponytail,graphify --json
```

Ler o JSON. Se `status === "block"`: apresentar em português a lista de `missing[]` com
`installHint` para a plataforma e encerrar sem instalar nada.

Se `status !== "block"`: prosseguir. Para cada dep em `checks[]` com `found: false`:
informar ao usuário o que está ausente (apenas recommended neste caso) e perguntar se deseja
instalar no passo 3.

## 3. One confirmation, then install machine deps

Use a single `AskUserQuestion` to confirm which machine installs to run. Only on
approval, run the approved commands:

**rtk** (binary) — cross-platform via npm (npm resolves correct platform binary automatically):

```bash
npm install -g rtk
```

macOS alternative (Homebrew):

```bash
brew install rtk
```

**graphify** (project-level), from the target dir:

```bash
uv tool install graphifyy
```

**Windows (without uv):**

```bash
pip install graphifyy
```

```bash
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
