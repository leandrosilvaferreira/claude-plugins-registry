---
description: Show the full aia-harness command reference — what each command does, when to use it, parameters and options — with a "I want to…" quick-start guide at the top.
allowed-tools:
  - Bash
  - AskUserQuestion
---

# aia-harness command guide

Present this guide to the user in full and well-formatted.
Start with the "Where to start" section, then detail each command. If useful, show the
engine version — it is the `running` field the version check below already returns, so
there is no need to invoke the engine a second time for it.

---

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

## 🚀 Where to start (decision guide)

| If you want to… | Use |
| --- | --- |
| **Just diagnose** the stack/architecture without writing anything | `/aia-harness:scan` |
| **Configure the harness from scratch** on a new project (diagnose → approve → apply with diffs) | `/aia-harness:init` |
| **Audit** an existing harness and receive targeted fixes | `/aia-harness:doctor` |
| **Update part** of a project that already has the harness (e.g. only `settings.json`, only hooks) | `/aia-harness:patch` |
| **My project already has a customized harness** and I want the latest version without losing my edits | `/aia-harness:patch` — merges what's safe automatically, then adjudicates every conflicting file with you, diff by diff |
| Re-apply **everything**, merging in changes and adjudicating whatever conflicts | `/aia-harness:patch` and select all categories |
| Add **strategic MCP servers** (`.mcp.json`) | `/aia-harness:add-mcp` |
| Install the **recommended marketplace plugins** for the stack | `/aia-harness:add-plugins` |
| Install **token-economy / code-graph tools** (caveman, ponytail, rtk, graphify) | `/aia-harness:add-tools` |
| Add **long-term memory** / a knowledge vault to this project | `/aia-harness:add-obsidian` |
| Generate or refresh **rich intermediate CLAUDE.md** files for strategic subdirectories | `/aia-harness:revise-claude-md` |
| **Sync agent routing** — audit `.claude/agents` frontmatter descriptions and fix stale/missing CLAUDE.md mentions | `/aia-harness:revise-agent-routing` |
| **Check consistency** — every skill/agent/rule/script/CLAUDE.md cross-reference resolves, and each artifact still fits the real stack | `/aia-harness:check-consistency` |
| See this help | `/aia-harness:help` |

**Project state → recommended command:**

- **Project without harness** → `/aia-harness:init`
- **Project with outdated harness** (after plugin upgrade) → `/aia-harness:doctor` detects and **adds what is missing** (new agents/hooks/skills/rules) without touching what exists, and **merges in** artifacts that changed (e.g. `settings.json`, hooks) — any conflicting file is adjudicated with you, never silently overwritten; `/aia-harness:patch` runs the same merge-and-adjudicate flow by category instead of by drift
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
unit tests. **Also detects drift against the current plugin version:** artifacts that
are **missing** (new agents/hooks/skills/rules shipped since this project was set up)
are added via additive apply (no `--force`, leaves what already exists untouched);
artifacts that are **installed but differ** (stale routing descriptions, an outdated
rule) are merged in — one with an additive merge strategy (`settings.json`,
`.mcp.json`) is merged with the existing value always winning, and anything else that
exists and differs — including a merged `CLAUDE.md` section, which replaces the whole
section rather than merging key-by-key — is parked in `conflicts[]` and adjudicated with
you, diff by diff, the same procedure `/aia-harness:patch` uses. Presents prioritized
findings and applies each fix **only after approval**, with a diff.
**When to use:** project **with** a harness — validate quality, add artifacts missing
after a plugin upgrade, or refresh stale ones without losing customizations (to sweep
whole categories instead of only the stale ones, use `/aia-harness:patch`).
**Writes files?** Only approved fixes — `Edit` for targeted corrections, plus merge-mode
`apply` for missing/stale artifacts (never a raw overwrite without adjudication).
**Parameters:** `path` (optional).

### `/aia-harness:patch [path]`

**What it does:** merges artifact categories into an already-configured project — not a
blind overwrite. Lists available categories, you choose **one or more** (multi-select),
and behind the scenes runs `apply --yes --merge --only=<ids> --large-files=<mode> --json`
for what was chosen: a missing file is created, an identical one is skipped, one with an
additive merge strategy (`settings.json`, `.mcp.json`) is merged with the existing value
always winning, and anything else that exists and differs — including a merged `CLAUDE.md`
section, which replaces the whole section rather than merging key-by-key — is parked in
`conflicts[]` — adjudicated with you one file at a time (a real diff, its git history, a
proposed merge) before anything is written.
**When to use:** project **with** a harness that needs only a part updated (e.g. `settings.json` changed in the plugin, or you want to reinstall hooks without touching `CLAUDE.md` files) — including a harness that's been hand-customized, since a conflicting file is never silently overwritten.
**Writes files?** Yes — the selected categories, merged; a file with no safe merge path is written only after you approve its diff.
**Available categories:** `settings`, `hooks`, `claude-md`, `rules`, `mcp`, `skills`, `agents`, `tools`, `git-hooks`, `github-pm`, `obsidian` (offered only when already installed), `docs`, `lsp`, `worktree`, `script`, `commands` (only those present in the plan appear).
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

### `/aia-harness:add-obsidian [path]`

