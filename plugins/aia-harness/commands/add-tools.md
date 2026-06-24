---
description: Install token-economy / code-graph tools. Caveman and ponytail install as global Claude Code plugins; rtk hook + claude-code-worktrees are vendored project-level automatically; binary/pkg installs run after one confirmation.
argument-hint: "[path]"
allowed-tools:
  - Bash
  - Read
  - Edit
  - AskUserQuestion
---

# Add project-level tools

Target directory: `$1` if provided, else `$CLAUDE_PROJECT_DIR`. Tools are wired
project-level into `.claude/`; caveman and ponytail are additionally installed as global
Claude Code plugins (activate across all projects) — one confirmation, runs automatically.

## 1. Vendor + wire (automatic, offline)

Apply the guarded rtk hook and the claude-code-worktrees skill directly
into the repo via the engine:

```bash
"${CLAUDE_PLUGIN_ROOT}/bin/aia-harness" apply "${1:-$CLAUDE_PROJECT_DIR}" --yes
```

This wires the guarded rtk `PreToolUse` hook into `.claude/settings.json`, copies
the claude-code-worktrees skill into `.claude/skills/`, and writes `.graphifyignore`.
Caveman and ponytail are global Claude Code plugins installed in Step 3 — not vendored locally.
To scope which tools: `--no-tools`.

## 2. Verificar dependências do sistema

```bash
"${CLAUDE_PLUGIN_ROOT}/bin/aia-harness" check "${1:-$CLAUDE_PROJECT_DIR}" \
  --tools=rtk,graphify --json
```

Ler o JSON. Se `status === "block"`: apresentar em português a lista de `missing[]` com
`installHint` para a plataforma e encerrar sem instalar nada.

Se `status !== "block"`: prosseguir. Para cada dep em `checks[]` com `found: false`:
informar ao usuário o que está ausente (apenas recommended neste caso) e perguntar se deseja
instalar no passo 3.

## 3. One confirmation, then install machine deps

Use a single `AskUserQuestion` to confirm which machine installs to run. Only on
approval, run the approved commands.

**caveman** (Claude Code plugin — global, auto-activates in all projects):

```bash
claude plugin marketplace add JuliusBrussee/caveman && claude plugin install caveman@caveman
```

This installs caveman globally for Claude Code. Step 1 does not vendor caveman locally —
the plugin install here wires it globally for all your projects. Run this via Bash — do
not ask the user to copy-paste or open a terminal.

**ponytail** (Claude Code plugin — global, same command on Windows/Mac/Linux):

```bash
claude plugin marketplace add DietrichGebert/ponytail && claude plugin install ponytail@ponytail
```

Ponytail has no binary — it is pure JS hooks that run via `node`. Step 1 does not vendor
ponytail locally — the plugin install here wires it globally for all your projects. Run
via Bash — do not ask the user to copy-paste or open a terminal.

**rtk** (binary) — Rust binary, NOT on npm. Install automatically via Bash without prompting the user:

Detect platform first:

```bash
node -e "console.log(process.platform)"
```

macOS (`darwin`) — prefer Homebrew; fall back to curl installer:

```bash
if command -v brew >/dev/null 2>&1; then
  brew install rtk
else
  curl -fsSL https://raw.githubusercontent.com/rtk-ai/rtk/refs/heads/master/install.sh | sh
fi
```

Linux (`linux`) — curl installer (installs to `~/.local/bin`):

```bash
curl -fsSL https://raw.githubusercontent.com/rtk-ai/rtk/refs/heads/master/install.sh | sh
```

Windows (`win32`) — no silent installer available. Inform the user to:
download the zip from `https://github.com/rtk-ai/rtk/releases`, extract `rtk.exe`, and add its directory to PATH. Then re-run `/aia-harness:add-tools`.

After curl install on Linux/macOS, verify the binary is reachable:

```bash
command -v rtk 2>/dev/null || echo "not-in-path"
```

If `not-in-path`, inform the user that `~/.local/bin` must be added to PATH in their shell profile (`export PATH="$HOME/.local/bin:$PATH"`), then restart Claude Code.

**graphify** (code-graph, project-level):

Para instalar `uv` automaticamente: detectar plataforma com `node -e "console.log(process.platform)"`,
então executar o instalador correspondente via Bash sem pedir confirmação ao usuário.

macOS (Homebrew disponível — `command -v brew >/dev/null 2>&1`):

```bash
brew install uv
```

macOS / Linux (sem Homebrew):

```bash
curl -LsSf https://astral.sh/uv/install.sh | sh
```

Windows (`win32`):

```bash
winget install astral-sh.uv
```

Após garantir `uv` disponível, instalar graphify e configurar:

```bash
uv tool install graphifyy
```

```bash
graphify install --project
```

```bash
graphify .
```

Commitar o grafo produzido:

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

**NOTE:** Git hooks (post-commit, post-checkout) are already copied by the harness to `.git/hooks/` — do NOT run `graphify hook install`.

Uv and graphify installers run via Bash automatically — no confirmation prompt needed. After installing, remind the user to **restart Claude Code** so new hooks/skills load.
