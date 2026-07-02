# Design: `/aia-harness:revise-agent-routing` — Sync Agent Frontmatter ↔ CLAUDE.md Routing on Existing Projects

**Date:** 2026-07-01
**Status:** Approved

## Problem

`revise-agent-frontmatter` (existing skill) only touches aia-harness's **own** candidate agent
templates (`templates/ecc/agents`, `templates/ag-kit/agents`, `templates/agents`), keyed through
the `*_AGENT_WHEN_TO_USE` maps in `lib/data/{ecc,agkit,project}-catalog.mjs`. It says so
explicitly: "This skill is local to the aia-harness repo. Do not move it under `templates/`."

There is no command that audits agent routing quality on an **already-scaffolded target
project**. Agents added after `init` — by hand, via `/aia-harness:add-plugins`, via a third-party
plugin — can end up with weak/missing frontmatter `description`s, and/or be missing from, or
stale in, the project's own root CLAUDE.md `## Workflow & Agents` table (rendered by
`agentsWorkflowBlock()` in `lib/generate/claude-md.mjs`). The routing table silently drifts from
the agents that actually exist on disk.

`doctor.md`'s existing "agents" drift check (step 3a) only catches the case where a
**plan-known** artifact differs byte-for-byte from what `apply` would generate. It says nothing
about agents that were never a plan artifact (hand-written, third-party), and nothing about
whether a CLAUDE.md table entry still matches the agent it describes.

## Goal

A standalone command+skill pair, `/aia-harness:revise-agent-routing [path]`, that on an existing
target project:

1. Audits every `.claude/agents/*.md` frontmatter `description` against the same best-practice
   standard aia-harness already enforces internally (`checkAgentDescription`: condition-shaped,
   contains "Use proactively" + a when/after/before trigger, 40–600 chars, no `|`, no newline) —
   offers to rewrite in place when it fails.
2. Cross-references every agent against the project's CLAUDE.md file(s): is it in the
   `## Workflow & Agents` table? Does the table's when-to-use cell still match the (possibly
   just-fixed) frontmatter description? If not in the table, is it mentioned in prose anywhere
   without explaining who it's for? Is it not mentioned anywhere at all (orphan)?
3. Applies fixes one at a time, diff + explicit consent, never a blind full-file rewrite.

## Scope

- **Target:** any project directory (`$1` or `$CLAUDE_PROJECT_DIR`) with a `.claude/agents/` —
  does not need to have been scaffolded by aia-harness. The structured-table fast path only
  activates when the root CLAUDE.md already has the `## Workflow & Agents` section aia-harness
  generates; everywhere else falls back to the textual grep path.
- **Out of scope:** aia-harness's own `templates/` candidate agents (still
  `revise-agent-frontmatter`'s job, unchanged); skills' frontmatter (not part of this command);
  rewriting arbitrary CLAUDE.md prose beyond the minimal edit needed near an existing mention.
- **Pipeline (`scan → plan → apply`):** unchanged — this command never touches artifact catalogs
  and never calls `apply`.
- **Not wired into `/aia-harness:init` or `/aia-harness:doctor` in v1** — standalone, manually
  invoked. See "What does NOT change."

## Design

### New files

- **`commands/revise-agent-routing.md`** — thin orchestrator (mirrors
  `commands/condense-harness-prompts.md`): resolves the target dir (verbatim
  `<!-- aia-harness:target-dir-resolution -->` block, same as doctor/patch/condense), calls the
  skill's lib subcommands, drives `AskUserQuestion` + `Edit` per finding.
- **`skills/revise-agent-routing/SKILL.md`** — plugin-level skill (same tier as
  `skills/revise-claude-md/`, `skills/condense-harness-prompts/`). **Not** registered in
  `lib/data/project-catalog.mjs`, **not** copied into `templates/skills/`. Verified against the
  current catalog: none of the sibling maintenance skills (`revise-claude-md`,
  `condense-harness-prompts`, `revise-agent-frontmatter`, `harness-engineering`, `mcp-catalog`,
  `safe-hooks`) are distributed to target projects — they only run where the aia-harness plugin
  itself is active. This one follows the same rule.
