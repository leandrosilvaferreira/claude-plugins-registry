# revise-claude-md Skill Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement the `/aia-harness:revise-claude-md` plugin-level skill that generates rich, concrete intermediate CLAUDE.md files for strategic subdirectories, replacing the current thin AI-ENRICH skeletons.

**Architecture:** A plugin-level skill (`skills/revise-claude-md/SKILL.md`) runs a two-phase flow: Phase 1 maps domains (scan + expansion) and rules to domains, presents a plan for approval; Phase 2 reads real source files + rule files, generates rich CLAUDE.md per domain, shows diff, writes on consent. The existing `renderDomainClaudeMd` skeleton is upgraded with richer AI-ENRICH instructions to improve fallback quality. `/init` step 5.5 loses its domain enrichment sub-step (delegated to new step 5.6 that invokes the skill).

**Tech Stack:** Node ≥18 ESM `.mjs`, no build step; skill is a Markdown instruction file (no runtime code); tests use `node:test` + `node:assert`.

## Global Constraints

- All source files are `.mjs` ESM — no `.ts`, `.js`, `.sh`.
- Skill file is Markdown only — no code in `skills/`.
- `CLAUDE_PLUGIN_ROOT` env var references the plugin root in skill commands.
- `DOMAIN_LIMIT = 20` cap for domain candidates.
- Tests run with `npm test` (typecheck + lint + unit). All must pass before any commit.
- `templates/` is excluded from lint/typecheck — do not add files there.
- This skill is NOT distributed to target projects — it stays at plugin level (`skills/`), not `templates/skills/`.

---

### Task 1: Update `renderDomainClaudeMd` skeleton + unit tests

Add `## Key patterns` and `## Applied rules` sections to the skeleton. Both carry `AI-ENRICH` markers with explicit instructions to read rules and source files. Update unit tests to match the new marker count (4 instead of 2) and new section names.

**Files:**
- Modify: `lib/generate/claude-md.mjs` (function `renderDomainClaudeMd` at line 370)
- Modify: `tests/unit.test.mjs` (two tests for `renderDomainClaudeMd` starting at lines 48 and 63)

**Interfaces:**
- Produces: `renderDomainClaudeMd` still takes `(_profile, domain)` and returns `string`; new sections added between `## Responsibility` and `## Local conventions`

- [ ] **Step 1: Write the failing tests first**

In `tests/unit.test.mjs`, update the two existing `renderDomainClaudeMd` tests:

```js
test("domain CLAUDE.md is an enrichable stub, not a dead placeholder", () => {
  const md = renderDomainClaudeMd(/** @type {any} */ ({}), {
    path: "app/view",
    role: "view layer",
    kind: "layer",
  });
  // Path is interpolated into both the heading and the enrich markers.
  assert.match(md, /^# app\/view/m);
  // All four sections carry AI-ENRICH markers.
  const enrichMarkers = md.match(/<!-- AI-ENRICH:/g) ?? [];
  assert.equal(
    enrichMarkers.length,
    4,
    "Responsibility + Key patterns + Applied rules + Local conventions must be enrich-marked",
  );
  // New sections present
  assert.match(md, /## Key patterns/);
  assert.match(md, /## Applied rules/);
  // No visible italic placeholder that ships looking unfinished.
  assert.doesNotMatch(md, /_Describe what belongs/);
});

test("domain CLAUDE.md ships a fixed rules section enrichment cannot strip", () => {
  const md = renderDomainClaudeMd(/** @type {any} */ ({}), {
    path: "app/view",
    role: "view layer",
    kind: "layer",
  });
  assert.match(md, /## Rules/);
  assert.ok(md.includes(FIXED_RULES_MARKER), "fixed-rules sentinel must be present");
  for (const rule of DOMAIN_FIXED_RULES) {
    assert.ok(md.includes(rule), `missing fixed rule verbatim: ${rule}`);
  }
  // Fixed sentinel is not an AI-ENRICH marker — must not be counted in the four.
  const enrichMarkers = md.match(/<!-- AI-ENRICH:/g) ?? [];
  assert.equal(enrichMarkers.length, 4, "fixed marker must not be counted as an enrich marker");
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npm run test:unit 2>&1 | grep -A3 "domain CLAUDE"
```

