# Uncle Bob Craft Skill — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Vendor the `uncle-bob-craft` skill (Robert C. Martin code-review/craft criteria) into `templates/skills/`, install it as a default (`PROJECT_COMMON`) skill in every harness-scaffolded target project, cite it in the two places that already govern code review in generated output, and dogfood it in aia-harness's own review process.

**Architecture:** Two parallel copies of the same 8-file skill directory (`templates/skills/uncle-bob-craft/` for target projects, `.claude/skills/uncle-bob-craft/` for this repo's own dogfood use), each with SKILL.md frontmatter normalized to house style. Citation is centralized in one function (`codeReviewRule()`) rather than scattered across individual reviewer agent files, because every stack `*-reviewer` agent is either vendored (ECC, overwritten on sync) or dynamically named — the function already composes the reviewer list at generation time.

**Tech Stack:** Node.js ESM (`.mjs`), `node:test` + `node:assert/strict`, no build step.

## Global Constraints

- All source is `.mjs` ESM with JSDoc types — no TypeScript files (per root `CLAUDE.md`).
- `templates/` is excluded from lint/typecheck — do not add it to those configs.
- Every artifact under `templates/` must be registered in its matching `lib/data/*-catalog.mjs` in the same change (root `CLAUDE.md` "Asset catalog — mandatory maintenance").
- Never hand-edit vendored ECC/ag-kit files — only `lib/data/project-catalog.mjs`-owned first-party assets are edited here.
- Run `npm test` (typecheck + lint + unit) before considering any task done.

---

## Task 1: Vendor the skill into `templates/skills/uncle-bob-craft/`

**Files:**
- Create: `templates/skills/uncle-bob-craft/SKILL.md`
- Create: `templates/skills/uncle-bob-craft/README.md`
- Create: `templates/skills/uncle-bob-craft/reference.md`
- Create: `templates/skills/uncle-bob-craft/examples/code-review-checklist.md`
- Create: `templates/skills/uncle-bob-craft/references/clean-agile.md`
- Create: `templates/skills/uncle-bob-craft/references/clean-architecture.md`
- Create: `templates/skills/uncle-bob-craft/references/clean-coder.md`
- Create: `templates/skills/uncle-bob-craft/references/design-patterns.md`

**Interfaces:**
- Consumes: nothing.
- Produces: `templates/skills/uncle-bob-craft/` directory on disk, which Task 2's catalog registration and Task 9's integrity tests require to exist before they pass.

- [ ] **Step 1: Copy the source directory verbatim**

Source is a skill from another local project (not a GitHub repo — no vendoring/sync pipeline applies here, this is a one-time manual copy).

Run:
```bash
mkdir -p templates/skills/uncle-bob-craft
cp -R /Users/leandrosilvaferreira/Projetos/swapo/swapo-app/.claude/skills/uncle-bob-craft/. templates/skills/uncle-bob-craft/
```

- [ ] **Step 2: Verify the file count and structure**

Run: `find templates/skills/uncle-bob-craft -type f | sort`

Expected output (8 files, exact paths):
```
templates/skills/uncle-bob-craft/README.md
templates/skills/uncle-bob-craft/SKILL.md
templates/skills/uncle-bob-craft/examples/code-review-checklist.md
templates/skills/uncle-bob-craft/reference.md
templates/skills/uncle-bob-craft/references/clean-agile.md
templates/skills/uncle-bob-craft/references/clean-architecture.md
templates/skills/uncle-bob-craft/references/clean-coder.md
templates/skills/uncle-bob-craft/references/design-patterns.md
```

- [ ] **Step 3: Normalize `SKILL.md` frontmatter to house style**

Every other first-party skill under `templates/skills/*/SKILL.md` uses only `name` +
`description` in frontmatter (see `pre-commit-verify`, `run-tests`, `lint-fix`,
`setup-testing`). The copied file currently has extra upstream-specific fields
(`category`, `risk`, `source`, `date_added`, `author`, `tags`, `tools`) that Claude Code
does not read and no other skill here carries.

Edit `templates/skills/uncle-bob-craft/SKILL.md`, replacing:

```yaml
---
name: uncle-bob-craft
description: "Use when performing code review, writing or refactoring code, or discussing architecture; complements clean-code and does not replace project linter/formatter."
category: code-quality
risk: safe
source: community
date_added: "2026-03-06"
author: antigravity-contributors
tags: [clean-code, clean-architecture, solid, code-review, craftsmanship, uncle-bob]
tools: [claude, cursor, gemini]
---
```

with:

```yaml
---
name: uncle-bob-craft
description: Use when performing code review, writing or refactoring code, or discussing architecture; complements clean-code and does not replace project linter/formatter.
---
```

Do not touch anything below the closing `---` — the body (Overview, When to Use, Aggregators
table, Examples, Best Practices, etc.) stays exactly as copied.

- [ ] **Step 4: Verify frontmatter + body integrity**

Run:
```bash
head -5 templates/skills/uncle-bob-craft/SKILL.md
```
Expected:
```
---
name: uncle-bob-craft
description: Use when performing code review, writing or refactoring code, or discussing architecture; complements clean-code and does not replace project linter/formatter.
---

```

Run (confirms the body — everything after the frontmatter — is untouched, byte-for-byte,
despite the frontmatter shrinking from 11 lines to 4):
```bash
diff <(tail -n +12 /Users/leandrosilvaferreira/Projetos/swapo/swapo-app/.claude/skills/uncle-bob-craft/SKILL.md) <(tail -n +5 templates/skills/uncle-bob-craft/SKILL.md)
diff /Users/leandrosilvaferreira/Projetos/swapo/swapo-app/.claude/skills/uncle-bob-craft/README.md templates/skills/uncle-bob-craft/README.md
diff /Users/leandrosilvaferreira/Projetos/swapo/swapo-app/.claude/skills/uncle-bob-craft/reference.md templates/skills/uncle-bob-craft/reference.md
diff -r /Users/leandrosilvaferreira/Projetos/swapo/swapo-app/.claude/skills/uncle-bob-craft/examples templates/skills/uncle-bob-craft/examples
diff -r /Users/leandrosilvaferreira/Projetos/swapo/swapo-app/.claude/skills/uncle-bob-craft/references templates/skills/uncle-bob-craft/references
```
Expected: no output from any of the five commands (all identical).

- [ ] **Step 5: Commit**

```bash
git add templates/skills/uncle-bob-craft/
git commit -m "feat(skills): vendor uncle-bob-craft skill into templates/skills/"
```

---

## Task 2: Register `uncle-bob-craft` as a default (`PROJECT_COMMON`) skill

**Files:**
- Modify: `lib/data/project-catalog.mjs:27`
- Test: `tests/catalog-paths-integrity.test.mjs` (existing, generic — no edit needed)
- Test: `tests/templates-orphan.test.mjs` (existing, generic — no edit needed)
- Test: `tests/project-catalog.test.mjs` (existing, generic — no edit needed)

**Interfaces:**
- Consumes: `templates/skills/uncle-bob-craft/` from Task 1 (must exist on disk for the
  integrity test to pass).
- Produces: `PROJECT_COMMON.skills` including `"uncle-bob-craft"` — Task 8's README table
  and Task 9's final `npm test` gate depend on this being correct.

- [ ] **Step 1: Run the existing integrity tests to see them pass on the current (unmodified) catalog — baseline**

Run: `node --test tests/catalog-paths-integrity.test.mjs tests/templates-orphan.test.mjs tests/project-catalog.test.mjs`
Expected: all pass (these tests don't know about `uncle-bob-craft` yet, so nothing to fail
against — this step just confirms your baseline is green before you touch anything).

- [ ] **Step 2: Add `uncle-bob-craft` to `PROJECT_COMMON.skills`**

In `lib/data/project-catalog.mjs`, in the `PROJECT_COMMON` export, change:

```js
export const PROJECT_COMMON = {
  agents: /** @type {string[]} */ ([]),
  skills: ["run-tests", "lint-fix", "pre-commit-verify", "setup-testing", "goal-builder"],
```

to:

```js
export const PROJECT_COMMON = {
  agents: /** @type {string[]} */ ([]),
  skills: [
    "run-tests",
    "lint-fix",
    "pre-commit-verify",
    "setup-testing",
    "goal-builder",
    "uncle-bob-craft",
  ],
```

- [ ] **Step 3: Run the same tests again — verify they still pass with the new entry**

Run: `node --test tests/catalog-paths-integrity.test.mjs tests/templates-orphan.test.mjs tests/project-catalog.test.mjs`
Expected: all pass. `tests/catalog-paths-integrity.test.mjs`'s "project catalog: every skill
directory exists under templates/skills/" test now also checks
`templates/skills/uncle-bob-craft/` (created in Task 1) and will FAIL if that directory is
missing or misnamed — this is your safety net for Task 1 and Task 2 being consistent with
each other.

- [ ] **Step 4: Commit**

```bash
git add lib/data/project-catalog.mjs
git commit -m "feat(catalog): install uncle-bob-craft as a default skill in every target project"
```

---

## Task 3: Cite `uncle-bob-craft` in the generated CLAUDE.md code-review rule

**Files:**
- Modify: `lib/generate/claude-md.mjs:142-151`
- Test: `tests/skill-map.test.mjs:320` (add new test case after the existing `codeReviewRule` tests)

**Interfaces:**
- Consumes: `codeReviewRule(agents)` — existing function, signature unchanged
  (`(agents: AgentMeta[]) => string`).
- Produces: `codeReviewRule()`'s return string now always contains the literal substring
  `` `uncle-bob-craft` ``, regardless of which reviewer agents are passed in. Task 9's full
  suite relies on this test passing.

- [ ] **Step 1: Write the failing test**

In `tests/skill-map.test.mjs`, immediately after the existing test block that ends at line
320 (`test("codeReviewRule: multiple stack reviewers all appended", ...)`), add:

```js
test("codeReviewRule: always cites uncle-bob-craft regardless of reviewer agents", () => {
  const rule = codeReviewRule([{ name: "code-reviewer", whenToUse: "" }]);
  assert.match(rule, /`uncle-bob-craft`/);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test tests/skill-map.test.mjs`
Expected: FAIL on the new test — `codeReviewRule`'s current output does not contain
`` `uncle-bob-craft` ``.

- [ ] **Step 3: Implement — extend `codeReviewRule()`**

In `lib/generate/claude-md.mjs`, change:

```js
export function codeReviewRule(agents) {
  const names = new Set(agents.map((a) => a.name));
  const always = ["code-reviewer", "security-reviewer"].filter((n) => names.has(n));
  const stackReviewers = agents
    .map((a) => a.name)
    .filter((n) => n.endsWith("-reviewer") && !always.includes(n));
  const all = [...always, ...stackReviewers];
  const named = all.map((n) => `\`${n}\``).join(" and ");
  return `When performing a code review (user requests it or a workflow triggers it), always use ${named}.`;
}
```

to:

```js
export function codeReviewRule(agents) {
  const names = new Set(agents.map((a) => a.name));
  const always = ["code-reviewer", "security-reviewer"].filter((n) => names.has(n));
  const stackReviewers = agents
    .map((a) => a.name)
    .filter((n) => n.endsWith("-reviewer") && !always.includes(n));
  const all = [...always, ...stackReviewers];
  const named = all.map((n) => `\`${n}\``).join(" and ");
  return `When performing a code review (user requests it or a workflow triggers it), always use ${named}, applying the \`uncle-bob-craft\` skill's criteria (Dependency Rule, SOLID in context, code smells) alongside their findings.`;
}
```

(`uncle-bob-craft` is `PROJECT_COMMON` as of Task 2 — installed unconditionally for every
profile — so the mention does not need to be gated on anything in `agents`.)

- [ ] **Step 4: Run the test to verify it passes**

Run: `node --test tests/skill-map.test.mjs`
Expected: PASS — all tests in the file, including the 4 pre-existing `codeReviewRule` tests
and the new one.

- [ ] **Step 5: Commit**

```bash
git add lib/generate/claude-md.mjs tests/skill-map.test.mjs
git commit -m "feat(claude-md): cite uncle-bob-craft in the generated code-review rule"
```

---

## Task 4: Cite `uncle-bob-craft` in the code-quality rule template

**Files:**
- Modify: `templates/rules/04-code-quality.md:35`

**Interfaces:**
- Consumes: nothing new.
- Produces: no interface consumed by other tasks — this is a leaf content change.

- [ ] **Step 1: Extend the existing "ready for review" bullet**

In `templates/rules/04-code-quality.md`, change:

```
- Ensure the code is ready for code review.
```

to:

```
- Ensure the code is ready for code review — apply the `uncle-bob-craft` skill (Dependency Rule, SOLID in context, code smells) as part of that check.
```

- [ ] **Step 2: Verify the file is still valid frontmatter + markdown**

Run: `head -6 templates/rules/04-code-quality.md`
Expected:
```
---
paths:
  - "**/*"