- **`skills/revise-agent-routing/lib/revise-agent-routing.mjs`** — self-contained `.mjs`. **Correction
  from the initial review:** there IS precedent for a `skills/*/lib` script dynamically importing
  the top-level engine `lib/` — `condense.mjs`'s `frontmatter` subcommand does exactly this
  (`await import(join(pluginRoot, "lib/validate/frontmatter.mjs"))`, with `pluginRoot` computed
  from `import.meta.url`). This script follows the same pattern instead of duplicating logic. Four
  read-only subcommands, JSON out:

  | Subcommand | Purpose |
  |---|---|
  | `list --root <dir>` | Enumerate `.claude/agents/*.md`; split + parse frontmatter via dynamic import of `splitFrontmatter` (`lib/ecc/transform.mjs`) and `parseFrontmatter` (`lib/util/frontmatter-yaml.mjs`) → `{agents: [{file, name, description}], skipped: [{file, reason}]}`. Files with unparsable frontmatter or missing `name`/`description` land in `skipped`, not fatal. |
  | `check --text "<value>"` | Dynamically imports `checkAgentDescription` from `lib/validate/agent-description.mjs` and re-uses it directly (no duplicated standard) → `{ok, violations}`. |
  | `table --root <dir>` | Parses the root CLAUDE.md's `## Workflow & Agents` section (same heading `agentsWorkflowBlock()` emits, same per-row shape: agent name in backticks, then its when-to-use text, pipe-delimited) into `{fileExists, sectionExists, rows: [{name, whenToUse, line}]}`. New parsing logic — no existing table-row parser to reuse (the engine only ever renders this table, never reads it back). |
  | `grep --root <dir> --name <agent>` | Walks every CLAUDE.md in the project (root + nested) via dynamic import of `collectFiles` (`lib/util/fs.mjs`, which already applies `IGNORE_DIRS` — the canonical exclude list, superseding the hand-copied list this doc originally proposed) for the literal agent name outside the table → `{matches: [{file, line, text}]}`. |

  The script never writes. Same split as `doctor`/`patch`/`condense-harness-prompts`: script
  reports, Claude edits after consent.

### Phase 1 — Audit + fix agent frontmatter

For each agent from `list`:

1. Run `check` on its `description`.
2. If it fails: read the agent file body to understand its real role, and author an upgraded
   one-line description meeting the standard (condition-shaped, "Use proactively" + explicit
   triggers, one line, 40–600 chars) — same authoring step as `revise-agent-frontmatter` Step 2,
   minus the catalog-map step (a foreign project's agents have no canonical map; the fix goes
   straight into the file).
3. Show diff, get consent, `Edit` the agent's frontmatter directly.
4. Track the **final** description (fixed, or original if it already passed) in memory for that
   agent — no need to re-run `list`. Phase 2 uses this value as the source of truth.

### Phase 2 — Map CLAUDE.md coverage

For every agent (using its Phase-1-final description):

1. Run `table --root <dir>` once (root CLAUDE.md).
2. If the agent has a row: compare the row's when-to-use cell against the final description with
   **exact string match** (normalized for whitespace) — not a fuzzy/paraphrase comparison.
   `agentsWorkflowBlock()` renders `whenToUse` verbatim into the cell, and
   `revise-agent-frontmatter`'s own map is documented as "the canonical description that fills
   BOTH the agent's frontmatter AND the generated CLAUDE.md routing table" — so in a
   correctly-synced project the two strings are identical by construction, and any difference is
   real drift. Equal → `ok`. Different → `stale-description`.
3. If the agent has **no** row: run `grep --root <dir> --name <agent>`.
   - Found outside the table, but Claude's read of the surrounding `context` snippet shows no
     explanatory clause near the name (best-effort judgment call, not a regex — this is the
     accepted trade-off of the textual-fallback path) → `name-only`.
   - Not found anywhere → `orphan`.

Present the full findings table before any writes (same gate as `doctor` step 4 and
`revise-claude-md` Phase 1 Step 4):

