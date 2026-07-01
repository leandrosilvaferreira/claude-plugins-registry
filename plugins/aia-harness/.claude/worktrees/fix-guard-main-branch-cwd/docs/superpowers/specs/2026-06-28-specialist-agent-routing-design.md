# Design — Reliable specialist-agent routing in scaffolded harnesses

Date: 2026-06-28
Status: approved (brainstorming) → ready for implementation plan

## Problem

When the harness is installed into a target project it scaffolds many specialist
agents under `.claude/agents/` (ECC reviewers/build-resolvers, ag-kit specialists,
first-party reviewers). In practice the interactive Claude Code session almost
always dispatches **generic** subagents instead:

- `superpowers:dispatching-parallel-agents` hardcodes `Subagent (general-purpose)`
  in its examples.
- `superpowers:subagent-driven-development` dispatches a generic "implementer
  subagent" (`./implementer-prompt.md`) with no awareness of project specialists.
- Agent `description` frontmatter quality is uneven across provenances: ECC
  reviewers already follow best practices ("Proactively reviews…", "MUST BE
  USED…"); ag-kit is inconsistent; first-party (`nestjs-*`) is capability-shaped
  with no trigger conditions and no "use proactively".

Result: the specialist roster is ~99% ignored.

## Root cause (from research)

Claude Code routes to a subagent on **two** mechanisms:

1. **Native auto-delegation** — matches the task against each agent's
   `description` frontmatter. Weak/capability-shaped descriptions don't fire.
2. **Explicit table-driven routing** — the main agent consults an instruction
   ("use agent X for task Y") and passes the name as `subagent_type`. More
   reliable, but only if the instruction exists and overrides the superpowers
   defaults.

Best practices (Anthropic docs + ecosystem): descriptions must be
**condition-shaped** (when, not just what), include **"Use proactively"** and
explicit **trigger conditions**; CLAUDE.md is the place to encode mandatory
routing policy; user CLAUDE.md is the **highest priority** instruction layer and
legitimately overrides superpowers skill examples.

## Goal

Make a scaffolded target project reliably dispatch to the specialist that owns a
domain, on both routing mechanisms, **durably** across re-vendoring, without
changing the normal superpowers flow
(`brainstorming → writing-plans → subagent-driven-development`).

## Key constraints discovered

- **ECC + ag-kit agents are vendored.** `npm run sync:ecc` / `sync:agkit` rewrite
  their frontmatter through the pure transforms (`lib/ecc/transform.mjs`,
  `lib/agkit/transform.mjs`). Editing vendored frontmatter in place is clobbered
  on the next sync. → durability must live in the transform pipeline.
- **The `*_WHEN_TO_USE` maps (`lib/data/*.mjs`) are our code, never clobbered.**
  → they are the safe, durable source of truth.
- **`parseFrontmatter` is currently single-line only** (`^([A-Za-z0-9_-]+):\s?(.*)$`),
  so YAML folded scalars (`description: >`) do not survive the transform today.
  **Decision: extend the parser + renderer to support folded scalars** so agent
  `description` can be authored as a readable multi-line folded block in the file.
  The folded **logical value** is still one line (folding turns newlines into
  spaces), so the same value stays markdown-table-safe when it feeds the
  CLAUDE.md table.
- `cleanAgentMarkdown` (agkit) already parses entries, rewrites `tools`, forces
  `model: sonnet` — the exact injection point for a description override. ECC has
  an analogous agent-clean step sharing `splitFrontmatter`.
- Infrastructure that already exists and is reused (not rebuilt):
  `agentsWorkflowBlock` + `## Workflow & Agents` table, `resolveAgentWhenToUse`,
  the three `*_AGENT_WHEN_TO_USE` maps, the `07-subagent-dispatch.md` distributed
  rule, `lib/validate/frontmatter.mjs`, the `deps-catalog-integrity.test.mjs`
  pattern.

## Decisions (locked during brainstorming)

1. **Vendored durability via transform** — one canonical description per agent in
   our maps; transforms inject it into vendored frontmatter on every sync.
2. **Deterministic gate as a unit test** run by `npm test` (not a separate CI
   step).
3. Skill name: `revise-agent-frontmatter` (parallel to `revise-claude-md`).
4. **Extend the parser + renderer to support YAML folded scalars** so agent
   `description` is authored as a readable multi-line folded block; the folded
   logical value is one line (table-safe).
5. Checker scope: `description` standard + basic frontmatter validity
   (`name`/`tools`/`model`).

## Architecture: one source of truth, two consumers

```text
maps *_AGENT_WHEN_TO_USE  (lib/data/{ecc,agkit,project}-catalog.mjs = TRUTH)
  ├─ resolveAgentWhenToUse ──→ CLAUDE.md "## Workflow & Agents" table + bridge
  │                            (generated per target project)
  └─ applyCanonicalDescription
        ├─ ecc/agkit agent-clean transforms (on sync) ──→ vendored frontmatter (durable)
        └─ direct propagation pass            ──→ first-party frontmatter + immediate refresh

skill  = authors the strings + propagates + verifies
test   = guard-rail in `npm test`
```

The same canonical value fills the native-router frontmatter **and** the
CLAUDE.md table cell. It is stored as one logical string in the JS maps, rendered
**folded** (multi-line, readable) into agent frontmatter, and **flattened** to one
line for the table. No second map; the existing `*_AGENT_WHEN_TO_USE` maps are
upgraded in place to best-practice prose.

## Components

### C1 — Canonical descriptions (the maps)

Rewrite every entry in `ECC_AGENT_WHEN_TO_USE`, `AGKIT_AGENT_WHEN_TO_USE`,
`PROJECT_AGENT_WHEN_TO_USE` to the standard:

- condition-shaped (when to reach for it), not capability-shaped;
- contains "Use proactively" (and "MUST BE USED" where the agent should fire
  unprompted on a class of edits);
- explicit trigger conditions (file kinds, task verbs);
- one logical line when folded (no raw `|`; bounded length). Stored as a single
  JS string in the map; rendered folded into the agent file.

Fill gaps so **every** candidate agent file has an entry (e.g. ag-kit `debugger`
is currently missing). Distinguish agent-name keys from any stack-key entries
already present in `ECC_AGENT_WHEN_TO_USE`.

### C2 — Durable propagation

- **Parser/renderer extension (folded scalars):** extend `parseFrontmatter` to
  read a `key: >` folded block (gather indented continuation lines, fold newlines
  to spaces → one logical value) and `renderFrontmatter` to emit `description` as
  a folded block. Must round-trip: parse(render(x)) === x for the logical value.
  Shared by the ecc + agkit transforms (agkit already re-exports `splitFrontmatter`
  from ecc). Unit-tested directly (no IO).
- New pure helper `applyCanonicalDescription(entries, agentName)` (e.g.
  `lib/validate/agent-description.mjs` or a sibling) — given parsed frontmatter
  entries and the agent name, replace/insert the `description` entry from the
  canonical map. Pure, unit-tested.
- Call it from the **ecc** agent-clean transform and the **agkit**
  `cleanAgentMarkdown` so vendored frontmatter is overwritten from the map on
  every sync.
- First-party agents (`templates/agents/*.md`): the skill writes the map string
  into the file frontmatter directly (no sync to ride on).
- An idempotent **propagation pass** (engine helper the skill invokes) applies
  map → all agent files for immediate effect without a network re-sync.

### C3 — Skill `revise-agent-frontmatter` (local, NOT distributed)

Lives in `skills/revise-agent-frontmatter/` (this repo only; like
`harness-engineering`, `revise-claude-md`). Two modes:

- **Full sweep** — review every candidate agent under `templates/ecc/agents/`,
  `templates/ag-kit/agents/`, `templates/agents/`.
- **Single-agent** — review just the agent that was edited.

Agentic responsibilities (the judgment the engine can't do):

1. Read the agent body, classify its role/domain.
2. Author/upgrade the best-practice single-line description.
3. Write it into the correct catalog map (ECC / ag-kit / project).
4. Run the propagation pass (C2) to update files.
5. Run the checker (C4) + `npm run typecheck && npm run lint && npm test`.

### C4 — Deterministic gate (unit test)

- Pure checker `lib/validate/agent-description.mjs`:
  `checkAgentDescription(text) → { ok, violations[] }` enforcing the C1 standard
  (trigger/"proactively" signal, single line, no raw `|`, length bound) plus
  basic frontmatter validity (name matches filename, `tools`/`model` present &
  valid — reuse `lib/validate/frontmatter.mjs`).
- `tests/agent-frontmatter-standard.test.mjs` (runs under `npm test`): for every
  candidate agent assert (a) a map entry exists, (b) it passes the checker, (c)
  the agent file frontmatter matches the map (no drift). Mirrors
  `deps-catalog-integrity.test.mjs`.

### C5 — Dynamic routing + superpowers bridge in the generated CLAUDE.md

Enhance `agentsWorkflowBlock(agents)` (`lib/generate/claude-md.mjs`) to emit,
from the agents actually selected for that project:

- the existing `Agent | When to use` table (now with the upgraded strings);
- a new **"Superpowers → Project Specialists (mandatory bridging)"** subsection:
  - mandatory statement: never use `general-purpose` / the generic implementer
    when a listed specialist covers the domain;
  - rationale line: user CLAUDE.md is the highest-priority instruction layer and
    overrides the agent types shown in superpowers skill examples;
  - a **role → specialist** map built **only from installed agents** (no dangling
    rows pointing at uninstalled agents);
  - explicit note that the normal flow
    (`brainstorming → writing-plans → subagent-driven-development`) is unchanged;
    only the `subagent_type` chosen at dispatch changes.
- Role classification: a coarse `routingRole` per agent derived from name/catalog
  (e.g. `*-reviewer` → review, `*-build-resolver` → build-fix,
  `backend-specialist`/`frontend-specialist`/`database-architect`/`test-engineer`/
  `debugger`/`explorer-agent`/`code-archaeologist`/`orchestrator` → their buckets).
- Align the distributed `07-subagent-dispatch.md` rule to point at this section
  (it already says "consult the table") — no full duplication of the table.

### C6 — Repo enforcement instruction

- New path-scoped rule `.claude/rules/agent-frontmatter-standard.md` scoped to
  `templates/**/agents/**` and the catalog files, reminding: after creating or
  editing a candidate agent, run `/revise-agent-frontmatter` and `npm test`.
- One line in the repo `CLAUDE.md` "mandatory maintenance" conventions linking
  the agent-frontmatter standard to the catalog-maintenance rules already there.

## Rejected alternative

**Table-only** (never touch agent frontmatter; only improve maps + CLAUDE.md
bridge + rule). Simpler, but leaves the **native** router weak on vendored agents
— routing then works only when the main agent reads the table. The chosen
durable-via-transform path covers both routing mechanisms for ~1 helper + 2
call-sites + tests.

## Scope boundaries

- The skill is **local to this repo**, never shipped into target projects.
- No change to the superpowers orchestration flow; only the dispatched
  `subagent_type` is affected by the generated bridge.
- No new `*_WHEN_TO_USE`-style map; the three existing maps are upgraded.
- Catalog/test maintenance invariants from the repo CLAUDE.md continue to apply
  (new agent → register in its provenance catalog → entry in the map → passes the
  new integrity test).

## Acceptance criteria

1. Every candidate agent file has a best-practice description in its provenance
   map; `npm test` fails if any is missing or non-compliant or drifts from the
   file frontmatter.
2. Running `sync:ecc` / `sync:agkit` leaves vendored agent frontmatter carrying
   the canonical description, rendered as a folded block; the parser round-trips
   it (survives re-sync without drift).
3. A freshly scaffolded project's root `CLAUDE.md` contains the dynamic
   `## Workflow & Agents` table **and** the superpowers-bridge subsection built
   only from that project's installed agents.
4. `/revise-agent-frontmatter` runs in both full-sweep and single-agent modes and
   ends green on typecheck + lint + unit tests.
5. Editing a candidate agent surfaces the path-scoped rule reminder.
6. `npm test`, `npm run typecheck`, `npm run lint` all clean.

## Open implementation details (for writing-plans)

- Folded-scalar parser/renderer specifics: indentation rule for continuation
  lines, where the fold logic lives (extend `parseFrontmatter`/`renderFrontmatter`
  in `lib/agkit/transform.mjs` vs. lift into a shared frontmatter module), and
  whether folding is applied to `description` only or any long value.
- Exact home of `applyCanonicalDescription` and the propagation pass (new module
  vs. extend `lib/validate/frontmatter.mjs`).
- Where `routingRole` lives (per-agent field in each catalog vs. a small
  name-based classifier in `lib/generate/claude-md.mjs`).
- Precise wording template for the generated bridge subsection.
- ECC agent-clean call-site (confirm the ECC transform's agent function name and
  wire the helper symmetrically to agkit).
