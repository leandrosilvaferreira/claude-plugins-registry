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
