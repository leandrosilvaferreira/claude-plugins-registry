# Strategic testing guidance — design

**Date:** 2026-07-12
**Status:** approved (design), pending implementation plan

## Problem

Harnesses scaffolded by this plugin tell target-project agents to write a unit
test for **every new function or module**. In practice this over-tests: agents
add tests for trivial getters, one-line wrappers, config, glue, and purely
presentational UI. Result — slow development, brittle low-value tests, wasted
compute. The pressure is **wording only**: no hook forces tests
(`verify-on-stop` runs lint + typecheck, not the test suite). Three shipped
statements restate the absolutist policy:

1. `lib/generate/claude-md.mjs` — `ROOT_FIXED_RULES[1]`: *"Write unit tests for
   every new function or module added."* Emitted into a guarded, non-editable
   section of **every** generated root `CLAUDE.md`; loads every session. Highest
   leverage.
2. `lib/generate/rules.mjs` — the generated `.claude/rules/testing.md` body:
   *"For every new function, class, or module added: Write at least one unit
   test…"* (path `**/*`). Also contradicts the more balanced
   `templates/rules/05-testing.md` that ships alongside it.
3. `templates/skills/setup-testing/SKILL.md` step 7 — the note it writes into the
   target `CLAUDE.md`: *"Write unit tests for **every** new function or module
   added…"*.

## Goals

- Replace absolutist wording with a **risk-based decision rubric** as the single
  source of truth, so agents test what can break and skip what can't.
- Give an on-demand, graphify-powered triage skill (`/test-triage`) that ranks the
  symbols changed in a session by test-worthiness.
- Keep it **guidance, not enforcement** — no new hook, dev flow stays fast.
- No over-engineering: reuse existing artifacts, no new agent, no new `.mjs`
  script, no touching vendored files.

## Non-goals

- No enforcement hook. `verify-on-stop` stays lint + typecheck.
- No edits to vendored ECC `*-testing` skills (coverage-% tables) or the vendored
  graphify skill — `npm run sync:*` clobbers edits. Minor residual tension
  accepted; those skills are read only while actively testing a stack, they are
  not the "test everything" driver.
- No merge of the two testing rule docs (`testing.md` generated vs `05-testing.md`
  copied); the generated one keeps injecting the detected test command and now
  points at the rubric. Merging is a larger refactor, out of scope.
- Not registered in `lib/data/skill-map.mjs` (the "## Skills — for this stack"
  advertiser) — `setup-testing` isn't there either; discovery is via the rubric
  referencing `/test-triage`.

## Approach

One rubric, two consumers. The rubric lives in `templates/rules/05-testing.md`
(the natural policy doc, path `**/*`, always installed). Every other testing
statement points at it instead of restating a competing policy. `/test-triage`
applies the same rubric to a batch of changed symbols, using graphify's
`affected` traversal as an objective blast-radius signal when the graph exists,
and a static fallback otherwise.

Research basis (Kent C. Dodds "Testing Trophy", Google Testing Blog "Test
Behavior Not Implementation", Fowler, Beck, Coplien "Why Most Unit Testing is
Waste", Tornhill "Your Code as a Crime Scene", McCabe cyclomatic complexity,
Testing Library guiding principles). Named thresholds used: McCabe CC ≤ 10 and
CC = minimum branch-covering tests; blast-radius default ≥ 3 (tunable).

Wording style: terse/imperative ("caveman-objective") for scannability. All
shipped text is English (repo convention: `templates/` is source).

## Changes

### 1. `templates/rules/05-testing.md` — rewrite as the rubric (single source of truth)

Replace the ~40-bullet Do/Don't wall with the approved rubric. Sections:
`Objective` · `Test it — real logic + stakes` (TRIGGER = real logic ~CC ≥ 2 AND
≥1 amplifier: business/money/security/auth, algorithm, high fan-in, hotspot,
regression, big blast radius) · `Skip it — no logic to break` (trivial
getter/setter, one-line wrapper, pass-through, framework glue, config, generated
code, presentational UI, thin wrapper, implementation-detail tests, "always
passes") · `Objective signals` (CC, hotspot = change×complexity, risk =
impact×likelihood, `graphify affected`) · `Frontend` (test only conditional
rendering / form validation / state logic / a11y-critical; pure presentational →
no) · `How` (behavior via public API, deterministic, mock only boundaries) ·
`Graphify — if graphify-out/ exists` (`graphify affected`, `/test-triage`,
import-cycle/degree) · `Acceptance`. Full approved text captured below in
Appendix A.

### 2. `lib/generate/claude-md.mjs` — `ROOT_FIXED_RULES[1]`

