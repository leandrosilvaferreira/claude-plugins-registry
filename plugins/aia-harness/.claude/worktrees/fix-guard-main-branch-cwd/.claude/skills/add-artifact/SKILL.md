---
name: add-artifact
description: Scaffold a new harness artifact in the aia-harness engine — wire a generator/catalog entry, add it to buildPlan with category/rationale/contextCost/defaultSelected, and add the matching node --test. Use when adding a new scaffolded file type, generator, or catalog-driven artifact to lib/. Triggers on "add an artifact", "new generated file", "wire a new harness output".
disable-model-invocation: true
---

# Add a harness artifact

Adds one new artifact to the scan → plan → apply engine, end to end. The engine
emits `Artifact`s from `lib/plan.mjs` `buildPlan`; each is either inline
`content` (from a `lib/generate/*` renderer) or a `copyFrom` source under
`templates/`. Follow the same three steps every time so nothing drifts.

## Step 1 — produce the content

Pick one:

- **Rendered inline** (depends on the detected profile): add a renderer in the
  matching `lib/generate/*.mjs` (e.g. `claude-md`, `rules`, `settings`, `mcp`,
  `misc`). It takes the `ProjectProfile` (typedefs in `lib/profile.mjs`) and
  returns a string. Keep it **pure** — no IO.
- **Static / vendored** (same bytes for every project): drop the file under
  `templates/…` and reference it with `copyFrom` instead of `content`.
- **Catalog-driven** (only applies to some stacks): add an entry + selection
  predicate in the right `lib/data/*.mjs` catalog, mirroring the existing
  entries' shape.

## Step 2 — register it in buildPlan

In `lib/plan.mjs`, call `add({ … })` with every field:

| Field | Rule of thumb |
|-------|----------------|
| `id` | Stable, unique, namespaced (e.g. `rule:foo`, `ecc-agent:bar`). |
| `relPath` | Target path relative to the scanned project root. |
| `title` | Human label shown in the consent UI. |
| `category` | One of the union in the `Artifact` typedef. |
| `rationale` | One line: why this file, what it buys. |
| `contextCost` | `estTokens(content)` **only** if loaded every session; `0` for lazy/path-scoped/`copyFrom`. Default to `0`. |
| `defaultSelected` | `true` for core files; `false` for opt-in (e.g. `.lsp.json`, install scripts). |
| `content` **or** `copyFrom` | Exactly one. `executable: true` for shell scripts. |

Respect the safety invariants: secrets only as `${ENV}` placeholders; anything
personal goes to `settings.local.json` and into the plan's `gitignore` list.

## Step 3 — test it

Add/extend a `tests/*.test.mjs` file (node:test + node:assert/strict), mirroring
`tests/plan-apply.test.mjs`:

- The renderer (if any) returns the expected structure for a fixture profile.
- `buildPlan` includes the artifact with correct `category`, `defaultSelected`,
  and `contextCost` (0 vs estimated).
- `applyPlan` writes it on dry-run=false and does **not** overwrite an existing
  differing file without `force`.

## Verify

```bash
node --test tests/<file>.test.mjs   # the new test
npm test                            # typecheck + lint + unit, all green
node bin/harness.mjs plan . --json  # eyeball the artifact in a real plan
```

Don't report done until `npm test` is green and the artifact shows up in `plan`.
