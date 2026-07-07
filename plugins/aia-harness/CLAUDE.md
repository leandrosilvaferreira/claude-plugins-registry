# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

`aia-harness` is two surfaces over one engine:

1. **Claude Code plugin** — commands (`commands/`), agents (`agents/`), skills (`skills/`), hooks (`hooks/`) that drive an interactive **diagnose → approve → apply** flow.
2. **Deterministic CLI** (`bin/harness.mjs`) — pure engine the commands shell out to, invoked via `node bin/harness.mjs`. The old `bin/aia-harness` shell wrapper was removed for cross-platform `.mjs`-only compliance (see `.claude/rules/scripts-cross-platform.md`).

It scans a target project, diagnoses its stack/architecture, and scaffolds a harness (CLAUDE.md files, rules, settings, hooks, skills, agents, `.mcp.json`, worktree config) into *that* project — including vendored ECC agents/skills/rules and token-economy
tools (caveman, ponytail, rtk, graphify). The plugin never edits the target without consent + diffs.

## Codebase Profile

- **Type**: Node ≥18, pure ESM (.mjs), no build step
- **Typing**: JSDoc + tsc --checkJs (no .ts files)
- **Tooling**: ESLint flat config, node --test, vendoring scripts that fetch remote code from GitHub (ECC/tools, pinned by commit)

## Commands

```bash
npm run typecheck   # tsc --checkJs over JSDoc types (noEmit)
npm run lint        # eslint flat config
npm run test:unit   # node --test tests/*.test.mjs
npm test            # all three (typecheck + lint + unit)

node --test tests/plan-apply.test.mjs   # run a single test file
npm run sync:ecc    # re-vendor ECC assets, pinned in scripts/ecc-source.json
npm run sync:tools  # re-vendor tool assets, pinned in scripts/tools-source.json
npm run sync:agkit  # re-vendor ag-kit assets, pinned in scripts/agkit-source.json
```

Engine CLI (also what commands invoke):

```bash
node bin/harness.mjs scan  [dir] [--json]    # diagnose -> ProjectProfile
node bin/harness.mjs plan  [dir] [--json]    # ProjectProfile -> HarnessPlan
node bin/harness.mjs apply [dir] [--yes]     # write plan; dry-run unless --yes
                     [--only=id,id] [--force] [--tools=a,b | --no-tools]
```

Release: see `PUBLISHING.md` (version bump + registry publish via `BUMP`/`PUSH`/`TAG` env vars + `npm run publish-registry`).

---

## Behavioral guidelines

1. **Think before coding** — state assumptions explicitly; if multiple interpretations exist, present them instead of picking silently; say so when a simpler approach exists; if something is unclear, stop and ask.
2. **Simplicity first** — minimum code that solves the problem. No speculative features, no abstractions for single-use code, no unrequested configurability, no error handling for impossible scenarios. If 200 lines could be 50, rewrite.
3. **Surgical changes** — touch only what the request requires; match existing style; don't refactor, reformat, or "improve" adjacent code. Remove orphans *your* change created; leave pre-existing dead code alone (mention it, don't delete it). Every changed line should trace directly to the user's request.
4. **Goal-driven execution** — turn tasks into verifiable goals ("fix the bug" → "write a test that reproduces it, then make it pass"). For multi-step work, state a brief plan with a verify check per step, then loop until verified.

---

## Surface (slash commands)

`scan` (read-only diagnosis) · `init` (full diagnose→approve→apply) · `doctor`
(audit existing harness) · `patch` (selective force-overwrite of artifact categories in
an already-configured project — prompts user to pick categories, then runs
`apply --yes --force --only=…`) · `add-mcp` · `add-plugins` (runs
`scripts/install-plugins.sh`) · `add-tools` (install caveman/ponytail as global Claude Code plugins; vendor rtk hook + graphify)
· `help` (full command reference + "I want to…" decision guide). `init`/`doctor` close
by invoking the `claude-automation-recommender` skill for a second opinion.

## Architecture: the scan → plan → apply pipeline

Data flows through three stages, each a pure-ish boundary:

1. **`lib/detect/index.mjs` → `ProjectProfile`.** `scanProject(root)` walks files once (`lib/util/fs.mjs`) then runs per-concern detectors (`language`, `package-manager`, `frameworks`, `monorepo`, `commands`, `architecture`, `existing`, `vcs`, `testing`, `large-files`). The profile shape is defined as JSDoc typedefs in `lib/profile.mjs` — that module is **type-only, no runtime**. Detection is read-only. `lib/detect/testing.mjs` runs last and uses the already-built profile + file list to populate `profile.testing` (`TestingInfo`): it detects the unit-test gap (E2E-only frameworks excluded) and calls `recommendTesting` from `lib/data/testing-catalog.mjs` when unconfigured. `lib/detect/large-files.mjs` then populates `profile.largeFiles` (`LargeFilesInfo`): it byte-gates the file list and line-counts only plausibly-large source files to count pre-existing files over 350 lines, and recommends the large-file guard mode (`block` for a clean repo, `advisory` when offenders already exist) — surfaced in the scan report and used to default the `--large-files` flag.

2. **`lib/plan.mjs` `buildPlan(profile, ctx)` → `HarnessPlan`.** Turns the profile into an ordered list of `Artifact`s. Each artifact is either inline `content` (rendered by `lib/generate/*`) or `copyFrom` an absolute source path under `templates/`. Generators: `claude-md`, `rules`, `settings`, `mcp`, `misc`. Data catalogs (`lib/data/*`) decide *what* applies — `mcp-catalog`, `plugins-catalog`, `frameworks`, `languages`, plus the **distributable-asset catalogs** (see below). Artifacts carry `contextCost` (est. tokens loaded every session; 0 = lazy/path-scoped) and `defaultSelected`. **Decision-only catalog (NOT in asset-catalog barrel):** `testing-catalog.mjs` maps stack keys to unit-test framework recipes (`recommendTesting(profile) → TestingRecipe | null`); its output surfaces in the scan report, the generated CLAUDE.md note, and the plan `notes` array. The `setup-testing` first-party skill (registered in `project-catalog.mjs`) is the agentic complement that installs + seeds a real test when invoked.

   **Distributable-asset catalogs** — one module per provenance, all behind the `asset-catalog.mjs` barrel that `plan.mjs` imports from (never import the source catalogs directly):
   - `ecc-catalog.mjs` — ECC assets (MIT © Affaan Mustafa), `templates/ecc/`, mapped by stack.
   - `agkit-catalog.mjs` — ag-kit assets (MIT © vudovn), `templates/ag-kit/`, mapped by stack.
   - `project-catalog.mjs` — **first-party** skills + hooks we own (`templates/skills/`, `templates/hooks/`).
   - `tools-catalog.mjs` — caveman/ponytail (global Claude Code plugins, strategy "plugin"); rtk hook + graphify (project-level, strategy "vendor"/"cli"); `templates/tools/`; structurally different (`ToolDef` + machine deps + settings-hook wiring).
   - `stack-keys.mjs` — pure `profile → stack-key` resolver shared by the stack-specific catalogs.

3. **`lib/apply.mjs` `applyPlan(plan, root, opts)`.** Writes artifacts. **Safe by default**: dry-run unless `dryRun:false`; never overwrites an existing *differing* file unless `force`; `.gitignore` updated idempotently under an `# aia-harness` header. Handles both file and directory (`copyFrom` a dir) artifacts.

### Vendoring (ECC + tools)

`templates/ecc/` and `templates/tools/` hold third-party assets vendored from upstream repos pinned in `scripts/*-source.json`. The `sync-*.mjs` scripts fetch and rewrite them through the **pure transforms** in `lib/ecc/transform.mjs` and `lib/tools/transform.mjs` (frontmatter split, section removal, provenance stamping) — no IO in those transform modules, so they're unit-tested directly. Provenance (repo + commit + path + license) is stamped into every vendored file and `templates/ecc/MANIFEST.json`. ECC content is MIT © Affaan Mustafa — keep attribution.