Expected: two failures — `AssertionError` on `enrichMarkers.length` (actual 2, expected 4) and missing `## Key patterns` / `## Applied rules`.

- [ ] **Step 3: Update `renderDomainClaudeMd` in `lib/generate/claude-md.mjs`**

Replace the entire `renderDomainClaudeMd` function (lines 370–387) with:

```js
/**
 * @param {ProjectProfile} _profile
 * @param {DomainInfo} domain
 * @returns {string}
 */
export function renderDomainClaudeMd(_profile, domain) {
  return `# ${domain.path}

Scope: ${domain.role} (${domain.kind}).

## Responsibility
<!-- AI-ENRICH: Read the real files in ${domain.path}/. State in 2-4 sentences what concretely
     belongs here and what does NOT (where that other code lives). Replace this comment and the line below. -->
The ${domain.role}.

## Key patterns
<!-- AI-ENRICH: Read 3-6 key source files in ${domain.path}/. Extract concrete patterns:
     specific class names, DI tokens, naming conventions, error handling patterns, method names.
     Derive from real code only — no generic advice. Replace comment and placeholder. -->

- _Key patterns are added here during enrichment._

## Applied rules
<!-- AI-ENRICH: Read .claude/rules/ (and all subdirs — ecc/, stack/, etc). List rules relevant
     to ${domain.path}/ as @-references with a 1-2 sentence condensed summary of what matters
     HERE specifically. Format: \`- @.claude/rules/X.md — summary\`.
     Omit generic rules with no domain-specific relevance. Replace comment and placeholder. -->

- _Applicable rules are added here during enrichment._

## Local conventions
<!-- AI-ENRICH: 2-5 conventions actually observed in ${domain.path}/ files (naming, base classes,
     error handling, file layout). Replace the placeholder below. Leave the "## Rules" section untouched. -->

- _Directory-specific conventions are added here during \`/aia-harness:init\` enrichment._

${fixedRulesBlock("Rules", DOMAIN_FIXED_RULES)}
<!-- Generated by aia-harness for domain \`${domain.path}\`. Re-run /aia-harness:revise-claude-md to enrich. -->
`;
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npm test
```

Expected: all tests pass, zero failures, zero typecheck errors.

- [ ] **Step 5: Commit**

```bash
git add lib/generate/claude-md.mjs tests/unit.test.mjs
git commit -m "feat(claude-md): add Key patterns + Applied rules sections to domain skeleton"
```

---

### Task 2: Create `skills/revise-claude-md/SKILL.md`

Write the plugin-level skill that implements the two-phase flow. This is a Markdown instruction file — no runtime code.

**Files:**
- Create: `skills/revise-claude-md/SKILL.md`

**Interfaces:**
- Consumes: `CLAUDE_PLUGIN_ROOT` env var, `AskUserQuestion` tool, `Read`, `Edit`, `Write`, `Bash`
- Produces: CLAUDE.md files written into target project subdirectories

- [ ] **Step 1: Create the skill directory and file**

Create `skills/revise-claude-md/SKILL.md` with this content:

```markdown
---
name: revise-claude-md
description: >
  Generate or refresh rich intermediate CLAUDE.md files for strategic subdirectories
  of the target project. Reads .claude/rules/ (recursive), analyzes actual source files,
  maps rules to domains, and generates domain-specific CLAUDE.md with Key patterns,
  Applied rules, and Local conventions sections. Two-phase: map → approve → generate with diffs.
  Use after /aia-harness:init (step 5.6), or standalone to refresh existing files.
argument-hint: "[path]"
allowed-tools:
  - Bash
  - Read
  - Edit
  - Write
  - AskUserQuestion
---

# Revise intermediate CLAUDE.md files

Generate rich, concrete CLAUDE.md files for strategic subdirectories of the target project.
Unlike the generic skeletons produced by `apply`, these files contain real class names, actual
injection patterns, condensed rule summaries, and domain-specific conventions derived from
reading the actual source code.

Target directory: `$1` if provided, else `$CLAUDE_PROJECT_DIR`.