```text
Agent            Found in                     Verdict
`db-migrator`    CLAUDE.md:47 (table)         stale-description
`api-tester`     CLAUDE.md:112 (prose)        name-only
`legacy-runner`  —                            orphan
`code-reviewer`  CLAUDE.md:44 (table)         ok
```

### Phase 3 — Apply, one finding at a time, diff + consent

- **`stale-description`** → regenerate just that row (`` | `name` | finalDescription | ``), same
  shape `agentsWorkflowBlock()` produces. `Edit` targets only that single line.
- **`name-only`** → minimal inline edit next to the existing mention (append/adjust a clause) —
  never rewrite the surrounding paragraph or file.
- **`orphan`** → `AskUserQuestion`: insert a new row into `## Workflow & Agents`? If the root
  CLAUDE.md has no such section yet, offer to create it using the exact
  `agentsWorkflowBlock()` header/shape (`## Workflow & Agents` heading + intro line +
  `| Agent | When to use |` + separator + rows), so it matches what `apply`-generated projects
  look like. **Explicitly out of scope:** the "Superpowers → Project Specialists" bridge
  sub-block — that requires `routingRole()` classification aia-harness only knows for its own
  catalogued agent names; a foreign/hand-written agent has no role to classify, so the bridge is
  never synthesized here, structured-table or freshly-created. Declined → stays reported only.

### Phase 4 — Report

```text
Agents audited: N
Descriptions fixed: M
CLAUDE.md rows fixed: K
Orphans found: J (added: A, left as-is: J-A)
Skipped (unparsable frontmatter): S
```

### Error handling

- No `.claude/agents/` → report "nothing to audit", stop.
- No CLAUDE.md anywhere in the project → run Phase 1 only; tell the user Phase 2/3 were skipped
  and why.
- Unparsable agent frontmatter → skip that file with a warning in the final report, continue with
  the rest (matches `condense.mjs`'s "type not recognized → skipped" behavior).

### Testing

No `tests/*.test.mjs` precedent exists for `skills/*/lib/*.mjs` scripts — `condense.mjs` has none
either; that suite covers the engine `lib/` and hooks only. This script follows the same
precedent: validated manually against a scratch fixture during implementation. `node --test`
coverage can be added later if stronger CI guarantees are wanted.

### Changes to existing files

#### `commands/help.md`

Add a row to the "Where to start" decision table and a
`### /aia-harness:revise-agent-routing [path]` detail block, mirroring the `revise-claude-md`
entry's format exactly. Note: this table isn't fully exhaustive today —
`condense-harness-prompts`, `add-github-pm`, and `check-deps` aren't listed either — so this
addition is a nice-to-have, not a hard requirement, but cheap enough to include.

## What does NOT change

- `scan → plan → apply` pipeline and artifact catalogs (`lib/data/*-catalog.mjs`) — untouched.
- `revise-agent-frontmatter` — untouched, still owns aia-harness's own `templates/` candidate
  agents.
- `doctor` / `patch` / `init` flows — untouched in v1. `doctor`'s existing "agents" drift check
  (step 3a) is orthogonal (plan-known artifacts only) and stays as-is. A future pointer from
  `doctor` to this new command (the same way it already points to `revise-claude-md` for stub
  duplication) is a natural follow-up, not built here.
- This skill is plugin-level only — not vendored into `templates/skills/`, not registered in
  `lib/data/project-catalog.mjs` (verified no sibling maintenance skill is either).

## Quality bar (acceptance criteria)

A run is correct if:

1. Every `.claude/agents/*.md` description that fails `checkAgentDescription`'s 5 rules is either
   fixed (with consent) or left with a reported violation — never silently ignored.
2. No write happens without a shown diff and explicit approval for that specific finding.
3. A `stale-description` fix never touches any table row other than the one for that agent.
4. A `name-only` fix never rewrites more than the minimal clause needed near the existing mention.
5. An `orphan` is never silently added — always gated by `AskUserQuestion`.
6. Re-running the command on an already-clean project reports zero findings (idempotent).
