# aia-harness — Design & Implementation Spec

Date: 2026-06-17
Status: Approved (autonomous build per session goal)

## 1. Purpose

A Claude Code **plugin** that, when run inside any project, scans it to detect
language/stack/frameworks/libraries/architecture, then **scaffolds a complete
"harness engineering" setup** for Claude Code — hooks, skills, agents, rules,
scripts, per-project `settings.json`, project-root `.mcp.json`, env vars in
`settings.local.json`, worktree configuration, and `CLAUDE.md` files at the
root and per architectural domain.

It is modeled on the native Claude Code skills `claude-automation-recommender`,
`claude-md-improver`, and `revise-claude-md` (the screenshot reference), but
adds the missing **write/scaffold phase** those read-only tools lack.

## 2. Decisions (locked)

| Fork | Decision |
|------|----------|
| Apply mode | **Diagnose → approve → apply** with diffs (consent gate). Never write without showing diffs. |
| v1 first-class stacks | **JS/TS + PHP** deep; all other languages via a generic, extensible fallback. |
| Generated-artifact language | **English** for generated artifacts (CLAUDE.md, rules, reports); **Portuguese** for interactive conversation with the user. |
| Plugin toolchain | Plain modern **JS (ESM `.mjs`) + JSDoc**; typecheck via `tsc --checkJs --noEmit`; tests via `node --test`; lint via ESLint flat config. No build step. |
| Hook scripts | Plain Node **ESM `.mjs`**, run via a node-resolver wrapper. Works identically for `.js`-only and TypeScript target projects (zero build at the target). |

## 3. Architecture — Hybrid (deterministic engine + adaptive skills)

A deterministic JS engine produces facts and a scaffold plan; the Claude Code
surface (commands/skills/agents) orchestrates the report → consent → diff →
apply loop and lets Claude tailor generated prose.

```
aia_harness/
├── .claude-plugin/
│   ├── plugin.json            # manifest
│   └── marketplace.json       # distribution
├── commands/                  # /aia-harness:scan|init|doctor|add-mcp
├── agents/                    # stack-analyst, architecture-mapper, harness-reviewer
├── skills/                    # operational skills (detection, generation, authoring, catalog)
├── hooks/hooks.json           # plugin's own hooks (minimal/none intrusive)
├── lib/                       # deterministic engine (TESTED)
│   ├── detect/{language,stack,commands,architecture,index}.mjs
│   ├── profile.mjs            # ProjectProfile typedefs (JSDoc)
│   ├── plan.mjs               # Profile -> artifact plan (+ context-cost estimate)
│   ├── apply.mjs              # write with diffs, gitignore *.local.*
│   ├── render.mjs             # markdown diagnosis report
│   └── util/{fs,json,...}.mjs
├── bin/harness.mjs            # thin CLI over lib (scan/plan/apply)
├── templates/                 # scaffold sources copied/rendered into target
│   ├── hooks/                 # *.mjs hook scripts + node-run wrapper (sh + cmd)
│   ├── claude-md/             # root + per-domain CLAUDE.md templates
│   ├── rules/                 # .claude/rules/*.md with paths: frontmatter
│   ├── settings/             # settings.json + settings.local.json skeletons
│   ├── mcp/catalog.json       # curated market MCP catalog (env placeholders)
│   ├── skills/                # installable skill templates for the target
│   ├── worktree/              # worktree config + WorktreeCreate/Remove examples
│   └── lsp/                   # .lsp.json strategy (vtsls / intelephense)
├── tests/                     # node:test + fixtures/
├── docs/specs/                # this file
├── package.json tsconfig.json eslint.config.mjs .gitignore README.md
```

### Why hybrid (vs alternatives)

- **All-JS deterministic**: testable but cannot adapt prose/edge cases.
- **All-skill (Claude-driven)**: adaptive but non-deterministic, untestable, token-heavy.
- **Hybrid (chosen)**: deterministic core is unit-testable/lintable/typecheckable
  (satisfies "compiling + tests + lint"), Claude adds adaptive tailoring + safety review.

## 4. Detection engine (`lib/detect`)

Produces a `ProjectProfile`:

