# aia-harness

A Claude Code **plugin** that scans any project, diagnoses its stack and
architecture, and scaffolds a complete **harness-engineering** setup — hooks,
skills, agents, rules, `settings.json`, project-root `.mcp.json`, env in
`settings.local.json`, worktree config, language-server strategy, and
`CLAUDE.md` files at the root and per architectural domain.

It is modeled on the native `claude-automation-recommender` and
`claude-md-improver` skills, but adds the **write/scaffold phase** those
read-only tools lack. Every change goes through **diagnose → approve → apply**
(with diffs) — nothing is written without your consent.

## Local Testing (without publishing)

Two approaches to test the plugin against any project on your machine.

### Option A — `--plugin-dir` (recommended for active development)

Loads the plugin for one session only. Code changes in `aia_harness/` are picked up on
the next `claude` launch — no reinstall needed.

```bash
# 1. Install deps (once)
cd /path/to/aia_harness
npm install

# 2. Open the target project (the one without a harness)
cd /path/to/target-project

# 3. Start Claude Code with the local plugin loaded
claude --plugin-dir /path/to/aia_harness

# 4. Inside Claude, run any command:
# /aia-harness:scan
# /aia-harness:init
```

### Option B — local marketplace (persists across sessions)

Install once; the plugin is available every time you open any project.

```bash
# 1. Install deps (once)
cd /path/to/aia_harness
npm install

# 2. Register this repo as a marketplace (once; absolute path required)
claude plugin marketplace add /path/to/aia_harness

# 3. Install the plugin from that marketplace (once)
claude plugin install aia-harness@aia-harness

# 4. Open the target project and start Claude normally
cd /path/to/target-project
claude

# /aia-harness:scan, /aia-harness:init, etc. are available immediately
```

After editing plugin source, sync the installed copy:

```bash
claude plugin update aia-harness
```

> **Which to use?** `--plugin-dir` is faster for iteration. The marketplace approach is
> better when you want the plugin always available across multiple projects.

## Install