---

# Code Quality
```

- [ ] **Step 3: Commit**

```bash
git add templates/rules/04-code-quality.md
git commit -m "docs(rules): point code-quality rule at uncle-bob-craft for review criteria"
```

---

## Task 5: Dogfood — vendor the skill into this repo's own `.claude/skills/`

**Files:**
- Create: `.claude/skills/uncle-bob-craft/SKILL.md`
- Create: `.claude/skills/uncle-bob-craft/README.md`
- Create: `.claude/skills/uncle-bob-craft/reference.md`
- Create: `.claude/skills/uncle-bob-craft/examples/code-review-checklist.md`
- Create: `.claude/skills/uncle-bob-craft/references/clean-agile.md`
- Create: `.claude/skills/uncle-bob-craft/references/clean-architecture.md`
- Create: `.claude/skills/uncle-bob-craft/references/clean-coder.md`
- Create: `.claude/skills/uncle-bob-craft/references/design-patterns.md`

**Interfaces:**
- Consumes: nothing (independent copy from the same upstream source as Task 1 — this repo's
  own `.claude/skills/` is not fed by `templates/skills/`, they are two separate copies).
- Produces: `.claude/skills/uncle-bob-craft/SKILL.md`, which Task 6's `.claude/CLAUDE.md`
  trigger note references by path.

- [ ] **Step 1: Copy the source directory verbatim**

```bash
mkdir -p .claude/skills/uncle-bob-craft
cp -R /Users/leandrosilvaferreira/Projetos/swapo/swapo-app/.claude/skills/uncle-bob-craft/. .claude/skills/uncle-bob-craft/
```

- [ ] **Step 2: Normalize `SKILL.md` frontmatter to house style**

Edit `.claude/skills/uncle-bob-craft/SKILL.md`, replacing:

```yaml
---
name: uncle-bob-craft
description: "Use when performing code review, writing or refactoring code, or discussing architecture; complements clean-code and does not replace project linter/formatter."
category: code-quality
risk: safe
source: community
date_added: "2026-03-06"
author: antigravity-contributors
tags: [clean-code, clean-architecture, solid, code-review, craftsmanship, uncle-bob]
tools: [claude, cursor, gemini]
---
```

with:

```yaml
---
name: uncle-bob-craft
description: Use when performing code review, writing or refactoring code, or discussing architecture; complements clean-code and does not replace project linter/formatter.
---
```

Do not touch anything below the closing `---` — the body stays exactly as copied.

- [ ] **Step 2: Verify**

```bash
find .claude/skills/uncle-bob-craft -type f | sort
head -5 .claude/skills/uncle-bob-craft/SKILL.md
```
Expected: same 8-file listing and same 4-line frontmatter as Task 1 Steps 2 and 4.

- [ ] **Step 3: Commit**

```bash
git add .claude/skills/uncle-bob-craft/
git commit -m "chore(dogfood): add uncle-bob-craft skill for this repo's own review process"
```

---

## Task 6: Wire the dogfood trigger in `.claude/CLAUDE.md`

**Files:**
- Modify: `.claude/CLAUDE.md`

**Interfaces:**
- Consumes: `.claude/skills/uncle-bob-craft/SKILL.md` from Task 5 (the path referenced in
  the trigger note must exist).
- Produces: nothing consumed by later tasks.

- [ ] **Step 1: Append a trigger section, mirroring the existing graphify section**

Current full file content:

```markdown
# graphify
- **graphify** (`.claude/skills/graphify/SKILL.md`) - any input to knowledge graph. Trigger: `/graphify`
When the user types `/graphify`, invoke the Skill tool with `skill: "graphify"` before doing anything else.
```

Change to:

```markdown
# graphify
- **graphify** (`.claude/skills/graphify/SKILL.md`) - any input to knowledge graph. Trigger: `/graphify`
When the user types `/graphify`, invoke the Skill tool with `skill: "graphify"` before doing anything else.

