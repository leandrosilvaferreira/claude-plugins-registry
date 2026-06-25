<div align="center">

# 🪐 aia-harness

### Point it at any repo. Get a complete, stack-aware Claude Code setup in minutes

*Hooks · agents · skills · rules · permissions · MCP · worktrees · per-domain memory — diagnosed, approved, and scaffolded for **your** codebase.*

<br/>

[![CI](https://img.shields.io/github/actions/workflow/status/leandrosilvaferreira/aia_harness/ci.yml?branch=main&style=for-the-badge&label=CI&logo=githubactions&logoColor=white)](https://github.com/leandrosilvaferreira/aia_harness/actions/workflows/ci.yml)
[![Version](https://img.shields.io/github/package-json/v/leandrosilvaferreira/aia_harness?style=for-the-badge&color=orange&label=version)](https://github.com/leandrosilvaferreira/aia_harness/releases)
[![Node](https://img.shields.io/badge/node-%E2%89%A518-339933?style=for-the-badge&logo=node.js&logoColor=white)](https://nodejs.org)
[![Claude Code](https://img.shields.io/badge/Claude_Code-plugin-d97757?style=for-the-badge)](https://claude.ai/code)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue?style=for-the-badge)](#-license)
[![PRs welcome](https://img.shields.io/badge/PRs-welcome-22c55e?style=for-the-badge)](#-development--contributing)

</div>

---

> A good Claude Code setup — the right hooks, rules, agents, permissions, and `CLAUDE.md` files — is the difference between an assistant that **guesses** and one that **knows** your project. Building it by hand means learning every Claude Code primitive and wiring them together yourself. **aia-harness does it for you, safely.**

It scans your repository, diagnoses the stack, framework, and architecture, then scaffolds a complete **harness-engineering** setup: hooks, skills, agents, rules, `settings.json`, a project-root `.mcp.json`, env in `settings.local.json`, worktree config, a language-server strategy, and `CLAUDE.md` files at the root and per architectural domain. Every change runs through **diagnose → approve → apply**, with diffs. Nothing touches your repo without your consent. And once configured, each session runs not a lone assistant but a **team of specialist agents under an orchestrator** — working **spec-first**: understand, plan, review with you, *then* implement to your rules, patterns, and stack.

```console
$ cd my-project && claude

> /aia-harness:scan
  🔍 Diagnosing my-project …
  ├─ Language        TypeScript (92%)  ·  package manager: pnpm
  ├─ Frameworks      Next.js 15 · React 19 · Prisma · Vitest
  ├─ Architecture    app/ · components/ · lib/ · server/  (4 domains)
  ├─ Testing         ✓ configured (Vitest)
  └─ Harness         none detected  →  run /aia-harness:init to scaffold

> /aia-harness:init
  📋 Proposed plan — 23 artifacts (≈ 1.2k session-tokens)
  ◻ CLAUDE.md (root + 4 domains)   ◻ rules (ddd, security, react, next, typescript)
  ◻ settings.json (least-privilege) ◻ hooks (format · verify · secret-scan · large-file)
  ◻ skills (run-tests · lint-fix · pre-commit-verify)  ◻ .mcp.json (github · context7)
  ◻ ECC agents (react-reviewer · build-resolver)  …

  ? Select what to apply  ›  [ multi-select ]
  ✚ Showing diff for settings.json …  Apply? (y/N)
  ✓ Applied. Running harness-reviewer for a safety pass …
```

---

## 📋 Table of Contents

- [✨ Why aia-harness](#-why-aia-harness)
- [👥 A Team of Specialists, Working Spec-First](#-a-team-of-specialists-working-spec-first)
- [📦 Installation](#-installation)
- [🚀 Quick Start](#-quick-start)
- [🧩 Command Reference](#-command-reference)
- [🔄 How It Works](#-how-it-works)
- [🎁 What Gets Scaffolded](#-what-gets-scaffolded)
- [🧠 Stack Awareness](#-stack-awareness)
- [🔌 Power-Ups](#-power-ups)
- [🌳 Parallel & Autonomous Workflows](#-parallel--autonomous-workflows)
- [🔒 Safety & Trust](#-safety--trust)
- [🔧 The Engine (CLI)](#-the-engine-cli)
- [🧰 Development & Contributing](#-development--contributing)
- [🙏 Credits & Acknowledgments](#-credits--acknowledgments)
- [🙋 Support](#-support)
- [📨 Contact](#-contact)
- [🤓 Author](#-author)
- [📄 License](#-license)

---

## ✨ Why aia-harness

|   | |
|---|---|
| 👥 **A team, not one agent** | Each session runs an **orchestrator** that plans with you, then delegates to domain specialists — stack reviewers, build-resolvers, database, devops, QA, security, debugger — each loading only the skills and path-scoped rules its slice needs. **Spec-first:** plan → review → implement to your architecture. |
| 🎯 **Stack-aware, not boilerplate** | First-class detection for JS/TS, PHP, Java (Spring Boot **vs** Quarkus), Python, Go, and more. Every artifact adapts to what it finds — the right rules, the right reviewer agents, the right canonical commands. |
| 🛡️ **Safe by design** | **Diagnose → approve → apply.** A diff before every overwrite, secrets only as `${ENV}` placeholders, `*.local.*` gitignored. You sign off on each change; nothing is silent. |
| 🧱 **A whole harness, not a snippet** | Hooks, agents, skills, rules, least-privilege permissions, strategic MCP servers, worktrees, and layered memory — generated as one coherent system in a single pass. |
| ⚡ **Runs anywhere, zero build** | Hooks are pure ESM `.mjs` — no compile step — and resolve a Node runtime even when `node` isn't on `PATH` (nvm-friendly). Identical behavior in plain-JS and TypeScript repos. |
| 🔋 **Batteries included** | Token-economy tools (caveman · ponytail · rtk) that **cut token spend on the operations that dominate cost**, a code-graph flow (graphify), a GitHub-native PM loop, and curated MCP servers — each one command away. |
| 🧪 **Tested & deterministic** | The engine is a pure, side-effect-free core backed by **50+ unit tests**; detection reads, application writes, and the boundary between them is enforced. |

---

## 👥 A Team of Specialists, Working Spec-First

Once the harness is in place, a session stops behaving like one generalist assistant — it runs like a **team**.

**An orchestrator leads; specialists do the work.** A lead agent (`orchestrator` + `project-planner`) decomposes the task and delegates each slice to the right domain expert — stack-specific **reviewers** and **build-resolvers**, a **database-architect**, **devops-engineer**, **qa-automation-engineer**, **security-auditor**, **debugger**, frontend/backend specialists, and more — each pulling in only the **skills** and path-scoped **rules** its slice of the work actually needs. Specialist depth on every part of a task, instead of one context juggling all of it.

**It works spec-first — not prompt-and-pray.** The flow the harness encodes is deliberate:

```text
understand  →  plan  →  review WITH you  →  delegate & implement  →  verify
```

The agent first understands the problem and proposes a plan; you review and approve it; **only then** does the team build — and it builds **to the plan**, obeying the project's rules, validations, design patterns, architecture, and stack (all encoded by the scaffolded rules and per-domain `CLAUDE.md`). No silent rewrites, no architecture drift.

---

## 📦 Installation

> **Prerequisite:** the [Claude Code](https://claude.ai/code) CLI, installed and authenticated. Node ≥ 18 is needed for the engine and hooks (the plugin resolves it automatically when a version manager has placed it on `PATH`).

```bash
# 1. Add the registry (once — persists across every project)
claude plugin marketplace add leandrosilvaferreira/claude-plugins-registry

# 2. Install the plugin
claude plugin install aia-harness

# 3. Verify
claude plugin list   # → aia-harness@leandro-plugins-registry  ✔ enabled
```

**Update to the latest version** whenever a new release ships:

```bash
claude plugin update aia-harness@leandro-plugins-registry
```

<details>
<summary>🧪 <strong>Local development install</strong> (run from a clone, no registry)</summary>

<br/>

**Option A — `--plugin-dir`** (fastest for iteration; one session only):

```bash
cd /path/to/aia_harness && npm install
cd /path/to/target-project
claude --plugin-dir /path/to/aia_harness
# /aia-harness:scan, /aia-harness:init, … are available immediately
```

**Option B — local marketplace** (persists across sessions):

```bash
cd /path/to/aia_harness && npm install
claude plugin marketplace add /path/to/aia_harness
claude plugin install aia-harness@aia-harness
cd /path/to/target-project && claude
```

After editing plugin source, sync the installed copy with `claude plugin update aia-harness`.

</details>

---

## 🚀 Quick Start

Open Claude Code **inside the project you want to harness**, then:

```bash
cd /path/to/your-project
claude
```

| Step | Command | What happens |
|------|---------|--------------|
| 1️⃣ **Diagnose** | `/aia-harness:scan` | Read-only. Prints stack, package manager, frameworks, architectural domains, canonical commands, and any existing harness. Writes nothing. |
| 2️⃣ **Scaffold** | `/aia-harness:init` | The full flow: scan → propose a plan → **you multi-select** what to apply → **diffs** for anything that would overwrite → apply → enrich `CLAUDE.md` from real source → safety review. |
| 3️⃣ **Maintain** | `/aia-harness:doctor` | Later, after a plugin update or codebase drift: audits the harness and **additively** adds what's missing, one diff at a time. |

That's the loop. `scan` is always safe to run; `init` never writes without your approval; `doctor` keeps an existing harness healthy over time.

---

## 🧩 Command Reference

All commands are namespaced `/aia-harness:<name>` and take an optional `[path]` (default: the current project).

### 🔧 Core lifecycle

| Command | What it does |
|---------|--------------|
| **`scan`** `[path]` | Read-only diagnosis of stack, package manager, frameworks, monorepo layout, canonical commands, architecture, and existing harness. |
| **`init`** `[path]` | The headline flow: scan → plan → **consent (multi-select)** → diffs → apply → enrich CLAUDE.md → `harness-reviewer` safety pass → optional plugin/tool/MCP install. |
| **`doctor`** `[path]` | Audits an existing harness (CLAUDE.md quality, settings safety, hook hygiene, drift after upgrades) and **additively** applies missing pieces — never mass-overwrites. |
| **`patch`** `[path]` | Pick artifact **categories** (settings, hooks, rules, …) and force-overwrite only those. Use when one part of a configured project needs a refresh. |

### 🔌 Extensions

| Command | What it does |
|---------|--------------|
| **`add-mcp`** `[path]` | Suggests strategic MCP servers and merges chosen ones into `.mcp.json` — `${ENV}` placeholders only, never literal tokens. |
| **`add-plugins`** `[path]` | Generates an idempotent installer for the stack's recommended Claude Code plugins (code-review, hookify, feature-dev, per-language LSP, …) and runs it after one confirmation. |
| **`add-tools`** `[path]` | Installs token-economy / code-graph tools — caveman & ponytail (global plugins), rtk (hook), graphify, and the worktrees skill — project-scoped. |
| **`add-github-pm`** `[path]` | Activates the **GitHub PM pillar**: a PM skill, ten `/pm:*` commands, issue/PR templates, and four Projects-v2 sync workflows. |

### 🩺 Utility

| Command | What it does |
|---------|--------------|
| **`check-deps`** `[path]` | Reports required system dependencies (Node, Python, Go, …) with platform-specific install hints. Read-only. |
| **`condense-harness-prompts`** `[path]` | Validates/auto-fixes artifact frontmatter, then semantically condenses your `.claude/` markdown via parallel Opus subagents behind a deterministic safety gate. |
| **`help`** | Prints the full command reference plus an *"I want to…"* decision guide mapping intent → command. |

---

## 🔄 How It Works

aia-harness is **two surfaces over one engine**: an interactive Claude Code plugin, and a deterministic CLI the commands shell out to. Data flows through three pure-ish stages:

```text
   ┌──────────────┐      ┌──────────────┐      ┌──────────────┐
   │     SCAN     │      │     PLAN     │      │    APPLY     │
   │  (read-only) │ ───▶ │  (pure fn)   │ ───▶ │  (writes)    │
   └──────────────┘      └──────────────┘      └──────────────┘
   walks files once,    ProjectProfile →      dry-run unless --yes,
   runs per-concern     ordered list of       never overwrites a
   detectors →          Artifacts, each       differing file without
   ProjectProfile       with contextCost      a diff + --force
```

1. **`scan` → `ProjectProfile`** — walks the tree once, then runs independent detectors for language, package manager, frameworks, monorepo, commands, architecture, existing harness, VCS, testing gaps, and large files. **Read-only.**
2. **`plan` → `HarnessPlan`** — turns the profile into an ordered list of `Artifact`s. Data catalogs decide *what applies* per detected stack; each artifact carries a `contextCost` (estimated tokens loaded every session — `0` means lazy/path-scoped) and a `defaultSelected` flag. **Pure and side-effect-free.**
3. **`apply`** — writes the plan. **Safe by default:** dry-run unless `--yes`, never overwrites an existing *differing* file unless `--force`, updates `.gitignore` idempotently under an `# aia-harness` header.

For non-trivial or ambiguous repos, `init` calls in read-only **agents** for human-level judgment — `architecture-mapper` (names the domains so per-domain CLAUDE.md is accurate), `stack-analyst` (verifies canonical commands against CI when detection is uncertain), and `harness-reviewer` (adversarially audits the scaffolded result before you trust it).

---

## 🎁 What Gets Scaffolded

One `init` produces a coherent, least-privilege harness — **not a pile of defaults**. Every artifact is proposed with a diff before it lands.

- 📝 **`CLAUDE.md`** — a concise root memory (stack + canonical commands) plus lazy-loaded per-domain files, enriched from your real source.
- 📐 **`.claude/rules/*.md`** — path-scoped rules loaded on demand: a base set (DDD, design patterns, coding principles, code quality, testing, security, subagent dispatch) plus per-stack packs.
- 🔐 **`.claude/settings.json`** — least-privilege permissions + JS hook wiring.
- 🤫 **`.claude/settings.local.json`** — env values, gitignored.
- 🔗 **`.mcp.json`** — strategic MCP servers with `${ENV}` placeholders.
- 🪝 **`.claude/hooks/`** — pure-ESM hooks run through a node-resolver wrapper (formatter, strict verify loop, secret guard, large-file guard, and more).
- 🧰 **`.claude/skills/`** — operational skills (`run-tests`, `lint-fix`, `pre-commit-verify`, `setup-testing`, …).
- 🌳 **`.worktreeinclude`**, **`.lsp.json`** (opt-in), **`docs/harness/strategies.md`**, and an opt-in marketplace install script.
- 🧩 **Stack-matched agents, skills, and rules** vendored from ECC and ag-kit (see [Credits](#-credits--acknowledgments)).

<details>
<summary>🪝 <strong>The hooks, in full</strong> (event → behavior)</summary>

<br/>

**Always installed**

| Hook | Event | Behavior |
|------|-------|----------|
| `format-on-edit` | `PostToolUse` | Runs your formatter on edited files. **Fails open** — never blocks on a missing formatter. |
| `verify-on-stop` | `Stop` | Strict mode: blocks on real lint/typecheck failures so the agent self-corrects — but stays fail-open on infra and only fires when lintable code changed. Opt out with `--no-strict`. |
| `secret-scan` | `PreToolUse` | Blocks (exit 2) an Edit/Write whose payload looks like a committed secret. |
| `guard-main-branch` | `PreToolUse` | Intercepts `git commit`/`push` on `main`/`master` and asks you to confirm. |
| `large-file-warning` | `Stop` *or* `PostToolUse` | Dual-mode (chosen at init): **block** = refactor files > 350 lines before finishing; **advisory** = non-blocking refactor suggestion. |
| `memory-stop` | `Stop` | Complexity-gated nudge to record session learnings (only after meaningful edits). |
| `sql-idempotent-review` | `PostToolUse` | On any `.sql` change, asks Claude to make every statement idempotent. |
| `check-deps-on-start` | `SessionStart` | Warns when required system deps are missing. Fail-open. |
| `set-files-changed` | `PostToolUse` | Records edited paths so the Stop hooks only fire when code actually changed. |

**Worktree-aware** (activate only inside `.claude/worktrees/<name>`): `worktree-session-ctx` (`SessionStart`), `worktree-prompt-ctx` (`UserPromptSubmit`), `worktree-subagent-ctx` (`SubagentStart`), `worktree-write-guard` (`PreToolUse`, asks before writing outside the worktree).

**Stack-conditional** (PHP): `phpstan-on-edit` (`PostToolUse`) runs PHPStan on the edited file and feeds findings back so Claude fixes them.

> Every hook ships with unit tests asserting its output validates against the matching Claude Code event schema across **all 14 hook types** — exit codes, `hookSpecificOutput`, the lot.

</details>

<details>
<summary>🧰 <strong>First-party skills shipped into your project</strong></summary>

<br/>

| Skill | Purpose |
|-------|---------|
| `run-tests` | Run the project's test suite (canonical command from CLAUDE.md) and report real results. |
| `lint-fix` | Lint + format the codebase and fix what's found. |
| `pre-commit-verify` | Full pre-commit/PR gate — typecheck, lint, and tests must all pass. |
| `setup-testing` | Seeds unit tests in a project with none: installs the stack's framework, writes a real test, wires the script, runs to green. |
| `goal-builder` | Generates an optimized `/goal` command for autonomous / overnight execution. |
| `adianti-framework` | Expert guidance for PHP Adianti Framework 7.x/8.x (TRecord, TForm, TDataGrid, CRUD, master-detail). |
| `novo-modulo-adianti` | Scaffolds a complete Adianti CRUD module by mirroring an existing one. |
| `github-pm` | PM orchestrator for GitHub issues/PRs/Projects v2 (see [Power-Ups](#-power-ups)). |

</details>

<details>
<summary>🕵️ <strong>The three plugin agents</strong> (read-only, return findings)</summary>

<br/>

| Agent | Role |
|-------|------|
| `architecture-mapper` | Maps the codebase into named domains/layers so per-domain CLAUDE.md files get accurate responsibilities. |
| `stack-analyst` | Deep-dives ambiguous stacks — verifies canonical lint/test/build commands against CI when deterministic scan isn't enough. |
| `harness-reviewer` | Adversarially audits the freshly scaffolded harness: literal secrets, fail-open hooks, over-broad permissions, bloated CLAUDE.md — reported as `file:line` findings with fixes. |

</details>

---

## 🧠 Stack Awareness

Detection drives everything: the rules you get, the reviewer agents assigned, and the canonical commands wired into hooks.

| Tier | Stacks |
|------|--------|
| 🥇 **First-class** | **JavaScript / TypeScript** (React, Next.js, Vue, Nuxt, SvelteKit, Angular, NestJS, Remix, Astro…) · **PHP** (Laravel, Symfony, **Adianti**, and native PHP *without* Composer) · **Java** (Maven & Gradle, with **Spring Boot vs Quarkus** detection) · **Python** (Django, FastAPI, Flask) · **Go** (preferring `golangci-lint` when configured) |
| 🥈 **Dedicated rule packs** | Rust · Kotlin · C# · C++ · Dart — plus the per-stack packs above |
| 🥉 **Structured fallback** | Everything else (Ruby, Scala, Elixir, Swift, …) gets a generic-but-structured harness plus ECC/ag-kit assets where available — *verify the canonical commands before relying on them.* |

**Framework-level smarts** include Spring Boot **vs** Quarkus (different run/test/build per framework), Next.js vs plain React, Nuxt vs plain Vue, Laravel vs native PHP, and Django vs FastAPI — each mapped to its own rules, reviewer agents, and test-framework recommendation.

> 🧪 **Testing-gap detection** — if a project has no real unit tests (E2E-only frameworks don't count), the scan recommends a stack-appropriate framework + install recipe (React → Vitest + Testing Library, Laravel → Pest, Django → pytest, Go → `testing`, …). The `setup-testing` skill then installs it and seeds a passing test.

---

## 🔌 Power-Ups

Optional pillars you can layer on — each project-scoped, each one command.

### 🔗 Strategic MCP servers — `/aia-harness:add-mcp`

A curated catalog (github, context7, sequential-thinking, playwright, postgres, …) merged into `.mcp.json` with `${ENV}` placeholders. Keeps the set small and the secrets out of git.

### 📦 Recommended plugins — `/aia-harness:add-plugins`

An idempotent installer for the stack's best Claude Code plugins (code-review, hookify, feature-dev, frontend-design, context7, per-language LSP).

### ⚡ Token economy — spend fewer tokens — `/aia-harness:add-tools`

Token spend is the number-one running cost of Claude Code. The harness installs four tools that each attack a **different token sink**, so their savings compound:

| Tool | Cuts tokens on… | Reported savings |
|------|-----------------|------------------|
| **rtk** (Rust Token Killer) | shell / build / test command output | **60–90%** (≈89% avg across 2,900+ commands) |
| **caveman** | the model's responses | **~65% avg** on output tokens (up to 87%) |
| **graphify** | codebase questions — a scoped subgraph instead of file/grep dumps | **up to ~70× context** on large repos |
| **ponytail** | generated-code volume (YAGNI + reuse) | **~54% less code** (~22% fewer tokens) |

Stacked, they cut **up to ~70–90% of the tokens on the operations that dominate a session** — command output, codebase lookups, responses, and generated code. *(These are per-operation ceilings that compound across different sinks — not a flat whole-session number; each is biggest when that operation dominates the turn.)*

> Bundled in the same command: the **`claude-code-worktrees`** skill (parallel sessions, above).

### 🗂️ GitHub-native PM loop — `/aia-harness:add-github-pm`

Bolts a complete **issue → Project status → branch → PR → merge → auto-close** workflow onto a GitHub repo:

- A **`github-pm`** orchestrator skill that enforces the lifecycle (`Backlog → In Progress → In Review → Done`), links every change to an issue, and gates merges on green CI.
- **Ten `/pm:*` commands** — `setup-project`, `backlog`, `issue-new`, `issue-work`, `issue-close`, `worktree-new`, `worktree-remove`, `commit-push-pr`, `code-review-pr`, `pr-merge`.
- **Issue & PR templates** (`bug` / `feature` / `task` forms + acceptance-criteria PR template).
- **Four GitHub Actions** that keep Projects v2 in sync (issue → triage, commit → in-progress, PR → in-review, merge → done).

> Enable it on a GitHub repo with `/aia-harness:add-github-pm`, then run `/pm:setup-project` once to wire your Project IDs and the `PROJECTS_PAT` secret. *(Only applies when the remote is `github.com`.)*

---

## 🌳 Parallel & Autonomous Workflows

Two force-multipliers the harness wires up: run **many teams** in parallel, and keep **one team** working until the job is actually done.

### 🌿 Parallel teams on separate branches — git worktrees

Each session is a whole **team** (orchestrator + specialists), and a single working directory only has room for one — a second team would trip over the first's edits, and switching tasks means stashing work-in-progress. **Git worktrees** give each session its own directory on its own branch, so **several full teams fan out across features and bugfixes at the same time**, fully isolated: one team ships a feature in one terminal while another fixes a bug in a second. Inside a session, `isolation: "worktree"` extends that isolation to the orchestrator's own subagents — each specialist can get its own tree.

Claude Code supports this natively — `claude --worktree <name>`, `EnterWorktree` / `ExitWorktree`, and `isolation: "worktree"` for subagents. The harness makes it **safe**, shipping the `claude-code-worktrees` skill plus four worktree-aware hooks that keep every agent in the team pinned to its own tree:

| Hook | Event | Keeps each agent inside its worktree by… |
|------|-------|------------------------------------------|
| `worktree-session-ctx` | `SessionStart` | telling it to read/write in the worktree, not the repo root |
| `worktree-prompt-ctx` | `UserPromptSubmit` | re-injecting that reminder each prompt (survives compaction) |
| `worktree-subagent-ctx` | `SubagentStart` | passing the same boundary to every subagent it spawns |
| `worktree-write-guard` | `PreToolUse` | asking before any write that would land **outside** the worktree |

A generated `.worktreeinclude` copies gitignored essentials (`.env`, …) into each new worktree. → installed via `/aia-harness:add-tools`.

### 🎯 Loop until the goal is met — `goal-builder` + `/goal`

Babysitting a session turn-by-turn ("keep going…", "now the next one") doesn't scale. Claude Code's native **`/goal`** command fixes that: state an end-state once and the team **keeps working on its own — act → verify → iterate** — while a separate fast model checks each turn and stops only when the condition is truly met. Ideal for big multi-step jobs and unattended / overnight runs (`claude -p "/goal …"`).

A goal is only as good as its finish line — and writing that finish line is exactly what the scaffolded **`goal-builder`** skill does for you, turning a vague intent into a strong `/goal` condition with the parts that make a loop converge:

- a **measurable end state** (a passing test, a clean `git status`, a file count under budget),
- a **runnable check** the team can surface in the transcript (e.g. `npm test` exits 0),
- the **constraints** that must hold, and an optional **turn/time cap** to bound the run.

> ⚠️ `/goal`'s evaluator judges only what the session **surfaces** in the conversation — it never runs commands itself. `goal-builder` deliberately writes checks that are demonstrable in-transcript, which is what keeps an autonomous loop honest.

---

## 🔒 Safety & Trust

Safety isn't a feature here — it's the contract. These invariants are non-negotiable and never regressed:

- ✅ **Consent gate** before any write; a **diff** before any overwrite.
- 🔑 **No secrets in committed files** — `.mcp.json` uses `${ENV}` placeholders; `*.local.*` is gitignored.
- 🚦 **Guard hooks block with exit code 2**; **formatters fail open** (a missing tool never blocks you).
- 🛟 **Stop hooks stay fail-open on infrastructure** — they block on real lint/type errors so the agent self-corrects, never on a missing runtime.
- 🕵️ **A `harness-reviewer` agent** audits the result for secrets, fail-open mistakes, and over-broad permissions before you trust it.

---

## 🔧 The Engine (CLI)

The deterministic core the commands wrap is also a standalone CLI — handy for scripting and CI:

```bash
aia-harness scan  [dir] [--json]    # diagnose → ProjectProfile
aia-harness plan  [dir] [--json]    # ProjectProfile → HarnessPlan (proposed artifacts)
aia-harness apply [dir] [--yes]     # write the plan (dry-run unless --yes)
aia-harness check [dir] [--json]    # verify required system dependencies
```

`apply` is a **dry run unless `--yes`**, and never overwrites an existing, differing file unless `--force`.

<details>
<summary>🎛️ <strong>Full <code>apply</code> flag reference</strong></summary>

<br/>

| Flag | Effect |
|------|--------|
| `--yes` | Actually write (default is a dry-run preview). |
| `--force` | Overwrite existing files that differ (after showing a diff). |
| `--only=id,id` | Apply only the named artifact IDs. |
| `--tools=a,b` / `--no-tools` | Limit or skip project-level tools. |
| `--no-strict` | Use a passive Stop reminder instead of the blocking lint+typecheck loop. |
| `--large-files=block\|advisory` | Large-file guard mode. Default: the detector's recommendation (`block` for a clean repo, `advisory` when offenders already exist). |

</details>

---

## 🧰 Development & Contributing

PRs welcome. The repo is **Node ≥ 18, pure ESM (`.mjs`), no build step** — typed with JSDoc and checked by `tsc --checkJs`.

```bash
npm install
npm run typecheck   # tsc --checkJs over JSDoc types (noEmit)
npm run lint        # ESLint flat config
npm run test:unit   # node --test (50+ suites)
npm test            # all three
```

**Architecture & conventions**

- `lib/` is **pure and tested**; IO lives at the edges (`detect` reads, `apply` writes, `bin` orchestrates). Keep generators and catalogs side-effect-free.
- All source code is **English-only**, including everything scaffolded into target projects.
- Adding an asset (agent / skill / rule / hook) means registering it in the matching **catalog** (`lib/data/*-catalog.mjs`) in the same change — a CI test enforces catalog/template/deps synchronization.

<details>
<summary>📁 <strong>Repository layout</strong></summary>

<br/>

```text
aia_harness/
├─ bin/harness.mjs        # the deterministic CLI (scan · plan · apply · check)
├─ lib/                   # pure engine: detect/ · plan/ · generate/ · data/ · validate/
├─ commands/              # the /aia-harness:* slash commands
├─ agents/                # architecture-mapper · stack-analyst · harness-reviewer
├─ skills/                # plugin-side skills (harness-engineering, safe-hooks, …)
├─ hooks/                 # the SessionStart "suggest harness" hook
├─ templates/             # everything scaffolded into target projects
│  ├─ hooks/ · skills/ · rules/ · commands/pm/
│  ├─ ecc/ · ag-kit/      # vendored third-party assets (pinned by commit)
│  └─ github/ · github-pm-ext/
├─ scripts/               # vendoring (sync:ecc · sync:agkit · sync:tools) + publish
└─ tests/                 # 50+ node --test suites
```

</details>

**Re-vendoring upstream assets** (pinned by commit in `scripts/*-source.json`):

```bash
npm run sync:ecc            # ECC assets
npm run sync:agkit          # ag-kit assets
npm run sync:tools          # token-economy tools
npm run sync:github-issues  # github-pm: issue skill
npm run sync:github-project # github-pm: project skill
```

See [`PUBLISHING.md`](./PUBLISHING.md) for the release and registry-sync workflow, and [`CLAUDE.md`](./CLAUDE.md) for the full architecture deep-dive.

---

## 🙏 Credits & Acknowledgments

aia-harness stands on excellent open-source work. Every vendored file is stamped with its provenance (source repo + commit + path + license), and upstream licenses are retained.

| Source | What it provides | License |
|--------|------------------|---------|
| **[ECC — "Everything Claude Code"](https://github.com/affaan-m/ECC)** by [Affaan Mustafa](https://x.com/affaan) | Stack-specific reviewer / build-resolver **agents**, **skills**, and path-scoped **rules** | MIT |
| **[ag-kit](https://github.com/vudovn/ag-kit)** by vudovn | Generalist agents, skills, and workflow commands (orchestration, planning, QA, …) | MIT |
| **[caveman](https://github.com/JuliusBrussee/caveman)** | Token-economy "caveman" communication mode | MIT |
| **[ponytail](https://github.com/DietrichGebert/ponytail)** | "Lazy senior dev" minimal-code mode | MIT |
| **[rtk](https://github.com/rtk-ai/rtk)** | Rust Token Killer — Bash proxy for token savings | Apache-2.0 |
| **[graphify](https://github.com/safishamsi/graphify)** | Codebase knowledge-graph flow | MIT |
| **github-issues skill** (from [github/awesome-copilot](https://github.com/github/awesome-copilot)) | Issue CRUD + Projects v2 via GitHub MCP | MIT |
| **github-project skill** (from [netresearch/github-project-skill](https://github.com/netresearch/github-project-skill)) | PR / CI troubleshooting + branch protection | MIT AND CC-BY-SA-4.0 |

---

## 🙋 Support

If you have any questions or run into issues, please [open an issue](https://github.com/leandrosilvaferreira/aia_harness/issues). We will do our best to help you.

---

## 📨 Contact

If you wish to contact the project maintainers, please send an email to: [leandro@notyped.com](mailto:leandro@notyped.com)

Thank you for your interest in the project — contributions are always welcome!

---

## 🤓 Author

**Leandro Silva Ferreira**

- GitHub: [@leandrosilvaferreira](https://github.com/leandrosilvaferreira)
- Twitter: [@leandrosfer](https://twitter.com/leandrosfer)
- Email: [leandro@notyped.com](mailto:leandro@notyped.com)
- LinkedIn: [Leandro Ferreira](https://www.linkedin.com/in/leandrosilvaferreira/)

---

## 📄 License

Released under the **MIT License** — see [`LICENSE`](./LICENSE). Vendored third-party content keeps its own upstream license (see [Credits](#-credits--acknowledgments)). © 2026 Leandro Silva Ferreira.

<div align="center">

<br/>

**Built for [Claude Code](https://claude.ai/code).** If aia-harness saved you an afternoon of YAML, ⭐ the repo.

</div>