- `languages[]` — Linguist-style (marker files + extension byte counts), primary language.
- `packageManager` — lockfile precedence + `packageManager` field (JS); composer (PHP).
- `frameworks[]` — `@vercel/frameworks`-style matcher (dep regex | marker path | content).
- `monorepo` — turbo/nx/lerna/pnpm-workspace/workspaces/`go.work`/cargo workspace.
- `commands` — lint/format/typecheck/test/build/run, discovered by priority:
  declared scripts > task runners > config-implied tool > ecosystem default, cross-checked with CI.
- `architecture` — domains/layers inferred from directory tree (src, app, packages, modules, domains, layered dirs).
- `existingHarness` — any current `.claude/`, `CLAUDE.md`, hooks, settings, `.mcp.json`.
- `vcs` — git presence, worktree readiness.

First-class detail for **JS/TS** and **PHP** (Laravel/Symfony); other languages get
a structured generic profile (language + best-effort commands) so the fallback still works.

## 5. Generated harness (the scaffold plan)

For each item: rationale + estimated context cost; user selects via multiselect consent gate.

1. **CLAUDE.md (root)** — concise, top-loaded critical rules, stack + canonical commands.
2. **Per-domain CLAUDE.md** — lazy-loaded files in each detected domain folder.
3. **`.claude/rules/*.md`** — path-scoped (`paths:` frontmatter) lint/test/style rules per language.
4. **`settings.json`** — least-privilege permissions, model, hook wiring (committed).
5. **`settings.local.json`** — env vars / personal overrides (gitignored).
6. **`.mcp.json`** — curated strategic MCPs with `${ENV}` placeholders (never secrets).
7. **Hooks** — JS `.mjs` scripts (format-on-edit, typecheck/lint guard PreToolUse exit-2,
   secret-scan, test-on-stop) + node-resolver wrapper, wired with `${CLAUDE_PROJECT_DIR}`.
8. **Installable skills** — predefined skill templates copied into target `.claude/skills/`,
   tailored to stack (e.g. run-tests, lint-fix, pre-commit-verify).
9. **Worktree config** — `worktree.baseRef`, `.worktreeinclude`, optional WorktreeCreate/Remove hooks.
10. **LSP strategy** — `.lsp.json` (vtsls for JS/TS, intelephense for PHP) + compilation strategy notes.
11. **Market install script** — generated shell snippet to add marketplaces/plugins/MCPs.

## 6. Node resolution for JS hooks

Hook command in the generated target settings calls a wrapper (`node-run.sh` POSIX +
`node-run.cmd` Windows) that resolves node in order:
`$CLAUDE_NODE` → `node` on PATH → newest `~/.nvm/versions/node/*/bin/node` → `bun`.
Hook scripts are plain ESM `.mjs` (no build), read event JSON on stdin, emit control
JSON on stdout, use exit code 2 only to block. Works for JS-only and TS projects alike.

## 7. Safety (product credibility)

- Consent gate before any write; show diffs; never overwrite silently.
- Hooks use exec-form where possible, quote vars, exit-2 to block, scoped matchers.
- `.mcp.json` uses env placeholders only; add `.gitignore` for `*.local.*`.
- `harness-reviewer` agent audits the plan for secrets, fail-open hooks, over-broad perms.
- Plugin's own `.claude/aia-harness.local.md` (settings pattern) stores last profile/applied state.

## 8. Quality gates

- `npm run typecheck` → `tsc --checkJs --noEmit` (JSDoc types).
- `npm run lint` → ESLint flat config.
- `npm test` → typecheck + lint + `node --test` over fixtures.
- Smoke: `node bin/harness.mjs scan tests/fixtures/<x>` asserts the profile/plan.

## 9. v1 scope

- IN: JS/TS + PHP deep detection + generic fallback; full scaffold of all artifacts above;
  consent gate; tested deterministic engine; distributable via marketplace.json.
- OUT (v2): Python/Go/Java/Rust first-class; official-marketplace publishing; visual UI.

## 10. Implementation plan (phases)

1. Toolchain scaffold (package.json, tsconfig, eslint, gitignore, plugin.json, marketplace.json).
2. Engine: profile typedefs → detect/* → render → plan → apply → bin/harness.
3. Tests + fixtures (js-ts-app, php-laravel, monorepo, empty).
4. Templates (hooks+wrapper, claude-md, rules, settings, mcp catalog, skills, worktree, lsp).
5. Claude Code surface (commands, skills, agents, hooks.json).
6. Verify green (typecheck/lint/test) + smoke run.
7. README + commit.
