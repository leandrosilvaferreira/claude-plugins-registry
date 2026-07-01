---
description: Show the full aia-harness command reference — what each command does, when to use it, parameters and options — with a "I want to…" quick-start guide at the top.
allowed-tools:
  - Bash
---

# aia-harness command guide

Present this guide to the user in full and well-formatted.
Start with the "Where to start" section, then detail each command. If useful,
show the engine version:

```bash
"${CLAUDE_PLUGIN_ROOT}/bin/aia-harness" version
```

---

## 🚀 Where to start (decision guide)

| If you want to… | Use |
| --- | --- |
| **Just diagnose** the stack/architecture without writing anything | `/aia-harness:scan` |
| **Configure the harness from scratch** on a new project (diagnose → approve → apply with diffs) | `/aia-harness:init` |
| **Audit** an existing harness and receive targeted fixes | `/aia-harness:doctor` |
| **Update part** of a project that already has the harness (e.g. only `settings.json`, only hooks) | `/aia-harness:patch` |
| Re-apply **everything** overwriting existing files | `/aia-harness:patch` and select all categories |
| Add **strategic MCP servers** (`.mcp.json`) | `/aia-harness:add-mcp` |
| Install the **recommended marketplace plugins** for the stack | `/aia-harness:add-plugins` |
| Install **token-economy / code-graph tools** (caveman, ponytail, rtk, graphify) | `/aia-harness:add-tools` |
| Generate or refresh **rich intermediate CLAUDE.md** files for strategic subdirectories | `/aia-harness:revise-claude-md` |
| See this help | `/aia-harness:help` |

**Project state → recommended command:**

- **Project without harness** → `/aia-harness:init`
- **Project with outdated harness** (after plugin upgrade) → `/aia-harness:doctor` detects and **adds what is missing** (new agents/hooks/skills/rules) without touching what exists; use `/aia-harness:patch` to **overwrite** artifacts that changed (e.g. `settings.json`, hooks)
- **Project with harness, suspected problem** (broad permissions, wrong hooks, bloated CLAUDE.md) → `/aia-harness:doctor`
- **Just want to understand the project before touching it** → `/aia-harness:scan`

> Every command accepts an optional path as its first argument. Without it, the
> target is `$CLAUDE_PROJECT_DIR` (the current project). E.g. `/aia-harness:doctor /path/to/project`.

---

## Commands in detail

### `/aia-harness:scan [path]`

**What it does:** runs the deterministic scanner and prints the diagnosis — primary
language, stack, package manager, frameworks, monorepo, canonical commands,
architecture domains, and existing harness artifacts.
**When to use:** before any write, or just to understand a project.
**Writes files?** No — 100% read-only.
**Parameters:** `path` (optional) → target directory.

### `/aia-harness:init [path]`

**What it does:** full scaffolding flow — diagnose → plan → **per-category consent**
→ preview with diffs → apply → enrich `CLAUDE.md` files (3 passes analyzing real
code) → review with the `harness-reviewer` agent → offer to install
plugins/tools/MCP interactively → second opinion via
`claude-automation-recommender`.
**When to use:** project **without** a harness, or to rebuild from scratch.
**Writes files?** Yes, but **never without approval** and always with a diff before overwriting.
**Dedicated question:** "Stop verification" — if accepted (recommended), installs the
strict loop that runs lint + typecheck on finish and blocks until they pass.
**Parameters:** `path` (optional).

### `/aia-harness:doctor [path]`

**What it does:** audits an existing harness and grades it — bloated or generic
`CLAUDE.md`, unfilled `AI-ENRICH` stubs, suppressed fixed rules (`aia-harness:fixed`),
broad `settings.json` permissions, misconfigured hooks,
`.mcp.json` with literal secrets, `.gitignore` missing `*.local.*`, absence of
unit tests. **Also detects what is missing vs. the current plugin version**
(new agents/hooks/skills/rules) by running `plan` and comparing the `exists` flag of
each artifact — and offers to **add only the missing ones** via additive apply (no
`--force`, leaves what already exists untouched). Presents prioritized findings and applies
each fix **only after approval**, with a diff.
**When to use:** project **with** a harness — validate quality, **or after a plugin upgrade to receive new artifacts** without overwriting what exists (to overwrite changed artifacts, use `/aia-harness:patch`).
**Writes files?** Only approved fixes, via `Edit` (never mass-rewrites).
**Parameters:** `path` (optional).

### `/aia-harness:patch [path]`

