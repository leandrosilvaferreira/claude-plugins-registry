---
description: Install token-economy / code-graph tools. Caveman and ponytail install as global Claude Code plugins; rtk hook + claude-code-worktrees are vendored project-level automatically; binary/pkg installs run after one confirmation.
argument-hint: "[path]"
allowed-tools:
  - Bash
  - Read
  - Edit
  - Write
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

Apply the guarded rtk hook, the graphify wiring and the claude-code-worktrees skill directly
into the repo via the engine. The apply is **scoped with `--only=`** to the artifacts those
tools install: left unscoped, the engine applies every default-selected artifact of the whole
harness plan — every hook, rule, agent and `CLAUDE.md` file, plus the entire `settings.json` —
none of which this command was asked to touch. To narrow which tools are wired, add
`--tools=a,b` (or `--no-tools`) to the `plan` and the `apply` below alike.

**First decide whether `settings` is merged at all.** It is the one scoped artifact that is not
a tool's own file: the merge adds **every** generated default the existing file lacks, not just
the tools' hook entries. `Read` `.claude/settings.json` in the target and look for
`large-file-warning.mjs`:

- Wired under **`Stop`** → mode `block`; under **`PostToolUse`** → `advisory`. Preserve whichever
  you find and pass it below as `--large-files=<mode>`. `renderSettings` wires the guard under
  `Stop` **or** `PostToolUse` depending on the mode, and `mergeSettingsJson` only ever adds what
  is missing — so the mode the target does not use would leave the guard wired under both
  events, firing it twice on every session.
- Wired nowhere, or the file is absent → there are no scaffolded harness settings to merge into
  (the guard is mandatory in a scaffolded one). Merging the generated defaults would wire every
  harness hook (`guard-main-branch.mjs`, `secret-scan.mjs`, `verify-on-stop.mjs`, …) — scripts
  this command does not install, so a project without them gets a "cannot find module" error on
  every future session. Leave `settings` out of `--only` and wire the tools' own entries by hand
  (below). Setting the guard up is `/aia-harness:init`'s and `/aia-harness:doctor`'s job, not
  this command's.

**Run the plan** with the flags the apply will carry (`--large-files=<mode>` when a mode was
preserved) and keep the JSON — it is the `plan … --json` the conflict adjudication below needs:

```bash
node "${CLAUDE_PLUGIN_ROOT}/bin/harness.mjs" plan "${1:-$CLAUDE_PROJECT_DIR}" --large-files=<mode> --json
```

**Check what else `settings` will add** (skip this when `settings` is left out). A dry run does
not show which keys the merge adds — it prints only `would update: .claude/settings.json` — so
compare the plan's `settings` artifact `content` (a JSON string) with the existing
`.claude/settings.json`: whatever it has and the file lacks is what the merge adds. The tools' own
entries are the expected part: the `rtk-hook.mjs` hook under `hooks.PreToolUse` (matcher `Bash`)
and, with graphify, the `graphify-orient.mjs` group (matcher `Bash|Read|Glob`). If the merge would
add anything else — an `env` key, a `permissions` entry, another hook — look at each extra hook
first: the plan artifact whose `relPath` is its script (`.claude/hooks/<script>`) carries
`exists`, and `false` means the script is not on disk. This apply installs no script beyond the
tools' own, so merging such an entry wires a hook that fails with `MODULE_NOT_FOUND` on every
prompt or tool call. If any extra hook's script is missing, do not offer the merge: leave
`settings` out of `--only`, wire the tools' own entries by hand (below) and tell the user to run
`/aia-harness:doctor` (or `/aia-harness:patch`) to install the missing hooks. Otherwise name the
extras in one `AskUserQuestion`, calling out `env.ANTHROPIC_DEFAULT_OPUS_MODEL` and
`env.ANTHROPIC_DEFAULT_SONNET_MODEL` when present: they pin `opus`/`sonnet` to first-party model
ids, which fail with an unknown-model error on Bedrock, Vertex, Foundry and LLM gateways that need
their own — a machine on one overrides them with `env` in `.claude/settings.local.json`, which
takes precedence over `.claude/settings.json`. If the user declines the extras, leave `settings`
out of `--only`. With nothing else to add, do not ask — this step stays automatic.

Then apply:

```bash
node "${CLAUDE_PLUGIN_ROOT}/bin/harness.mjs" apply "${1:-$CLAUDE_PROJECT_DIR}" --yes \
  --only=hook:rtk-hook.mjs,hook:hook-io.mjs,tool-skill:claude-code-worktrees:claude-code-worktrees,tool-skill:graphify,graphifyignore,graphify-orient-hook,graphify-git-hook:post-commit,graphify-git-hook:post-checkout,claude-md:graphify-skill,claude-md:graphify-root,settings \
  --large-files=<mode> --json
```

This wires the guarded rtk `PreToolUse` hook into `.claude/settings.json`, copies
the claude-code-worktrees skill into `.claude/skills/`, and writes `.graphifyignore`.
Caveman and ponytail are global Claude Code plugins installed in Step 3 — not vendored locally.
The other ids are graphify's pieces (skill, orientation hook, git hooks, `CLAUDE.md` sections —
see the note in Step 3) and `hook-io.mjs`, which the orientation hook imports; an id with nothing
to install (graphify not selected, a git hook outside a git repo) matches nothing and is skipped.
Without `settings` in `--only`, drop `--large-files=<mode>` too — it has nothing left to configure.

**Wire the tools' own entries by hand** — only when `settings` was left out of `--only`. `Edit`
just those entries (named above) into `.claude/settings.json`, copied verbatim from the plan's
`settings` `content` and keeping the `${CLAUDE_PROJECT_DIR}` placeholder with its braces. Put each
into the matching matcher group when the file already has one, and leave everything else in it as
it is. Skip any entry whose script `.claude/settings.json` already references: the merge
deduplicates but `Edit` does not, and a re-run of this command (Windows users re-run it after
installing rtk) would wire it twice. When the file does not exist, `Write` a new one holding only
those entries;
`/aia-harness:init` merges the rest in later, additively. Say in one line that nothing else in
`settings.json` was touched.

**Read the JSON.** Merging is the default: any artifact that already exists and differs is
**not** written. It is staged at `.claude/.aia-harness-pending/<artifact-id-slug>/<relPath>`
and returned in `conflicts[]`. With this scope that means a tool file the project already has
and that differs from what this plugin version generates — a `.git/hooks/post-commit` of the
user's own, a hand-edited `.graphifyignore`, a vendored hook or skill from an older release.

Adjudicate every `conflicts[]` entry with **`patch.md` section 7 ("Adjudicate each
conflict")** — `Read` `${CLAUDE_PLUGIN_ROOT}/commands/patch.md` and follow that section as
written rather than improvising a diff review here. Its three preconditions are already
satisfied: this apply, the `plan … --json` above, and the target path resolved at the top of
this command. Remove the staging directory as that command's step 8 describes once every
conflict has an answer — nothing else in this command cleans it up.

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

**gh** (GitHub CLI — required for PR review and issue management):

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