---

## Phase 1 — Map: discover domains and applicable rules

### Step 1: Get base domains from scan

```bash
node "${CLAUDE_PLUGIN_ROOT}/bin/harness.mjs" scan "${1:-$CLAUDE_PROJECT_DIR}" --json
```

Extract `profile.architecture.domains[]` as the starting list of domain candidates.
Each entry has `path` (relative to project root), `role`, and `kind`.

### Step 2: Expand domain candidates

Walk the target file tree (exclude `node_modules`, `.git`, `vendor`, `dist`, `.next`,
`.nuxt`, `target`, `build`, `coverage`). Add any directory meeting **any** of these criteria
that is not already in the base domains list:

| Criterion | Examples |
|---|---|
| Has a framework module file | `*.module.ts`, `*Module.java`, `module.go`, `router.go`, `__init__.py` with class |
| Recognized infrastructure layer name (any path segment) | `database`, `infra`, `repository`, `persistence`, `cache`, `storage` |
| Has ≥ 3 source files and is a named feature directory | `users/` with `users.service.ts` + `users.controller.ts` + `dto/` |
| Canonical domain name (any path segment) | `auth`, `database`, `db`, `config`, `core`, `shared`, `common`, `gateway`, `queue`, `jobs`, `billing`, `notifications`, `webhooks`, `events` |

**Cap at 20 total candidates.** If more than 20 candidates found, rank and keep:
1. Directories with a framework module file (highest priority)
2. Directories matching a canonical domain name
3. Remaining by descending source file count

### Step 3: Map rules to domains

For each file found in `{target}/.claude/rules/**/*.md` (recursive — this includes `ecc/`,
`stack/`, and any other subdirectory the harness creates):

1. Use the file name for direct heuristic mapping:

   | Rule file pattern | Maps to domain names |
   |---|---|
   | `auth-*`, `*-auth`, `*-jwt*`, `*-password*` | `auth`, `security` |
   | `*-database*`, `*-orm*`, `drizzle-*`, `prisma-*`, `typeorm-*` | `database`, `db`, `repository`, `persistence` |
   | `nestjs-*`, `*-architecture*` | `src`, `app`, `apps/*/src` |
   | `*-testing*`, `testing-*` | all domains with `*.spec.*` or `*.test.*` files |
   | `typescript-*`, `*-lint*` | all TypeScript domains |
   | `*-validation*`, `*-zod*`, `*-dto*` | domains containing `dto/` subdirectory |
   | `*-error*`, `*-exception*` | all domains |
   | `*-observability*`, `*-logging*` | all domains |
   | `api-versioning*`, `*-swagger*`, `*-openapi*` | domains with controller files |
   | `interceptors*`, `*-middleware*` | `src` level, `middleware/`, `interceptors/` |
   | `ecc/**` | matched by reading first 5 lines for stack/language keywords |

2. Read the first 5 lines of each rule file to extract library/framework keywords and
   cross-reference with domain directory names for any matches not covered by name heuristics.

3. Rules with no domain-specific match (e.g., purely generic coding-style rules) are NOT
   included in intermediate CLAUDE.md files — they belong only in the root CLAUDE.md.

### Step 4: Present the map and ask for approval

Show the full candidate list as a table before generating anything:

```
Domain (relative path)      Role                   Key files               Applicable rules
apps/api/src/auth           Authentication module  auth.service.ts         auth-security.md, testing-jest.md
                                                   jwt.strategy.ts
apps/api/src/database       DB access layer        database.module.ts      drizzle-database.md, typescript-lint.md
                                                   schema/index.ts
```

Also note any domains that already have a CLAUDE.md (will be overwritten after diff+approval).

Use `AskUserQuestion` (multi-select, all pre-selected) to confirm which domains to generate:

> "I found N strategic subdirectories. Select which ones to generate CLAUDE.md for:"
> [list of domain paths, all checked by default]

If the user deselects any, remove them from the list before proceeding to Phase 2.

---

## Phase 2 — Generate: read, synthesize, write with diffs

Process each approved domain **in sequence** (one at a time, with diff + consent per domain).

### For each domain:

**Read source files (up to 8, prioritized):**

