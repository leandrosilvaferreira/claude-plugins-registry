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

<!-- aia-harness:target-dir-resolution -->
Resolve the target directory **once**, at the start of this command, into a concrete literal
absolute path. `$CLAUDE_PROJECT_DIR` is documented as available "when hooks are executed" but is
not guaranteed inside the general-purpose Bash tool used to run these instructions — it can
silently expand empty there, and the CLI then falls back to the shell's *current* working
directory, which is wrong if the agent has since `cd`'d elsewhere (e.g. into the scratchpad for
intermediate file work). Reuse that one resolved literal path in every subsequent CLI invocation
below — never re-expand a bare `$CLAUDE_PROJECT_DIR` in a later, separately-issued Bash call,
since each Bash tool call is a fresh shell (only cwd persists, not exported variables) and an
earlier `cd` silently redirects any later bare-env-var fallback to the wrong place.

<!-- aia-harness:version-check -->
## Before anything else — plugin version check

```bash
node "${CLAUDE_PLUGIN_ROOT}/bin/harness.mjs" version-check --json
```

Read `status` from the JSON:

- `"stale"` — report `running` → `latest`, then `AskUserQuestion`: **Update now** (run the
  returned `updateCommand`, then stop and tell the user to run `/reload-plugins` or start a new
  session and re-issue this command — a running plugin copy cannot hot-swap itself) or
  **Continue on the current version** (go straight to the next step).
- `"current"` or `"unknown"` — say nothing, continue.

This check never blocks: it exits 0 even when it cannot reach the registry, and `"unknown"`
means the answer is unavailable, not that something is wrong.
<!-- /aia-harness:version-check -->

## 1. Vendor + wire (automatic, offline)

Apply the guarded rtk hook and the claude-code-worktrees skill directly
into the repo via the engine:

```bash
node "${CLAUDE_PLUGIN_ROOT}/bin/harness.mjs" apply "${1:-$CLAUDE_PROJECT_DIR}" --yes --json
```

This wires the guarded rtk `PreToolUse` hook into `.claude/settings.json`, copies
the claude-code-worktrees skill into `.claude/skills/`, and writes `.graphifyignore`.
Caveman and ponytail are global Claude Code plugins installed in Step 3 — not vendored locally.
To scope which tools: `--no-tools`.

**Read the JSON — this call is not restricted to the tool artifacts.** It carries no
`--only`, so it applies the whole default plan, and merging is the default: any artifact
that already exists and differs is **not** written. It is staged at
`.claude/.aia-harness-pending/<artifact-id-slug>/<relPath>` and returned in `conflicts[]`.
On any project that has been through `/aia-harness:init` this is the normal case, not an
edge one — re-detection alone regenerates some content, so entries appear here even when
the user has changed nothing.