> **Prerequisite:** [Claude Code](https://claude.ai/code) CLI installed and authenticated.

```bash
# 1. Add the registry (once — persists across all projects)
claude plugin marketplace add leandrosilvaferreira/claude-plugins-registry

# 2. Install aia-harness
claude plugin install aia-harness

# 3. Verify
claude plugin list   # should show aia-harness@leandro-plugins-registry ✔ enabled
```

**Use it:**

```bash
cd /path/to/your-project
claude
# /aia-harness:scan   ← diagnose the project (read-only)
# /aia-harness:init   ← full scaffold flow with consent + diffs
```

To update to the latest version:

```bash
claude plugin update aia-harness
```

## Commands

| Command | What it does |
|---------|--------------|
| `/aia-harness:scan [path]` | Read-only diagnosis of stack, commands, architecture, existing harness. |
| `/aia-harness:init [path]` | Full flow: scan → propose plan → consent (multi-select) → apply with diffs → safety review. |
| `/aia-harness:doctor [path]` | Audit an existing harness (CLAUDE.md size, settings safety, hook hygiene) and propose targeted fixes. |
| `/aia-harness:add-mcp [path]` | Suggest and wire strategic MCP servers into `.mcp.json` (env placeholders only). |
| `/aia-harness:add-plugins [path]` | Suggest market plugins/marketplaces for the stack and generate an install script. |
| `/aia-harness:add-tools [path]` | Install project-level token-economy / code-graph tools (caveman, ponytail, rtk, graphify). |

## What gets generated

- **CLAUDE.md** — concise root memory (stack + canonical commands) + lazy-loaded
  per-domain files.
- **.claude/rules/*.md** — path-scoped rules (loaded on demand via `paths:`).
- **.claude/settings.json** — least-privilege permissions + JS hook wiring.
- **.claude/settings.local.json** — env values (gitignored).
- **.mcp.json** — strategic MCP servers with `${ENV}` placeholders.
- **.claude/hooks/** — JS hooks run through a node-resolver wrapper:
  `format-on-edit` (PostToolUse formatter), `verify-on-stop` (strict Stop
  loop: lint + typecheck), `secret-scan` (PreToolUse secret guard), and
  `large-file-warning` (Stop: warns when any edited source file exceeds
  350 lines and suggests DDD-aligned extraction — service, use-case,
  repository, or sub-component).
- **.claude/skills/** — installable operational skills (`run-tests`, `lint-fix`,
  `pre-commit-verify`).
- **.worktreeinclude**, **.lsp.json** (opt-in), **docs/harness/strategies.md**,
  and an opt-in market install script (marketplaces + suggested plugins).
- **ECC-sourced assets, assigned by detected stack** — stack-specific reviewer
  / build-resolver **agents** (`.claude/agents/`), **skills** (`.claude/skills/`),
  and path-scoped **rules** mirrored into `.claude/rules/ecc/<stack>/`. Vendored
  from [ECC](https://github.com/affaan-m/ECC) (MIT); see Credits.
- **Project-level tools** (`/aia-harness:add-tools`) — **caveman** + **ponytail**
  vendored into `.claude/` and wired (token economy), a guarded **rtk** hook, and
  the **graphify** code-graph flow + `.graphifyignore`. All project-scoped, never
  global; see Credits.

## JavaScript hooks anywhere

Hook scripts are plain ESM `.mjs` — no build step — so they work identically in
`.js`-only and TypeScript projects. They run through `node-run.sh` / `node-run.cmd`,
which resolve a Node.js runtime even when `node` is not on `PATH`
(`$CLAUDE_NODE` → `node` → newest nvm install → `bun`).

## The engine (CLI)

The deterministic core is also a CLI (used by the commands):

```bash
aia-harness scan  [dir] [--json]   # diagnose
aia-harness plan  [dir] [--json]   # show the proposed plan
aia-harness apply [dir] [--yes]    # apply (dry-run unless --yes)
                  [--only=id,id] [--force]
```

`apply` is a dry run unless `--yes` is passed, and never overwrites an existing,
differing file unless `--force` is given.

## First-class support

First-class detection (language, frameworks, canonical commands):

- **JavaScript/TypeScript** (React/Next, Vue/Nuxt, Angular, NestJS, …)
- **PHP** — Composer projects (Laravel/Symfony) **and native PHP without Composer**
- **Java** — Maven & Gradle, with **Spring Boot vs Quarkus** detection (run/test/build per framework)
- **Go** — `go` toolchain, preferring `golangci-lint` when configured

Other languages (Rust, Python, Kotlin, C#, C++, Dart, Ruby, …) use a structured
generic fallback plus ECC rules/skills/agents where available — verify the
canonical commands before relying on them.

## Development

```bash
npm install
npm run typecheck   # tsc --checkJs (JSDoc types)
npm run lint        # ESLint flat config
npm run test:unit   # node --test
npm test            # all three
```

The engine lives in `lib/` (pure, tested), templates in `templates/`, and the
Claude Code surface in `commands/`, `agents/`, `skills/`, `hooks/`. Design notes
are in `docs/specs/`.

## Safety

- Consent gate before any write; diffs before overwrites.
- No secrets in committed files; `.mcp.json` uses env placeholders; `*.local.*`
  is gitignored.
- Guard hooks block with exit code 2; formatters fail open.
- A `harness-reviewer` agent audits the result for secrets, fail-open hooks, and
  over-broad permissions.

## Credits

A curated subset of stack-specific **agents, skills, and rules** is vendored
from **[ECC ("Everything Claude Code")](https://github.com/affaan-m/ECC)** by
Affaan Mustafa ([@affaan](https://x.com/affaan)), MIT License, © 2026 Affaan
Mustafa. The upstream license is kept at `templates/ecc/LICENSE`, and provenance
(source commit + path) is stamped in each vendored file and `templates/ecc/MANIFEST.json`.

Project-level tools installable via `/aia-harness:add-tools` (all keep their
upstream license; caveman/ponytail are vendored under `templates/tools/<id>/`):

- **caveman** — [JuliusBrussee/caveman](https://github.com/JuliusBrussee/caveman) (MIT)
- **ponytail** — [DietrichGebert/ponytail](https://github.com/DietrichGebert/ponytail) (MIT)
- **rtk** — [rtk-ai/rtk](https://github.com/rtk-ai/rtk) (Apache-2.0)
- **graphify** — [safishamsi/graphify](https://github.com/safishamsi/graphify) (MIT)

To refresh vendored content from upstream:

```bash
npm run sync:ecc     # ECC assets, pinned in scripts/ecc-source.json
npm run sync:tools   # caveman + ponytail, pinned in scripts/tools-source.json
```

Catalogs: `lib/data/ecc-catalog.mjs` (stack → ECC assets) and
`lib/data/tools-catalog.mjs` (tool → install strategy + hooks).

## License

MIT (this plugin). Vendored ECC content remains MIT © Affaan Mustafa.