A third vendored source, `templates/ag-kit/`, mirrors the ECC pattern for
[vudovn/ag-kit](https://github.com/vudovn/ag-kit) (MIT): `scripts/agkit-source.json`
pins the commit, `scripts/sync-agkit.mjs` (`npm run sync:agkit`) fetches and rewrites
through the pure transforms in `lib/agkit/transform.mjs` (Antigravity→Claude Code
frontmatter conversion: drop the agent `skills:` field, force `model: sonnet`, map
Antigravity tools, fold skill `when_to_use` into `description`). `lib/data/agkit-catalog.mjs`
decides what applies by detected stack. ag-kit content is MIT © vudovn — keep attribution.

`lib/data/tools-catalog.mjs` adds project-level tools: caveman/ponytail installed as global Claude Code plugins (strategy "plugin"; not vendored, not wired in settings.json), a guarded rtk `PreToolUse` hook,
and graphify. `plugins-catalog` generates a runnable `scripts/install-plugins.mjs`
(marketplace add via repo, install via registered name). github MCP is default on git repos.

## Conventions

- **All source code must be in English** — this applies to every file in this repository and every file scaffolded into target projects (`templates/`, generated CLAUDE.md content, skills, agents, hooks, rules, comments, identifiers, string literals, log messages, error messages). If any Portuguese text is found in source code, translate it to English immediately before proceeding with any other task.
- **All source is `.mjs` ESM with JSDoc types** — no TypeScript files, no build step. `tsconfig.json` runs `checkJs` for type safety; add `@typedef`/`@param`/`@returns` JSDoc rather than `.ts`. Hooks shipped into target projects are also plain `.mjs` so they run without compilation.
- **`lib/` is pure and tested**; IO lives at the edges (`detect` reads, `apply` writes, `bin` orchestrates). Keep generators and catalogs side-effect-free so they stay unit-testable.
- **Adding an artifact type**: extend the generator/catalog, then `add(...)` it in `buildPlan` with a `category`, `rationale`, `contextCost`, and `defaultSelected`. Prefer `contextCost: 0` (lazy/path-scoped) unless it must load every session.
- **Asset catalog — mandatory maintenance**: whenever you create, import, or update an agent, skill, rule, or command distributed to target projects (anything under `templates/`), you **must** register it in the matching source catalog in the same change — keyed by **provenance**, not convenience:
  - ECC asset → `ecc-catalog.mjs` (`ECC_COMMON` / `ECC_BY_STACK`).
  - ag-kit asset → `agkit-catalog.mjs` (`AGKIT_COMMON` / `AGKIT_BY_STACK`).
  - **our own** skill (`templates/skills/`) or hook (`templates/hooks/`) → `project-catalog.mjs`: stack-independent skills/rules in `PROJECT_COMMON`, per-stack ones in `PROJECT_BY_STACK`; hooks copied to every target in `PROJECT_HOOK_FILES`, hooks shipped + settings-wired only for a stack (e.g. PHPStan for PHP) in `PROJECT_HOOK_BY_STACK` (consumed via `selectProjectHooks`).
  - vendored tool → `tools-catalog.mjs` (`TOOLS`).

  All four are re-exported by the `asset-catalog.mjs` barrel, which is the single import surface for `plan.mjs`. A new stack key goes in `stack-keys.mjs`. Note: `skills/` at the repo root (plugin skills that travel with the plugin, e.g. `harness-engineering`) are NOT distributed and NOT in any catalog.
- **Deps catalog — mandatory maintenance**: `lib/data/deps-catalog.mjs` is the single source of truth for system dependency checking. Three catalogs must stay in sync at all times — a CI test (`tests/deps-catalog-integrity.test.mjs`) enforces this:
  - **Adding a new tool to `TOOLS`** (tools-catalog): if it has system deps, add `TOOL_DEPS[tool.id]` in deps-catalog listing every required binary, then add `INSTALL_HINTS[binary]` for each platform (`win32`/`darwin`/`linux`) with non-empty install commands.
  - **Adding a binary to `STACK_DEPS`** (new language support): add a matching `INSTALL_HINTS[binary]` entry.
  - **Removing a tool from `TOOLS`**: remove its `TOOL_DEPS` entry too (orphan check enforced by tests).
  - The `ToolDef.deps` field (e.g. `["binary:rtk"]`) is documentation for humans and the `add-tools` command. The runtime uses `TOOL_DEPS[tool.id]` via `resolveDepsFromProfile`. Both must be updated together.
  - Run `npm test` after any change to either catalog — the integrity suite catches all four failure modes.
- **Agent description standard — mandatory**: every candidate agent's routing description lives in its provenance `*_AGENT_WHEN_TO_USE` map (single source of truth for frontmatter + CLAUDE.md table). After adding/editing an agent, run `/revise-agent-frontmatter` and `npm test` (`tests/agent-frontmatter-standard.test.mjs` enforces it). See `.claude/rules/agent-frontmatter-standard.md`.
- **Safety invariants** (don't regress):
  - Consent gate before writes; diffs before overwrite; secrets only as `${ENV}` placeholders; `*.local.*` gitignored; guard hooks exit 2 / formatters fail open.
  - **Strict Stop hook** (`verify-on-stop.mjs`, default on; `--no-strict` opts out) — deliberate exception #1 to "Stop never blocks": blocks on real lint/typecheck failures so the agent self-corrects, but stays **fail-open on infra** (missing runtime/command never blocks) and only runs when the session edited lintable code (gated by `set-files-changed.mjs`).
  - **Large-file guard** (`large-file-warning.mjs`, always installed) — dual-mode, selected at init and threaded via `--large-files=block|advisory` (default = the detector's `profile.largeFiles.recommended`): `block` wires it under `Stop` and returns `decision:"block"` so the agent refactors files over 350 lines before finishing (exception #2; anti-loop via `stop_hook_active`); `advisory` wires it under `PostToolUse` and injects `additionalContext` suggesting a refactor + user confirmation, never blocking. `renderSettings`/`buildPlan` choose the wiring; `/patch` and `/doctor` preserve or offer to configure the mode.
- **Hook output schema compliance — mandatory**: every hook under `templates/hooks/` needs a compliance test in `tests/hook-<name>.test.mjs` covering **every** output branch, each asserted via the matching validator from `lib/validate/hook-schema.mjs` AND `assertCleanStdoutJson` (`tests/hook-runner.mjs`). Exit codes 0 and 2 are the only valid codes; include `hookSpecificOutput.hookEventName` whenever emitting `hookSpecificOutput`. The full 30-event schema/validator/SDK-type reference lives in `.claude/rules/hook-output-schema.md` (auto-loads when editing hooks, validators, or hook tests). When bumping `@anthropic-ai/claude-agent-sdk`, re-review `lib/validate/hook-schema-sdk-typecheck.mjs` — a `tsc` failure there means the SDK changed a shape a validator relies on.
- **Hook cwd resolution — mandatory**: any hook that resolves a directory for a command or a path check must prefer `event.cwd` over `CLAUDE_PROJECT_DIR`/`process.cwd()`, except for the small set of hooks that hash a *stable* session key for a shared flag file, which must keep using `CLAUDE_PROJECT_DIR` alone. Full standard: `.claude/rules/hooks-cwd-resolution.md` (auto-loads when editing hooks).
- `templates/` is excluded from lint and typecheck (it's vendored/scaffolded output, not engine code).

@.claude/memory/INSTRUCTIONS.md
@.claude/memory/MEMORY.md

## graphify

This project has a knowledge graph at graphify-out/ with god nodes, community structure, and cross-file relationships.

Rules:

- For codebase questions, first run `graphify query "<question>"` when graphify-out/graph.json exists. Use `graphify path "<A>" "<B>"` for relationships and `graphify explain "<concept>"` for focused concepts. These return a scoped subgraph, usually much smaller than GRAPH_REPORT.md or raw grep output.
- If graphify-out/wiki/index.md exists, use it for broad navigation instead of raw source browsing.
- Read graphify-out/GRAPH_REPORT.md only for broad architecture review or when query/path/explain do not surface enough context.
- After modifying code, run `graphify update .` to keep the graph current (AST-only, no API cost).