Replace the bullet with one dense strategic line:

> `Test what can break — business rules, branching logic, money/security/auth, bug regressions; skip trivial getters, wrappers, config, presentational UI (rubric: \`.claude/rules/05-testing.md\`).`

The existing test `tests/skill-map.test.mjs` ("renderRootClaudeMd ships fixed
rules…") loops `ROOT_FIXED_RULES` and asserts each entry appears verbatim — it
reads the array, so changing the text keeps it green automatically.

### 3. `lib/generate/rules.mjs` — generated `.claude/rules/testing.md` body

Drop "for every new function"; keep the detected test command; point at the
rubric:

```markdown
# Testing

Test what can break, not every function. Full rubric: `.claude/rules/05-testing.md`.

- Test: business rules, branching logic (CC ≥ 2), money/security/auth, algorithms, edge cases, bug regressions.
- Skip (or integration-only): trivial getters/wrappers, pass-through, config, presentational UI, generated code.
- Run `{c.test}` before claiming done.   ← keeps the "Run the project's test command…" fallback when c.test is absent
```

No test asserts this body (render-testing.test.mjs targets the scan **report**
in `lib/render.mjs`, not this rule). Verify green after the change.

### 4. `templates/skills/setup-testing/SKILL.md` — step 7 note

Replace the CLAUDE.md note it writes with the strategic version:

> `> **Tests:** \`{framework}\` — run \`{test-command}\`. Test what can break (business rules, branching logic, bug regressions); skip trivial/presentational code. Rubric: \`.claude/rules/05-testing.md\`.`

### 5. `templates/skills/test-triage/SKILL.md` — NEW first-party skill

Full content in Appendix B. Behavior: collect changed symbols (`git status` /
`git diff`), score each against the rubric (TRIGGER then amplifiers), use
`graphify affected "<symbol>"` (default amplifier threshold ≥ 3) + `graphify
explain` + import-cycle when `graphify-out/graph.json` exists, else fall back to
caller search + code reading, then emit a per-symbol table with verdicts
**TEST** / **integration-only** / **SKIP** and act only on TEST rows. Aid, not
enforcer. No authored script (uses `git` + `graphify` CLIs and the agent's own
search); on-demand only.

### 6. `lib/data/project-catalog.mjs` — register the skill

Add `"test-triage"` to `PROJECT_COMMON.skills` (stack-independent; degrades
gracefully without graphify).

## Testing (dogfood — mandatory)

- **New** `tests/test-triage-skill.test.mjs`, mirroring
  `tests/setup-testing-skill.test.mjs`: assert `test-triage` ∈
  `PROJECT_COMMON.skills`; appears in `selectProjectAssets` for any stack; SKILL.md
  declares `name: test-triage`; SKILL.md mentions `graphify affected` and the
  three verdicts. (The existing generic loop "every common skill has a template
  directory with SKILL.md" auto-covers template existence once registered.)
- **Regression lock** (cheap, prevents silent revert to "test everything"): add
  an assertion — either extend an existing test or the new file — that the
  generated root `CLAUDE.md` and `templates/rules/05-testing.md` contain
  strategic markers (`/skip/i`, `presentational`, `branching`) and do **not**
  contain `every new function`.
- `npm test` green (typecheck + lint + unit).

## Risks / open tuning

- Blast-radius threshold `≥ 3` is a heuristic default, stated as tunable in the
  rubric and skill. Not enforced numerically anywhere.
- `graphify affected` is documented as present in the installed CLI but not yet in
  the vendored graphify SKILL.md; the skill degrades gracefully if the subcommand
  is absent (fall back to `explain` / caller search).
- Residual tension with vendored ECC coverage-% tables (left intact by design).

## Appendix A — approved `05-testing.md` content

Lift verbatim into `templates/rules/05-testing.md`:

````markdown
---
paths:
  - "**/*"
---

# Testing — what deserves a test

## Objective

Test what can break. Skip what can't. Too many low-value tests slow dev and rot.
No test beats a test that only restates the code.

## Test it — real logic + stakes

Write a unit test when the unit has real logic (branch, loop, calculation, parser,
non-trivial condition — ~CC ≥ 2) AND hits ≥1 of:

- Business rule, money, security, auth.
- Algorithm / non-obvious computation.
- Reused widely — many callers / high fan-in.
- Hotspot — changes often × complex.
- Regression — bug that already happened once.
- Big blast radius — breaks many callers if wrong.

Always cover happy path + edge cases (empty, null, boundary, error).
Branch count = minimum number of test cases.

## Skip it — no logic to break

No test, or cover indirectly via ONE integration test:

- Trivial getter/setter, one-line wrapper, pass-through / delegation.
- Framework glue, config, generated code.
- Presentational UI — styling-only, layout-only, dumb display component.
- Thin wrapper over an already-tested library.
- Test would assert implementation detail (call order, private state, mock calls)
  → breaks on refactor, adds no confidence.
- "Always passes" — no failure mode exists.

## Objective signals — decide + prioritize

- **Cyclomatic complexity (CC)** — McCabe: keep ≤ 10. CC = independent paths =
  minimum tests for full branch coverage. CC 1 → skip. CC high → test each branch.
- **Hotspot** — change frequency × complexity (Tornhill). High → test first.
- **Risk** — impact × likelihood (blast radius). High impact + likely = must test.
  Low + low → skip or regression-only.
- **`graphify affected "<symbol>"`** → blast radius directly. Big affected set =
  high-value target. See Graphify below.

## Frontend

Test a component ONLY if it has:

- Conditional rendering — different UI by state/props.
- Form / input validation.
- State logic — reducer, machine, non-trivial hooks.
- Accessibility-critical behavior.

Pure presentational / styling-only → no unit test.
Test what the user sees and does, not props/state internals.

## How

- Test behavior via the public API, not private methods.
- Deterministic, fast, isolated. No real network / DB / clock — inject or fake.
- Mock only external boundaries.
- Name tests by expected behavior.
- Update tests when behavior changes; never delete a failing test without
  understanding what it guards.

## Graphify — if `graphify-out/` exists

- Blast-radius signal: `graphify affected "<symbol>"` — count = how much breaks
  if this changes.
- Rank a batch of changed symbols: run `/test-triage` → TEST / integration-only /
  SKIP per symbol.
- Import cycle or high degree (`graphify explain "<symbol>"`) = extra risk signal.

## Acceptance

- Every changed business rule / decision path has a test.
- Every fixed bug has a regression test.
- Tested units cover happy + edge cases.
- Trivial / presentational / glue code NOT padded with empty tests.
- Suite deterministic and green.
````

## Appendix B — proposed `test-triage/SKILL.md` content

Proposed content (review in the spec gate before implementation):

````markdown
---
name: test-triage
description: Rank the functions/modules changed this session by test-worthiness and output TEST / integration-only / SKIP per symbol. Uses graphify blast-radius when graphify-out/ exists, a static rubric otherwise. Use when you changed several units and are unsure which deserve a unit test, or before writing tests for a batch of new code.
---

# Test triage — what to test among your changes

Decide which changed units deserve a unit test. Aid, not enforcer — you still decide.
Policy = `.claude/rules/05-testing.md`. This skill applies it to a batch, with
objective signals.

## 1. Collect changed symbols

Take the functions / modules you created or changed this session. Confirm with:

- `git status --short` and `git diff --name-only` (uncommitted), or
- `git diff --name-only <base>...HEAD` if the work is committed.

List the concrete symbols (functions, classes, components) touched — not just files.

## 2. Score each symbol

TRIGGER first: does it have real logic (branch, loop, calculation, parser,
non-trivial condition — ~CC ≥ 2)? No logic → **SKIP** (trivial getter, wrapper,
pass-through, config, presentational UI).

If it has logic, weigh amplifiers:

- Business rule / money / security / auth → strong TEST.
- Reused / high fan-in / big blast radius → strong TEST.
- Pure presentational component, thin wrapper → SKIP or integration-only.

### With graphify (`graphify-out/graph.json` exists)

- `graphify affected "<symbol>"` — count of things that break if it changes.
  Default: affected ≥ 3 → amplifier met (tune per project).
- `graphify explain "<symbol>"` — degree + connections; high degree = extra risk.
- Import-cycle membership = extra risk.

### Without graphify

- Blast radius ≈ number of callers: search the repo for the symbol name.
- Judge logic + business/security by reading the code.

## 3. Output the triage table

One row per symbol:

| Symbol | Signal | Verdict | Why |
| --- | --- | --- | --- |
| `calcTax()` | affected 7, business | **TEST** | tax rule, wide blast radius |
| `Badge.tsx` | presentational | SKIP | styling-only |
| `wireRoutes()` | affected 4, no logic | integration-only | glue, cover via 1 route test |

Verdicts: **TEST** (happy + edge), **integration-only** (cover via one
higher-level test), **SKIP** (no value).

## 4. Act

Write tests only for TEST rows. State the SKIP / integration-only calls so the
user can override. Do not pad SKIP symbols with empty tests.
````