# uncle-bob-craft
- **uncle-bob-craft** (`.claude/skills/uncle-bob-craft/SKILL.md`) - Uncle Bob criteria (SOLID, Dependency Rule, code smells) for reviewing or writing this plugin's own code.
When reviewing a diff, PR, or non-trivial implementation in this repo, invoke the Skill tool with `skill: "uncle-bob-craft"` before finishing.
```

- [ ] **Step 2: Verify**

Run: `cat .claude/CLAUDE.md`
Expected: the 6-line file shown above, exactly.

- [ ] **Step 3: Commit**

```bash
git add .claude/CLAUDE.md
git commit -m "chore(dogfood): trigger uncle-bob-craft from this repo's own CLAUDE.md"
```

---

## Task 7: Add a condensed craft checklist to `aia-harness-code-reviewer`

**Files:**
- Modify: `.claude/agents/aia-harness-code-reviewer.md:349-351`

**Interfaces:**
- Consumes: nothing (this agent's `tools:` frontmatter is `[Read, Grep, Glob, Bash]` — no
  `Skill` tool, so it cannot invoke `uncle-bob-craft` directly; the criteria must be inlined
  as prose instead of referenced via Skill-tool invocation).
- Produces: nothing consumed by later tasks.

- [ ] **Step 1: Insert a new section between Dimension 7 and the Output format section**

In `.claude/agents/aia-harness-code-reviewer.md`, find:

```
Flag as **MINOR**: style inconsistencies, missing frontmatter fields.