Read from the domain directory in this priority order — stop at 8 files total:
1. Framework module/entry file (`*.module.ts`, `index.ts`, `mod.go`, `__init__.py`, `*Module.java`)
2. Service file (`*.service.ts`, `*Service.java`, `*_service.go`, `services.py`)
3. Controller/handler/route (`*.controller.ts`, `*Controller.java`, `*_handler.go`, `views.py`)
4. Schema/entity/model file (`schema/*.ts`, `*.entity.ts`, `*.model.ts`, `models.py`)
5. DTO/input/request file (`dto/*.ts`, `*Dto.java`, `*_dto.go`)
6. Guard/middleware/decorator (`*.guard.ts`, `*.decorator.ts`, `middleware.ts`)
7. Barrel/index file (`index.ts`, `__init__.py`) if not already read
8. Test file (`*.spec.ts`, `*.test.ts`, `*_test.go`) for convention extraction

**Read applicable rule files:**

Read each `.claude/rules/` file mapped to this domain in Phase 1, in full.

**Generate the domain CLAUDE.md:**

Write the file with this exact structure — NO `AI-ENRICH` markers, all sections fully populated
from the source files and rules you just read:

```markdown
# {domain-basename} — {role in one line}

{1-2 sentences of context: what this module/layer does; mention if security-sensitive.
Derive from the module file and rule files, not from generic descriptions.}

## Responsibility

{2-4 concrete sentences. What BELONGS here (name actual file types or patterns).
What does NOT belong here. Where that other code lives (name the actual directory).
Example: "Business logic for authentication lives here — not HTTP routing (that's in
auth.controller.ts) and not DB queries (those go through the DRIZZLE token in database/)."}

## Key patterns

{3-6 bullets derived strictly from the source files you read. Each bullet must reference
something real: a class name, a DI token, a specific method, a naming convention,
an error type, a decorator. No generic advice.}

- {Concrete pattern from code — e.g. "Inject DB via `@Inject(DRIZZLE)` symbol token"}
- {Concrete pattern — e.g. "Services throw `NotFoundException`, never return null"}
- {Concrete naming — e.g. "DTOs live in `dto/<feature>.dto.ts`, extend `createZodDto()`"}

## Applied rules

Rules active in this directory — read them before touching code here:

{For each applicable rule file, one bullet:}
- @.claude/rules/{relative-path}.md — {1-2 sentence condensed summary of what matters
  SPECIFICALLY for this domain — not a generic restatement of the rule title.
  Example: "Never compare password hashes manually; use `bcrypt.compare`. Hash cost factor 10 minimum."}

## Local conventions

{2-5 directory-specific conventions derived from the real files you read.
These must be distinct from the root CLAUDE.md conventions and specific to this directory.}

- {Convention observed in code — e.g. "Every route handler delegates immediately to a service method; no logic in controllers"}

<!-- Generated by aia-harness revise-claude-md. Re-run /aia-harness:revise-claude-md to update. -->
```

**Show diff and get consent:**

Before writing each file:
1. If the file already exists, show a unified diff (old vs. new).
   If it contains `AI-ENRICH` markers, note: "This replaces a generic skeleton."
2. If the file does not exist, show the full generated content as a preview.
3. Ask for explicit confirmation before writing.
4. Write with `Edit` (if exists) or `Write` (if new).

**Quality check before writing each file:**

Verify the generated content meets the acceptance criteria before showing the diff:
- `## Responsibility` must name at least one thing that does NOT belong here (and where it lives)
- `## Key patterns` must cite at least one real class/symbol/token from the source files read
- `## Applied rules` must have at least one `@.claude/rules/X.md` reference with a condensed summary
- No `AI-ENRICH` markers remain
- No section is a copy-paste of root CLAUDE.md content without domain-specific adaptation

If a domain has no applicable rules (no rule files matched), omit the `## Applied rules` section
entirely rather than leaving it empty.

---

## After all domains are processed

