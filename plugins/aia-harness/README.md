# aia-harness

![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)
![Node](https://img.shields.io/badge/Node-%E2%89%A518-339933?logo=node.js&logoColor=white)
![Claude Code](https://img.shields.io/badge/Claude%20Code-plugin-d97757)
![Zero build](https://img.shields.io/badge/build-none-success)

> **Point it at any repo. Get a complete, stack-aware Claude Code setup in
> minutes — hooks, agents, skills, rules, and memory, tuned to your codebase.**

A good Claude Code setup — the right hooks, rules, agents, permissions, and
`CLAUDE.md` files — is the difference between an assistant that guesses and one
that *knows* your project. Building it by hand means learning every Claude Code
primitive and wiring them together yourself. **aia-harness does it for you.**

It scans your repository, diagnoses the stack, framework, and architecture, then
scaffolds a complete **harness-engineering** setup: hooks, skills, agents, rules,
`settings.json`, a project-root `.mcp.json`, env in `settings.local.json`,
worktree config, a language-server strategy, and `CLAUDE.md` files at the root
and per architectural domain.

Built on the same ideas as the native `claude-automation-recommender` and
`claude-md-improver` skills — but with the **write/scaffold phase** those
read-only tools lack. Every change runs through **diagnose → approve → apply**,
with diffs. Nothing touches your repo without your consent.

## Why aia-harness

- **Stack-aware, not boilerplate** — first-class detection for JS/TS, PHP, Java
  (Spring Boot vs Quarkus), and Go; every artifact adapts to what it finds.
- **Safe by design** — diagnose → approve → apply, diffs before every overwrite,
  secrets only as env placeholders. You sign off on each change.
- **A whole harness, not a snippet** — hooks, agents, skills, rules,
  least-privilege permissions, MCP servers, worktrees, and layered memory in one
  pass.
- **Runs anywhere, zero build** — hooks are pure ESM and resolve a Node runtime
  even when `node` isn't on `PATH`.
- **Batteries included** — optional token-economy tools (caveman, ponytail, rtk)
  and a code-graph flow (graphify), installed project-scoped in one command.

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
| ------- | ------------ |
| `/aia-harness:scan [path]` | Read-only diagnosis of stack, commands, architecture, existing harness. |
| `/aia-harness:init [path]` | Full flow: scan → propose plan → consent (multi-select) → apply with diffs → safety review. |
| `/aia-harness:doctor [path]` | Audit an existing harness (CLAUDE.md size, settings safety, hook hygiene) and propose targeted fixes. |
| `/aia-harness:add-mcp [path]` | Suggest and wire strategic MCP servers into `.mcp.json` (env placeholders only). |
| `/aia-harness:add-plugins [path]` | Suggest market plugins/marketplaces for the stack and generate an install script. |
| `/aia-harness:add-tools [path]` | Install project-level token-economy / code-graph tools (caveman, ponytail, rtk, graphify). |

## What gets generated

One `init` produces a coherent, least-privilege harness — not a pile of
defaults. Every artifact below is proposed with a diff before it lands:

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

## Safety

- Consent gate before any write; diffs before overwrites.
- No secrets in committed files; `.mcp.json` uses env placeholders; `*.local.*`
  is gitignored.
- Guard hooks block with exit code 2; formatters fail open.
- A `harness-reviewer` agent audits the result for secrets, fail-open hooks, and
  over-broad permissions.

## Development

```bash
npm install
npm run typecheck   # tsc --checkJs (JSDoc types)
npm run lint        # ESLint flat config
npm run test:unit   # node --test
npm test            # all three
```

See [PUBLISHING.md](./PUBLISHING.md) for the release and registry-sync workflow.

The engine lives in `lib/` (pure, tested), templates in `templates/`, and the
Claude Code surface in `commands/`, `agents/`, `skills/`, `hooks/`. Design notes
are in `docs/specs/`.

### Local testing (without the registry)

Two approaches to load the plugin directly from a local clone.

**Option A — `--plugin-dir`** (fastest for iteration; one session only):

```bash
cd /path/to/aia_harness && npm install
cd /path/to/target-project
claude --plugin-dir /path/to/aia_harness
# /aia-harness:scan, /aia-harness:init, etc. are available immediately
```

**Option B — local marketplace** (persists across sessions):

```bash
cd /path/to/aia_harness && npm install
claude plugin marketplace add /path/to/aia_harness
claude plugin install aia-harness@aia-harness
cd /path/to/target-project && claude
```

After editing plugin source, sync the installed copy:

```bash
claude plugin update aia-harness
```

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
