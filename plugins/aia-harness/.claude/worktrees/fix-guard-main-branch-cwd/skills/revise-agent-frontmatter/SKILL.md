---
name: revise-agent-frontmatter
description: >
  Review and upgrade the routing descriptions of candidate agents under
  templates/ (ECC, ag-kit, first-party) so each follows the best-practice
  standard — condition-shaped, with "Use proactively" and explicit trigger
  conditions. Writes the canonical description into the matching
  *_AGENT_WHEN_TO_USE map, propagates it into every agent file, and verifies the
  integrity gate. Use after editing any candidate agent, or standalone to sweep
  all of them.
argument-hint: "[agent-name]"
allowed-tools:
  - Bash
  - Read
  - Edit
---

# Revise agent routing descriptions

Single source of truth: the `*_AGENT_WHEN_TO_USE` maps in
`lib/data/{ecc,agkit,project}-catalog.mjs`. Each entry is the canonical
best-practice description that fills BOTH the agent's frontmatter (native router)
AND the generated CLAUDE.md routing table.

Target: a single agent named `$1` if provided, else sweep ALL candidate agents.

## The standard (every description must satisfy `checkAgentDescription`)

- Condition-shaped: say WHEN to reach for the agent, not just what it knows.
- Contains "Use proactively" (and "MUST BE USED" when it should fire unprompted on
  a class of edits).
- Names explicit triggers: file kinds, task verbs, the domain it owns.
- One logical line; no raw `|`; 40–600 chars.

Pattern:
> Reviews <domain> for <concerns>. Use proactively after <trigger>. MUST BE USED before <gate>.

## Step 1 — Enumerate targets

```bash
ls templates/ecc/agents templates/ag-kit/agents templates/agents
```

If `$1` is set, restrict to that one file.

## Step 2 — For each target agent

1. Read the agent file body to understand its real domain/role.
2. Author (or upgrade) a single-line canonical description meeting the standard.
3. Find the map it belongs to by provenance:
   - `templates/ecc/agents/*` → `ECC_AGENT_WHEN_TO_USE` in `lib/data/ecc-catalog.mjs`
   - `templates/ag-kit/agents/*` → `AGKIT_AGENT_WHEN_TO_USE` in `lib/data/agkit-catalog.mjs`
   - `templates/agents/*` → `PROJECT_AGENT_WHEN_TO_USE` in `lib/data/project-catalog.mjs`
4. `Edit` that map entry (add it if missing). Keep entries one per line; remove any
   stale "≤8 words" comment above the map.

## Step 3 — Propagate to files

```bash
node scripts/apply-agent-descriptions.mjs
```

This rewrites every agent file's `description` (folded) from the maps. Idempotent.

## Step 4 — Verify

```bash
node --test tests/agent-frontmatter-standard.test.mjs
npm run typecheck && npm run lint
```

All green = done. If the standard test fails, read the violation message, fix the
offending map entry, and re-run Steps 3–4.

## Notes

- Never edit vendored agent frontmatter by hand — it is regenerated from the maps
  by the transforms on sync and by `apply-agent-descriptions.mjs` locally. The map
  is the only place to change a description.
- This skill is local to the aia-harness repo. Do not move it under `templates/`.