---

## Output format
```

Replace with:

```
Flag as **MINOR**: style inconsistencies, missing frontmatter fields.

---

## Complementary: Craft & Design (Uncle Bob criteria)

Not a numbered dimension — apply opportunistically while auditing the 7 dimensions above,
on any `lib/`, `bin/`, or `scripts/` code touched. Full criteria:
`.claude/skills/uncle-bob-craft/SKILL.md`.

- **Dependency Rule**: does `lib/` (pure core) stay free of IO? IO belongs only in `detect`
  (reads), `apply` (writes), `bin` (orchestrates) — per this project's own architecture.
- **SOLID in context**: single responsibility per catalog/generator/detector module; no
  god-functions doing selection + rendering + IO in one place.
- **Smells**: rigidity (one change forces edits across many files), needless repetition
  (same catalog-selection logic duplicated instead of shared), opacity (a function whose
  name doesn't match what it does).
- Suggest at most one or two concrete refactors — do not turn this into a second audit
  pass. Fold any finding into MINOR unless it independently meets a CRITICAL/MAJOR bar from
  the 7 dimensions above.

---

## Output format
```

- [ ] **Step 2: Verify the 7-dimension gate and output contract are untouched**

Run: `grep -n "Run \*\*all seven dimensions\*\*\|^## Output format\|^### DIMENSION" .claude/agents/aia-harness-code-reviewer.md`
Expected: still exactly 7 `### DIMENSION` headings (1 through 7), the "Run all seven
dimensions" line unchanged, and `## Output format` still present — this new section must
not renumber or replace any of the mandatory 7.

- [ ] **Step 3: Commit**

```bash
git add .claude/agents/aia-harness-code-reviewer.md
git commit -m "chore(dogfood): add Uncle Bob craft checklist to aia-harness-code-reviewer"
```

---

## Task 8: Document the new skill in README.md

**Files:**
- Modify: `README.md:240`
- Modify: `README.md:278-283`

**Interfaces:**
- Consumes: nothing.
- Produces: nothing consumed by later tasks (pure documentation).

- [ ] **Step 1: Update the "What Gets Scaffolded" bullet**

In `README.md`, change:

```
- 🧰 **`.claude/skills/`** — operational skills (`run-tests`, `lint-fix`, `pre-commit-verify`, `setup-testing`, …).
```

to:

```
- 🧰 **`.claude/skills/`** — operational skills (`run-tests`, `lint-fix`, `pre-commit-verify`, `setup-testing`, `uncle-bob-craft`, …).
```

- [ ] **Step 2: Add a row to the "First-party skills shipped into your project" table**

In `README.md`, change:

```
| `goal-builder` | Generates an optimized `/goal` command for autonomous / overnight execution. |
| `adianti-framework` | Expert guidance for PHP Adianti Framework 7.x/8.x (TRecord, TForm, TDataGrid, CRUD, master-detail). |
```

to:

```
| `goal-builder` | Generates an optimized `/goal` command for autonomous / overnight execution. |
| `uncle-bob-craft` | Applies Robert C. Martin's Clean Code/Architecture/Coder/Agile criteria during code review and writing — Dependency Rule, SOLID, code smells. |
| `adianti-framework` | Expert guidance for PHP Adianti Framework 7.x/8.x (TRecord, TForm, TDataGrid, CRUD, master-detail). |
```

- [ ] **Step 3: Verify**

Run: `grep -n "uncle-bob-craft" README.md`
Expected: 2 matches — one in the bullet (Step 1), one in the table row (Step 2).

- [ ] **Step 4: Commit**

```bash
git add README.md
git commit -m "docs: document uncle-bob-craft in the shipped-skills list"
```

---

## Task 9: Full verification gate

**Files:** none (verification only).

**Interfaces:**
- Consumes: everything from Tasks 1–8.
- Produces: nothing — this is the final gate.

- [ ] **Step 1: Run the full test suite**

Run: `npm test`
Expected: PASS — 0 failures, including `tests/catalog-paths-integrity.test.mjs`,
`tests/templates-orphan.test.mjs`, `tests/project-catalog.test.mjs`, and
`tests/skill-map.test.mjs`.

- [ ] **Step 2: Confirm no stray files**

Run: `git status --short`
Expected: clean (nothing beyond what was committed task-by-task) — if anything is listed,
it means a step above missed a commit.

- [ ] **Step 3: Spot-check a generated CLAUDE.md end-to-end**

Run: `node bin/harness.mjs plan . --json | grep -o '"id": "skill:uncle-bob-craft"'`
Expected: one match (`"id": "skill:uncle-bob-craft"`) — confirms the skill artifact is
actually reachable through the real `scan → plan` pipeline on this repo itself, not just
present in the catalog source. (Skill artifact ids are prefixed `skill:` — a bare
`"uncle-bob-craft"` pattern will not match and is not a failure signal.)
