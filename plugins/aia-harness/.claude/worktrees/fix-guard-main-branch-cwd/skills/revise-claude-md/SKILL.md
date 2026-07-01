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