Adjudicate every `conflicts[]` entry with **`patch.md` section 7 ("Adjudicate each
conflict")** — `Read` `${CLAUDE_PLUGIN_ROOT}/commands/patch.md` and follow that section as
written rather than improvising a diff review here. Two of its three preconditions are
satisfied by this call and the target path resolved above; the third is a `plan … --json`,
which this command does not otherwise run, so run one first whenever `conflicts[]` is
non-empty:

```bash
node "${CLAUDE_PLUGIN_ROOT}/bin/harness.mjs" plan "${1:-$CLAUDE_PROJECT_DIR}" --json
```

Remove the staging directory as that command's step 8 describes once every conflict has an
answer — nothing else in this command cleans it up.

## 2. Check system dependencies

```bash
node "${CLAUDE_PLUGIN_ROOT}/bin/harness.mjs" check "${1:-$CLAUDE_PROJECT_DIR}" \
  --tools=rtk,graphify,gh --json
```

Read the JSON. If `status === "block"`: present the list of `missing[]` with `installHint`
for the platform and stop without installing anything.

If `status !== "block"`: proceed. For each dep in `checks[]` with `found: false`:
inform the user what is absent (only recommended deps in this case) and ask whether to
install it in step 3.

## 3. One confirmation, then install machine deps

Use a single `AskUserQuestion` to confirm which machine installs to run (caveman, ponytail, rtk, gh, graphify). Only on approval, run the approved commands.

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

**gh** (GitHub CLI — required for PR review, issue management, and GitHub MCP):

Detect platform first:

```bash
node -e "console.log(process.platform)"
```

macOS (`darwin`) — Homebrew:

```bash
brew install gh
```

Windows (`win32`) — winget (built-in on Win 10/11):

```bash
winget install --id GitHub.cli
```

Linux (`linux`) — official apt keyring sequence:

```bash
(type -p wget >/dev/null || (sudo apt update && sudo apt install wget -y)) \
  && sudo mkdir -p -m 755 /etc/apt/keyrings \
  && out=$(mktemp) && wget -nv -O$out https://cli.github.com/packages/githubcli-archive-keyring.gpg \
  && cat $out | sudo tee /etc/apt/keyrings/githubcli-archive-keyring.gpg > /dev/null \
  && sudo chmod go+r /etc/apt/keyrings/githubcli-archive-keyring.gpg \
  && sudo mkdir -p -m 755 /etc/apt/sources.list.d \
  && echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/githubcli-archive-keyring.gpg] https://cli.github.com/packages stable main" | sudo tee /etc/apt/sources.list.d/github-cli.list > /dev/null \
  && sudo apt update && sudo apt install gh -y
```

Run the matching installer via Bash automatically — no additional confirmation. After install, verify:

```bash
command -v gh 2>/dev/null || echo "not-in-path"
```

If `not-in-path`, inform the user to add the install directory to PATH and restart Claude Code.

**graphify** (code-graph, project-level):

To install `uv` automatically: detect the platform with `node -e "console.log(process.platform)"`,
then run the matching installer via Bash without prompting the user.

macOS (Homebrew available — `command -v brew >/dev/null 2>&1`):

```bash
brew install uv
```

macOS / Linux (no Homebrew):

```bash
curl -LsSf https://astral.sh/uv/install.sh | sh
```

Windows (`win32`):

```bash
winget install astral-sh.uv
```

Once `uv` is available, install the graphify binary and build the graph:

```bash
uv tool install graphifyy
```

```bash
graphify .
```

**No API key needed for source code indexing.** graphify indexes source code via AST extraction without any LLM API key — that is the primary objective. A `GEMINI_API_KEY` / `GOOGLE_API_KEY` is only needed for semantic extraction of docs, papers, and images. If graphify prints a warning about a missing API key, ignore it and continue — the source code graph will be fully built.

**`graphify-out/` is a local artifact — never commit it.** `apply` already adds a
blanket `graphify-out/` entry to `.gitignore` (not just `cost.json`/`cache/`): every
teammate builds and rebuilds their own graph locally, kept current automatically by
the `.git/hooks/post-commit` / `post-checkout` hooks installed offline by this command,
plus `graphify update .`. Do NOT `git add graphify-out/` and do NOT remove or narrow
that `.gitignore` entry.

**NOTE:** Do NOT run `graphify install --project` or `graphify hook install`. The
harness already wired everything they would install — the `/graphify` skill
(`.claude/skills/graphify/`), the PreToolUse orientation hook (a cross-platform Node
hook at `.claude/hooks/graphify-orient.mjs`, wired in `.claude/settings.json`), and the
git hooks (`.git/hooks/post-commit`, `post-checkout`) — offline during `apply`. The
harness hook replaces graphify's `python3`/`sh` inline hooks with plain Node (no system
`python3` needed; runs on Windows too); running graphify's own installer would add a
second, redundant orientation hook. You only need the binary (above) to build and query
the graph.

Uv and graphify installers run via Bash automatically — no confirmation prompt needed. After installing, remind the user to **restart Claude Code** so new hooks/skills load.