Report a summary:
- N files written
- M files skipped (user declined)
- List any domains where no applicable rules were found (suggest reviewing `.claude/rules/` coverage)
```

- [ ] **Step 2: Verify the skill can be listed by the plugin**

```bash
ls /Users/leandrosilvaferreira/.claude/plugins/cache/claude-plugins-official/aia_harness/ 2>/dev/null || \
ls "${CLAUDE_PLUGIN_ROOT}/skills/" 2>/dev/null | grep revise
```

Expected: `revise-claude-md/` directory visible in `skills/`.

Note: Plugin reload is not needed at this step — the file just needs to exist in the right place.

- [ ] **Step 3: Run npm test to confirm no regressions**

```bash
npm test
```

Expected: all tests pass (skill is Markdown only, no code paths affected).

- [ ] **Step 4: Commit**

```bash
git add skills/revise-claude-md/SKILL.md
git commit -m "feat(skills): add revise-claude-md plugin-level skill (two-phase domain enrichment)"
```

---

### Task 3: Update `commands/init.md` — remove domain enrichment from 5.5, add step 5.6

Step 5.5 currently handles both root and domain CLAUDE.md enrichment. Remove point 3 from Pass 3
(the domain enrichment sub-step) and add new step 5.6 that delegates to the skill.

**Files:**
- Modify: `commands/init.md`

**Interfaces:**
- Consumes: existing step 5.5 at lines 107–152 (Pass 3 starts at line 143)
- Produces: step 5.5 enriches only root CLAUDE.md; step 5.6 invokes the skill for domains

- [ ] **Step 1: Read current step 5.5 to confirm exact text before editing**

Read `commands/init.md` lines 107–155 to locate:
- The `5.5.` header
- Point 3 of Pass 3 ("Enrich each nested domain CLAUDE.md") at line ~147
- The `5.7.` header (next step, to insert 5.6 before it)

- [ ] **Step 2: Remove point 3 from Pass 3 in step 5.5**

In `commands/init.md`, find this block in step 5.5 Pass 3 (around line 147–150) and remove it:

```
   3. **Enrich each nested domain `CLAUDE.md`** (the `<domain>/CLAUDE.md` files written under each detected domain — they otherwise ship as an identical generic stub, which is the bug this prevents). For each one, using the files you read for **that** directory in Pass 2 (read the directory now if Pass 2 did not cover it):
      - replace the `## Responsibility` AI-ENRICH section with 2–4 sentences on what concretely lives there and what does not (and where that other code lives);
      - replace the `## Local conventions` placeholder with 2–5 conventions actually observed in that directory (naming, base classes, error handling, file layout) — not generic lines. **Leave the domain `## Rules` (`aia-harness:fixed`) section untouched.**
      Each domain file must end up **distinct** from the others in its `## Responsibility` / `## Local conventions` (the fixed `## Rules` is identical by design). If a directory genuinely has too little to say, keep it to one honest line rather than inventing — but never leave the identical stub.
```

Also update the renumbering of remaining points 4 and 5 in Pass 3 — they become 3 and 4:

Old:
```
   4. Remove every `<!-- AI-ENRICH: ... -->` comment from the files you touched (root + domains), but **keep every `aia-harness:fixed` marker**...
   5. Show a combined diff (root + domain files) versus the skeletons...
```

New (renumbered, domain files removed from scope):
```
   3. Remove every `<!-- AI-ENRICH: ... -->` comment from the root `CLAUDE.md` you touched, but **keep every `aia-harness:fixed` marker** so the protected rules stay flagged for future audits.
   4. Show a diff of the root `CLAUDE.md` versus the skeleton. Wait for explicit user approval before writing with `Edit`.
```

- [ ] **Step 3: Add step 5.6 between 5.5 and 5.7**

Insert this block immediately before `5.7.` in `commands/init.md`:

```markdown
5.6. **Intermediate CLAUDE.md (domain enrichment).** Invoke the `aia-harness:revise-claude-md`
   skill (Skill tool, `skill: "aia-harness:revise-claude-md"`, `args: "${1:-$CLAUDE_PROJECT_DIR}"`)
   to generate rich domain CLAUDE.md files for strategic subdirectories. This runs:
   - Phase 1: maps domains (base from scan + expansion) and applicable rules; presents plan for approval.
   - Phase 2: reads real source files + rule files per domain; generates rich CLAUDE.md with
     `## Key patterns`, `## Applied rules`, and `## Local conventions`; shows diff; writes on consent.

   If the user skips this step, the domain CLAUDE.md files remain as generic skeletons that can be
   enriched later by running `/aia-harness:revise-claude-md` directly.