**What it does:** selectively re-applies artifact categories in an already-configured
project. Lists available categories, you choose **one or more**
(multi-select), and behind the scenes runs `apply --yes --force --only=<ids>` only for
what was chosen.
**When to use:** project **with** a harness that needs only a part updated (e.g. `settings.json` changed in the plugin, or you want to reinstall hooks without touching `CLAUDE.md` files).
**Writes files?** Yes — **overwrites with `--force`** only the selected categories; the rest is untouched.
**Available categories:** `settings`, `hooks`, `claude-md`, `rules`, `mcp`, `skills`, `agents`, `tools` (only those present in the plan appear).
**Parameters:** `path` (optional).

### `/aia-harness:add-mcp [path]`

**What it does:** suggests strategic MCP servers and merges them into the project-root
`.mcp.json` (creating it if absent), always with `${ENV_VAR}` placeholders —
never a literal secret. Adds the empty env keys to
`.claude/settings.local.json` (gitignored) for you to fill.
**When to use:** you want to give the agent access to external services (github, context7, etc).
**Writes files?** Yes — `.mcp.json` and `settings.local.json`, with merge (no clobber) and diff.
**Parameters:** `path` (optional). Default github on git repos.

### `/aia-harness:add-plugins [path]`

**What it does:** installs the recommended marketplace plugins for the stack
(code-review, hookify, feature-dev, frontend-design, context7, github,
claude-code-setup + per-language LSP). Generates the idempotent installer
`scripts/install-plugins.mjs` and, after **one confirmation**, runs it.
**When to use:** you want the recommended plugins without installing them manually.
**Writes files?** Generates `scripts/install-plugins.mjs`. Plugins install at **user level** (Claude Code has no per-project install).
**Parameters:** `path` (optional). Remember to **restart Claude Code** afterwards.

### `/aia-harness:add-tools [path]`

**What it does:** installs token-economy / code-graph tools: **caveman** and
**ponytail** install as global Claude Code plugins (user-level, activate across all
projects); the guarded **rtk** hook and the **claude-code-worktrees** skill are
project-level (vendored into `.claude/`). **graphify** is project-level via CLI.
Vendoring + wiring of rtk/worktrees is automatic; plugin/binary/package installs
(caveman, ponytail, rtk, graphify) run only after **one confirmation**.
**When to use:** you want to reduce token consumption or have a code graph.
**Writes files?** Yes — only the rtk hook in `.claude/hooks/` and claude-code-worktrees in `.claude/skills/`, wiring in `settings.json`, `.graphifyignore`. Caveman and ponytail install as user-level plugins — do **not** write to `.claude/`.
**Parameters:** `path` (optional). Scope: `--no-tools`.

### `/aia-harness:revise-claude-md [path]`

**What it does:** generates rich, concrete CLAUDE.md files for strategic subdirectories of the
target project. Two-phase flow: Phase 1 discovers domains (scan-detected + own analysis), maps
`.claude/rules/` files (recursive — including `ecc/`, `stack/` subdirs) to domains by relevance,
and presents a plan for approval. Phase 2 reads up to 8 key source files per domain + applicable
rule files, generates domain CLAUDE.md with `## Key patterns` (concrete class names, DI tokens,
naming patterns), `## Applied rules` (condensed rule summaries + `@`-references), and
`## Local conventions` (derived from real code). Shows diff before each write; never writes
without approval.
**When to use:** after `/aia-harness:init` (runs automatically as step 5.6), or standalone to
refresh domain CLAUDE.md files when project structure or rules change.
**Writes files?** Yes — `<domain>/CLAUDE.md` files only, never root CLAUDE.md, always with diff + approval.
**Parameters:** `path` (optional).

---

## ⚙️ Engine CLI behind the commands

The commands above are wrappers over the deterministic binary
`bin/aia-harness` (= `bin/harness.mjs`). For direct use / debugging:

```bash
aia-harness scan  [dir] [--json]     # diagnose → ProjectProfile (read-only)
aia-harness plan  [dir] [--json]     # ProjectProfile → HarnessPlan (no writes)
aia-harness apply [dir] [--yes]      # apply the plan (dry-run without --yes)
aia-harness help | version
```

**`apply` flags:**

| Flag | Effect |
| --- | --- |
| `--yes` | Actually writes. Without it, **dry-run** (preview). |
| `--force` | Overwrites existing files that differ. Without it, they are **skipped**. |
| `--only=id,id` | Applies only artifacts with those IDs (basis of `/aia-harness:patch`). |
| `--tools=a,b` | Limits which project-level tools to install. |
| `--no-tools` | Skips all project-level tools. |
| `--no-strict` | Stop hook becomes a passive reminder instead of the blocking lint + typecheck loop (default is **strict on**). |

**Safety (invariants no command breaks):** consent gate before writing, diff before
overwriting, secrets only as `${ENV}`, `*.local.*` in gitignore, guard hooks exit
with code 2 / formatters fail open.
