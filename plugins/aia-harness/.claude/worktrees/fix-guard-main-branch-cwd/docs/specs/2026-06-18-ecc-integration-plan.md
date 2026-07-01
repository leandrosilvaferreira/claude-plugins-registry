# ECC Integration & New-Stack Plan

Date: 2026-06-18
Status: Proposed (awaiting go-ahead)
Source: [ECC — affaan-m/ECC](https://github.com/affaan-m/ECC), MIT © 2026 Affaan Mustafa.

## Goal

Enrich `aia-harness` by importing a curated subset of ECC's per-stack **agents,
skills, and rules**, assigning them **dynamically by detected stack**; fold ECC's
**MCP** and suggested-**plugins** ideas into our catalogs; and promote **Go, Java
(Spring/Quarkus), and PHP-native (no Composer)** to first-class detection.
All ECC content is MIT — vendored with attribution.

## Decisions (locked)

| Fork | Decision |
|------|----------|
| Asset delivery | **Vendor a pinned subset** via `scripts/sync-ecc.mjs` → committed under `templates/ecc/`. Offline, deterministic, testable. |
| Rules emit | **Mirror** ECC structure into `.claude/rules/ecc/<stack>/` (preserve `common/` + cross-refs + `paths:`). |
| Import breadth | **Curated engineering subset** (~40 agents, ~80 skills, all rule stacks we support). Skip verticals + ECC-internal orchestration. |

## Key facts driving the design

- ECC rules are **already** `.claude/rules` format (`paths:` frontmatter) → zero conversion; mirror verbatim.
- ECC agents are **native Claude Code** subagents → drop-in after stripping the shared "Prompt Defense Baseline" block and dangling `## Related` cross-refs.
- ECC skills are self-contained `skills/<name>/` dirs (some with `references/`, `scripts/`) → copy whole dir; preserve `metadata.origin: ECC`.
- `java-reviewer` self-detects Spring vs Quarkus; ECC has **no** `quarkus/` or `spring/` rule dir (one `java/` dir; depth lives in skills `springboot-*` / `quarkus-*`).
- Exclude ECC's `*-verification` skills (overlap our `pre-commit-verify`) and the vendored third-party `ck` skill (separate license).

## Architecture additions

```
lib/data/ecc-catalog.mjs     # stack/framework -> { agents[], skills[], rules[] } (drives sync + planner)
lib/data/plugins-catalog.mjs # suggested external marketplaces + plugins (by purpose/stack)
scripts/sync-ecc.mjs         # fetch pinned ECC subset -> transform -> templates/ecc/  (npm run sync:ecc)
scripts/ecc-source.json      # pinned commit SHA + base URL
templates/ecc/
  agents/<name>.md           # cleaned agents
  skills/<name>/...          # whole skill dirs
  rules/common/*.md          # always-on
  rules/<stack>/*.md         # path-scoped
  LICENSE                    # ECC MIT (attribution)
  MANIFEST.json              # source commit + file list + credit
```

The **catalog is the single source of truth**: `sync-ecc.mjs` reads it to know
what to fetch; `plan.mjs` reads it to know what to install for a detected profile.

## Work plan (phased)

### Phase 1 — First-class Go / Java(Spring,Quarkus) / PHP-native
- `detect/commands.mjs`: add `goCommands`, `javaCommands` (maven vs gradle; Spring `spring-boot:run` vs Quarkus `quarkus:dev`/`quarkusDev`), and PHP-native path (PHP detected via `*.php` even without `composer.json` → raw `php`, `phpunit` if `vendor/` present, PHPStan/Pint if configured; no `composer install`).
- `detect/package-manager.mjs`: emit a `php` ecosystem entry from `*.php` presence when no `composer.json` (name `php`, evidence "PHP sources, no Composer").
- `detect/frameworks.mjs`: ensure `pom.xml`/`build.gradle(.kts)` parsing tags Spring (`spring-boot-starter*`) vs Quarkus (`io.quarkus`); add WordPress/Drupal native PHP markers.
- Fixtures: `go-app`, `java-spring` (maven), `java-quarkus` (gradle), `php-native` (no composer). Tests assert language, commands, framework.

### Phase 2 — ECC vendor pipeline
- Write `lib/data/ecc-catalog.mjs` (mapping below).
- Write `scripts/sync-ecc.mjs`: for each catalog entry, fetch from pinned commit (GitHub API/raw), **transform** (agents: strip Prompt-Defense + rewrite/strip `## Related`; rules/skills: copy; stamp provenance), write `templates/ecc/`, write `LICENSE` + `MANIFEST.json`. Fetch is injectable so transforms are unit-testable without network.
- Run `npm run sync:ecc` once to vendor the real subset (network available).
- Unit-test the transform functions against inline fixtures (no network).

### Phase 3 — Planner + apply integration
- `apply.mjs`: support **directory** copy artifacts (ECC skill dirs) — recursive copy, diff-safe (skip existing).
- `plan.mjs`: after profiling, consult `ecc-catalog` → add copy-artifacts:
  - agents → `.claude/agents/<name>.md`
  - skills → `.claude/skills/<name>/` (dir)
  - rules → `.claude/rules/ecc/{common,<stack>}/...` (mirror)
  Default-selected, grouped, each tagged `[ecc]` with the credit note. Skip items that conflict with our own skills.
- Tests: for go/java-spring/java-quarkus/php fixtures, assert the right ECC assets are planned; apply dir-copy test.

### Phase 4 — MCP + plugins catalogs
- `mcp-catalog.mjs`: add `memory`, `parallel-search` (key-free http), `supabase` (managed Postgres slot), optional `firecrawl`/`exa` (keyed). Keep `${ENV}` placeholders; document the "<10 servers" + disable guidance in the `mcp-catalog` skill.
- `plugins-catalog.mjs`: curated marketplaces (`anthropics/claude-plugins-official`, etc.) + plugins by purpose (LSP, code-review, search, workflow) and by stack where sensible. Enrich `scripts/harness-install.sh` artifact with real `claude plugin ...` lines (commented, never auto-run).
- New command `commands/add-plugins.md` → suggest + generate the install script.

### Phase 5 — Surface + credit
- Update `init.md` consent gate to include ECC asset groups (agents / skills / rules).
- Update `harness-engineering` skill to mention dynamic ECC asset assignment.
- README: add a **Credits** section with the attribution string; reference `templates/ecc/LICENSE` + `MANIFEST.json`.

### Phase 6 — Verify + commit
- `npm test` green (typecheck + lint + node:test) incl. new fixtures/tests.
- Smoke: scan/plan/apply on go/java/php fixtures; confirm ECC assets land.
- Commit with ECC attribution in the message.

## Stack → ECC asset catalog (initial)

| Detected | agents | skills | rules dir |
|----------|--------|--------|-----------|
| Go | go-reviewer, go-build-resolver | golang-patterns, golang-testing | golang |
| Rust | rust-reviewer, rust-build-resolver | rust-patterns, rust-testing | rust |
| TypeScript | typescript-reviewer | error-handling | typescript |
| React/Next | react-reviewer, typescript-reviewer, react-build-resolver | react-patterns, react-performance, react-testing (+nextjs-turbopack) | typescript, react |
| Vue/Nuxt | vue-reviewer, typescript-reviewer | vue-patterns (+nuxt4-patterns) | typescript, vue (+nuxt) |
| Java + Spring | java-reviewer, java-build-resolver | springboot-patterns, springboot-security, springboot-tdd, java-coding-standards, jpa-patterns | java |
| Java + Quarkus | java-reviewer, java-build-resolver | quarkus-patterns, quarkus-security, quarkus-tdd, java-coding-standards | java |
| Kotlin | kotlin-reviewer, kotlin-build-resolver | kotlin-patterns, kotlin-testing | kotlin |
| PHP + Laravel | php-reviewer | laravel-patterns, laravel-security, laravel-tdd | php |
| PHP native | php-reviewer | (none stack-locked) | php |
| Python | python-reviewer | python-patterns, python-testing | python |
| + Django | django-reviewer, django-build-resolver | django-patterns, django-tdd, django-security | python |
| + FastAPI | fastapi-reviewer | fastapi-patterns | python (+fastapi.md) |
| C#/.NET | csharp-reviewer | dotnet-patterns, csharp-testing | csharp |
| C++ | cpp-reviewer, cpp-build-resolver | cpp-coding-standards, cpp-testing | cpp |
| Flutter/Dart | flutter-reviewer, dart-build-resolver | dart-flutter-patterns | dart |
| any DB | database-reviewer | postgres/mysql/redis-patterns (by engine) | — |
| always | security-reviewer, code-reviewer | git-workflow, api-design, error-handling | common/ |

Exclude ECC `*-verification` skills (use our `pre-commit-verify`); exclude `ck`.

## Attribution

Ship `templates/ecc/LICENSE` (ECC MIT) and add to README:
> Portions adapted from [ECC ("Everything Claude Code")](https://github.com/affaan-m/ECC)
> by Affaan Mustafa, MIT License, © 2026 Affaan Mustafa.

## Out of scope (v-next)
ECC's orchestration/PRP/epic/loop commands, multi-tool adapters (Cursor/Codex/…),
business-vertical skills, `ecc-agentshield` dependency.