```

- [ ] **Step 4: Run npm test to confirm no regressions**

```bash
npm test
```

Expected: all tests pass (`commands/init.md` is not covered by unit tests, but typecheck + lint must still pass).

- [ ] **Step 5: Commit**

```bash
git add commands/init.md
git commit -m "feat(init): add step 5.6 — delegate domain CLAUDE.md enrichment to revise-claude-md skill"
```

---

### Task 4: Update `commands/help.md` with new command entry

Add the new command to the decision guide table and the "Commands in detail" section.

**Files:**
- Modify: `commands/help.md`

**Interfaces:**
- Consumes: existing `## 🚀 Where to start` table and `## Commands in detail` section
- Produces: `/aia-harness:revise-claude-md` visible in both sections

- [ ] **Step 1: Add to the decision guide table**

In `commands/help.md`, add a new row to the `## 🚀 Where to start` table, after the
`/aia-harness:add-tools` row and before `See this help`:

Old:
```markdown
| Install **token-economy / code-graph tools** (caveman, ponytail, rtk, graphify) | `/aia-harness:add-tools` |
| See this help | `/aia-harness:help` |
```

New:
```markdown
| Install **token-economy / code-graph tools** (caveman, ponytail, rtk, graphify) | `/aia-harness:add-tools` |
| Generate or refresh **rich intermediate CLAUDE.md** files for strategic subdirectories | `/aia-harness:revise-claude-md` |
| See this help | `/aia-harness:help` |
```

- [ ] **Step 2: Add to "Commands in detail" section**

In `commands/help.md`, insert a new `### /aia-harness:revise-claude-md` block immediately before
the `## ⚙️ Engine CLI` section:

```markdown
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
```

- [ ] **Step 3: Run npm test**

```bash
npm test
```

Expected: all tests pass.

- [ ] **Step 4: Commit**

```bash
git add commands/help.md
git commit -m "docs(help): add /revise-claude-md to decision guide and command reference"
```

---

## Self-Review

**Spec coverage check:**

| Spec requirement | Task that implements it |
|---|---|
| New plugin-level skill `skills/revise-claude-md/SKILL.md` | Task 2 |
| Phase 1: get base domains from scan | Task 2 (Phase 1, Step 1) |
| Phase 1: expand domains with own analysis (criteria table) | Task 2 (Phase 1, Step 2) |
| Phase 1: map rules to domains (recursive `.claude/rules/`) | Task 2 (Phase 1, Step 3) |
| Phase 1: present plan table + multi-select approval | Task 2 (Phase 1, Step 4) |
| Phase 2: read up to 8 source files per domain | Task 2 (Phase 2 - Read source files) |
| Phase 2: read applicable rule files | Task 2 (Phase 2 - Read applicable rule files) |
| Phase 2: generate rich CLAUDE.md (4 sections, no AI-ENRICH) | Task 2 (Phase 2 - Generate) |
| Phase 2: diff + consent before writing | Task 2 (Phase 2 - Show diff and get consent) |
| Quality bar: 5 acceptance criteria | Task 2 (Phase 2 - Quality check) |
| Update `renderDomainClaudeMd` skeleton | Task 1 |
| Update unit tests for new marker count (4) | Task 1 |
| Add `## Key patterns` + `## Applied rules` to skeleton | Task 1 |
| `/init` step 5.5: remove domain enrichment point 3 | Task 3 |
| `/init` step 5.6: invoke skill | Task 3 |
| `commands/help.md`: decision guide + command detail | Task 4 |

**Placeholder scan:** No TBD, TODO, or vague steps. All code blocks are complete. ✅

**Type consistency:** `renderDomainClaudeMd(_profile, domain)` signature unchanged. Tests import
same named exports (`renderDomainClaudeMd`, `DOMAIN_FIXED_RULES`, `FIXED_RULES_MARKER`). ✅