**What it does:** installs the Obsidian vault-as-memory pillar — a versioned
PARA vault, the `obsidian` MCP server, 6 hooks that keep it oriented and
synced automatically, a usage rule, and the required MCP tool permission.
**When to use:** the project wants durable, searchable long-term memory
(past decisions, abandoned approaches, cross-module conventions) beyond what
CLAUDE.md/rules and git history already capture.
**Writes files?** Yes — creates the vault folder + templates, edits
`.mcp.json` and `.claude/settings.json` (permissions + hook wiring), copies 6
hooks + 2 runner scripts + a rule, and merges a CLAUDE.md section.
**Parameters:** `path` (optional). Defaults to the current directory.

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

### `/aia-harness:revise-agent-routing [path]`

**What it does:** audits every `.claude/agents/*.md` frontmatter `description` against the
routing-description standard (condition-shaped, "Use proactively" + trigger, 40-600 chars) and
offers to fix it in place. Cross-references each agent against the project's CLAUDE.md
`## Workflow & Agents` table (or free-text mentions if there's no table): fixes stale table
rows, proposes a minimal edit for name-only mentions, and flags/offers to add orphaned agents
(never mentioned anywhere). Works on any existing project, not just one scaffolded by
aia-harness. Shows a diff before every write; never writes without approval.
**When to use:** after adding or editing agents by hand, via a third-party plugin, or via
`/aia-harness:add-plugins` — anything that didn't go through `/aia-harness:init`'s own
agent-description pipeline.
**Writes files?** Only approved fixes, via `Edit` — agent frontmatter `description:` lines and
CLAUDE.md `## Workflow & Agents` rows/sections.
**Parameters:** `path` (optional).

### `/aia-harness:check-consistency [path]`

**What it does:** audits the whole harness as a graph. A deterministic pass enumerates
every skill, agent, rule, command, hook/script and `CLAUDE.md` (root **and** nested) and
resolves every path-shaped reference between them, reporting the ones that point at
nothing and the hook scripts that are never wired in `settings.json` **and** never
mentioned anywhere else (an import, a spawn path, a CLAUDE.md mention). Parallel `sonnet`
subagents — one per artifact category — then settle the ambiguous name references and
judge whether each artifact's content still fits the project's **real** detected stack
(language, frameworks, library versions), flagging guidance written for a framework,
tool, or version the project no longer uses. Findings are consolidated into one plan you
approve by category; approved fixes are applied by dispatched subagents in parallel
waves, then re-verified deterministically.
**When to use:** a harness that has drifted — hand-edited artifacts, files renamed or
deleted, a stack that moved (framework swap, major version bump), or artifacts added by
plugins/other tools that nothing references.
**Writes files?** Only approved fixes — every finding, mechanical reference repair or
content rewrite alike, is shown as a diff before anything is written, then applied by a
dispatched subagent after approval. One named exception: the routing-sync sub-step (agent
descriptions vs. the CLAUDE.md table) edits in this skill's own thread, under its own
per-finding approval gate, not a dispatched subagent.
**Parameters:** `path` (optional).

---

## ⚙️ Engine CLI behind the commands

The commands above are wrappers over the deterministic entrypoint
`bin/harness.mjs`, invoked via `node` (there is no `bin/aia-harness`). For direct use / debugging:

```bash
node bin/harness.mjs scan  [dir] [--json]     # diagnose → ProjectProfile (read-only)
node bin/harness.mjs plan  [dir] [--json]     # ProjectProfile → HarnessPlan (no writes)
node bin/harness.mjs apply [dir] [--yes]      # apply the plan (dry-run without --yes)
node bin/harness.mjs version-check [--json]   # is this copy the latest published one?
node bin/harness.mjs help | version
```

`version-check` is what every command runs first. It compares the running copy's
`.claude-plugin/plugin.json` against the marketplace clone (refreshing it, capped at 15s,
throttled to once per 15 min) and always exits 0 — `"unknown"` means the answer was
unavailable, never that something failed. `--no-refresh` skips the network entirely.

**`apply` flags:**

| Flag | Effect |
| --- | --- |
| `--yes` | Actually writes. Without it, **dry-run** (preview). |
| `--force` | Overwrites existing files that differ, bypassing every merge strategy. The deliberate blind escape hatch — no command invokes it unconditionally. |
| `--merge` | **No-op**, accepted only for backward compatibility. Merging is the default apply behaviour, so passing it changes nothing; `--force` is the only bypass. |
| `--only=id,id` | Applies only artifacts with those IDs (basis of `/aia-harness:patch`). |
| `--tools=a,b` | Limits which project-level tools to install. |
| `--no-tools` | Skips all project-level tools. |
| `--no-strict` | Stop hook becomes a passive reminder instead of the blocking lint + typecheck loop (default is **strict on**). |

**Safety (invariants no command breaks):** consent gate before writing, diff before
overwriting, secrets only as `${ENV}`, `*.local.*` in gitignore, guard hooks exit
with code 2 / formatters fail open. Merging is the **default**, so `apply` never
overwrites a differing file without adjudication and never `rm -rf`s a directory
artifact: a file that exists and differs with no mechanical strategy — and a merged
`CLAUDE.md` section that exists and differs, which replaces the whole section rather
than merging it key by key — is parked in `conflicts[]` instead. `--force` is the only
bypass.
