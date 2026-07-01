---
paths:
  - "templates/ecc/agents/**"
  - "templates/ag-kit/agents/**"
  - "templates/agents/**"
  - "lib/data/ecc-catalog.mjs"
  - "lib/data/agkit-catalog.mjs"
  - "lib/data/project-catalog.mjs"
---

# Agent routing-description standard

Any candidate agent distributed to target projects must carry a best-practice
routing description (condition-shaped, "Use proactively" + explicit triggers) in
its provenance `*_AGENT_WHEN_TO_USE` map — the single source of truth that fills
both the agent frontmatter and the generated CLAUDE.md routing table.

After creating or editing a candidate agent (or its map entry):

1. Run `/revise-agent-frontmatter [agent-name]` (or with no arg to sweep all).
2. It authors the canonical description, writes the map, runs
   `node scripts/apply-agent-descriptions.mjs`, and verifies the gate.
3. `npm test` must pass — `tests/agent-frontmatter-standard.test.mjs` fails on any
   missing, non-compliant, drifted, or orphan description.

Never hand-edit vendored agent frontmatter; change the map and re-propagate.
