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
