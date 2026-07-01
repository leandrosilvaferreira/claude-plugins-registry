# Agent-Routing Drift Detection Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Make `/doctor`, `/scan`, and `/patch` detect already-configured projects whose installed agents carry outdated routing descriptions OR whose root CLAUDE.md lacks the superpowers bridge, and offer to re-apply.

**Architecture:** A dry-run `apply` already compares each planned artifact to the on-disk file; expose that drift structurally as `result.differs[]` so the commands can group it by category and offer a force re-apply. The bridge is detected separately via a stable marker comment (whole-file CLAUDE.md drift is unreliable because enrichment always makes it differ).

**Tech Stack:** Node ≥18, pure ESM `.mjs`, JSDoc + `tsc --checkJs`, `node --test`. Commands are markdown that shell out to `bin/aia-harness`.

## Global Constraints

- All source code English. One line.
- `.mjs` ESM + JSDoc, no build step. One line.
- `lib/` pure; IO at edges. One line.
- Engine changes are additive and backward-compatible (existing `created`/`updated`/`skipped`/`errors` unchanged). One line.
- `npm run typecheck && npm run lint && npm test` clean/green before any task is complete. One line.

---

## Task 1: Engine — bridge marker + structured `differs[]`

**Files:**
- Modify: `lib/generate/claude-md.mjs` (add + emit `AGENT_ROUTING_MARKER`)
- Modify: `lib/apply.mjs` (add `result.differs[]`)
- Modify: `tests/claude-md.test.mjs` (assert marker)
- Test: `tests/apply-differs.test.mjs` (new)

**Interfaces:**
- Produces:
  - `AGENT_ROUTING_MARKER` (exported string) = `<!-- aia-harness:agent-routing — superpowers→specialist bridge; do not remove -->`, emitted inside the bridge subsection.
  - `applyPlan(...)` result gains `differs: { id: string, relPath: string, category: string }[]` — one entry per artifact that exists, is not force-written, and differs from canonical (the "exists, differs — left unchanged" case).

- [ ] **Step 1: Marker test (claude-md)**

In `tests/claude-md.test.mjs` add:

```js
import { agentsWorkflowBlock, AGENT_ROUTING_MARKER } from "../lib/generate/claude-md.mjs";

test("bridge subsection carries the agent-routing marker", () => {
  const md = agentsWorkflowBlock([
    { name: "backend-specialist", whenToUse: "API logic. Use proactively." },
  ]);
  assert.ok(AGENT_ROUTING_MARKER.length > 0);
  assert.ok(md.includes(AGENT_ROUTING_MARKER));
});

test("no agents → no marker (and empty block)", () => {
  assert.equal(agentsWorkflowBlock([]), "");
});
```

- [ ] **Step 2: Run → fail**

Run: `node --test tests/claude-md.test.mjs`
Expected: FAIL — `AGENT_ROUTING_MARKER` is not exported.

- [ ] **Step 3: Add + emit the marker**

In `lib/generate/claude-md.mjs`, near the other markers, add:

```js
/**
 * Marker comment placed in the superpowers-bridge subsection so `/doctor` and
 * `/scan` can detect a root CLAUDE.md that predates the bridge (whole-file drift
 * is unreliable — enrichment always makes CLAUDE.md differ).
 */
export const AGENT_ROUTING_MARKER =
  "<!-- aia-harness:agent-routing — superpowers→specialist bridge; do not remove -->";
```

In `agentsWorkflowBlock`, emit it on the line directly under the bridge heading. Change the bridge template's opening from:

```js
    ? `
### Superpowers → Project Specialists (mandatory bridging)

Superpowers skills (\`dispatching-parallel-agents\`, ...
```

to:

```js
    ? `
### Superpowers → Project Specialists (mandatory bridging)
${AGENT_ROUTING_MARKER}

Superpowers skills (\`dispatching-parallel-agents\`, ...
```

- [ ] **Step 4: Run → pass**

Run: `node --test tests/claude-md.test.mjs`
Expected: PASS.

- [ ] **Step 5: differs test (new file)**

Create `tests/apply-differs.test.mjs`:

```js
/**
 * applyPlan exposes structured drift: artifacts that exist but differ from
 * canonical (and are not force-written) appear in result.differs with id +
 * category, so /doctor and /scan can group + offer re-apply.
 *
 * Run: node --test tests/apply-differs.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { applyPlan } from "../lib/apply.mjs";

function mkPlan(relPath, content, id, category) {
  // defaultSelected:true so applyPlan processes it without an explicit `selected` set
  // (apply.mjs skips artifacts that are neither selected nor defaultSelected).
  return {
    artifacts: [{ id, relPath, content, category, exists: true, defaultSelected: true }],
    gitignore: [],
  };
}

test("differs lists an existing file whose content differs (no force)", () => {
  const root = mkdtempSync(path.join(tmpdir(), "aia-differs-"));
  try {
    const rel = ".claude/agents/foo.md";
    mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
    writeFileSync(path.join(root, rel), "OLD CONTENT");
    const plan = mkPlan(rel, "NEW CONTENT", "ecc-agent:foo", "agents");
    const result = applyPlan(plan, root, { dryRun: true });
    assert.ok(Array.isArray(result.differs));
    assert.equal(result.differs.length, 1);
    assert.deepEqual(result.differs[0], { id: "ecc-agent:foo", relPath: rel, category: "agents" });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("identical file does not appear in differs", () => {
  const root = mkdtempSync(path.join(tmpdir(), "aia-differs-"));
  try {
    const rel = ".claude/agents/foo.md";
    mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
    writeFileSync(path.join(root, rel), "SAME");
    const plan = mkPlan(rel, "SAME", "ecc-agent:foo", "agents");
    const result = applyPlan(plan, root, { dryRun: true });
    assert.equal(result.differs.length, 0);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
```

(Confirm the `applyPlan` import name + options shape against `lib/apply.mjs` before running; adjust the plan object keys if the real `Artifact`/`HarnessPlan` shape needs more fields — keep the test minimal but valid.)

- [ ] **Step 6: Run → fail**

Run: `node --test tests/apply-differs.test.mjs`
Expected: FAIL — `result.differs` is undefined.

- [ ] **Step 7: Implement `differs[]`**

In `lib/apply.mjs`: initialize `differs: []` on the result object (next to `created`/`updated`/`skipped`/`errors`). In the branch that currently does
`result.skipped.push(\`${a.relPath} (exists, differs — left unchanged)\`)`, add immediately before it:

```js
result.differs.push({ id: a.id, relPath: a.relPath, category: a.category });
```

Update the result JSDoc typedef to include `differs`.

- [ ] **Step 8: Run → pass + full suite**

Run: `node --test tests/apply-differs.test.mjs && npm run typecheck && npm run lint && npm test`
Expected: new tests pass; full suite green (existing apply/plan tests unaffected — `differs` is additive).

- [ ] **Step 9: Commit**

```bash
git add lib/generate/claude-md.mjs lib/apply.mjs tests/claude-md.test.mjs tests/apply-differs.test.mjs
git commit -m "feat(engine): agent-routing marker + structured apply differs[] for drift detection"
```

---

## Task 2: `/doctor` — detect stale agents + missing bridge, offer re-apply

**Files:**
- Modify: `commands/doctor.md`

**Interfaces:**
- Consumes: dry-run `apply --json` → `differs[]` (Task 1); `AGENT_ROUTING_MARKER` text in the root CLAUDE.md.

- [ ] **Step 1: Add a drift step to doctor.md**

Insert a new sub-section in the audit (after step 2 "Completeness", before/within step 3) titled **"Outdated artifacts (content drift)"**:

```markdown
3a. **Outdated artifacts — installed but differing from the current plugin version.**
    Step 2 finds *missing* artifacts; this finds *stale* ones (present but out of date,
    e.g. agents whose routing descriptions predate the best-practice update). Run a
    dry-run apply and read the structured drift list:

    ```bash
    "${CLAUDE_PLUGIN_ROOT}/bin/aia-harness" apply "${1:-$CLAUDE_PROJECT_DIR}" --json
    ```

    Parse `differs[]` (each `{ id, relPath, category }`). Group by `category`. For each
    category with entries, report the count + sample `relPath`s. Of particular note:
    - **`agents`** — installed agent files whose descriptions differ. Re-applying gives
      the best-practice, condition-shaped "Use proactively" routing descriptions that the
      native router and the CLAUDE.md table depend on.

    Use `AskUserQuestion` (multi-select, grouped by category) to let the user pick which
    categories to refresh. For each chosen category, collect its `differs[].id`s and
    force-overwrite ONLY those:

    ```bash
    "${CLAUDE_PLUGIN_ROOT}/bin/aia-harness" apply "${1:-$CLAUDE_PROJECT_DIR}" \
      --yes --force --only=<comma-joined ids>
    ```

    `--force` is required (these files exist and differ). Files outside the selected ids
    are untouched. If the user prefers, point them at `/aia-harness:patch` for the same
    by-category force-overwrite.
```

- [ ] **Step 2: Add the bridge-marker check to doctor.md**

Add a bullet to step 3's audit list (near the "Behavioral guidelines intact" bullet, same pattern):

```markdown
   - **Superpowers agent-routing bridge (when agents are installed):** if the plan
     includes any `agents` artifact, grep the root `CLAUDE.md` for the marker
     `aia-harness:agent-routing`. If absent, the file predates the superpowers→specialist
     bridge (the section that tells Claude to dispatch project specialists instead of
     `general-purpose`). Offer to regenerate the root file:

     ```bash
     "${CLAUDE_PLUGIN_ROOT}/bin/aia-harness" apply "${1:-$CLAUDE_PROJECT_DIR}" \
       --yes --force --only=claude-md-root
     ```

     Warn (as with the behavioral block) that `--force` overwrites the root `CLAUDE.md`,
     so the enriched `## Conventions` / `## Architecture map` must be re-enriched after
     (run the enrichment pass from `/aia-harness:init` step 5.5). If the marker is present,
     the bridge is current — say nothing.
```

- [ ] **Step 3: Verify the command file is coherent**

Run: `npm test` (doctor.md is not executed by the suite; this confirms no engine regression).
Manually re-read the two inserted blocks for correct bash + flag usage (`--force --only`, dry-run apply has no `--yes`).

- [ ] **Step 4: Commit**

```bash
git add commands/doctor.md
git commit -m "feat(doctor): detect stale agents (differs) + missing superpowers bridge, offer re-apply"
```

---

## Task 3: `/scan` drift note + `/patch` label clarity

**Files:**
- Modify: `commands/scan.md`
- Modify: `commands/patch.md`

- [ ] **Step 1: Add a drift summary to scan.md**

After the scan report is presented, add a step: if the project already has a harness
(`profile.existing` shows agents/CLAUDE.md present), run a dry-run apply and summarize drift:

```markdown
## Harness drift (only if already configured)

If the project already has the harness installed, run a dry-run apply and read `differs[]`:

```bash
"${CLAUDE_PLUGIN_ROOT}/bin/aia-harness" apply "${1:-$CLAUDE_PROJECT_DIR}" --json
```

If `differs[]` is non-empty, print one line per category: "N <category> artifact(s) are
out of date vs the current plugin version." Also grep the root `CLAUDE.md` for
`aia-harness:agent-routing`; if absent while `agents` exist, note the superpowers bridge
is missing. Point the user to `/aia-harness:doctor` (guided fixes) or `/aia-harness:patch`
(by-category force-overwrite). Do not modify anything — scan is read-only.
```

- [ ] **Step 2: Clarify patch.md category labels**

In `commands/patch.md`, in the category table, expand the descriptions for the two
categories that carry the new content so the user knows what re-applying delivers:

- `agents` → note it installs the best-practice, condition-shaped routing descriptions
  ("Use proactively" + triggers) the native router and CLAUDE.md table use.
- `claude-md` → note the root file carries the dynamic "Superpowers → Project Specialists"
  bridge built from the installed agents.

Keep it to a short parenthetical per row; do not restructure the table.

- [ ] **Step 3: Verify + commit**

Run: `npm test` (confirms no engine regression; command files aren't executed by the suite).

```bash
git add commands/scan.md commands/patch.md
git commit -m "feat(scan,patch): surface agent-routing drift + clarify re-apply categories"
```

---

## Self-Review

**Coverage:** agents drift → `differs[]` (Task 1) consumed by doctor (Task 2) + scan (Task 3); bridge missing → marker (Task 1) grepped by doctor (Task 2) + scan (Task 3); re-apply path → `apply --force --only` (doctor) / `/patch` by category (already exists, label-clarified in Task 3). ✅

**Placeholder scan:** none — every step has concrete code/bash.

**Type consistency:** `differs` entry shape `{ id, relPath, category }` defined in Task 1, consumed identically in B + C. `AGENT_ROUTING_MARKER` defined in Task 1, grepped (by its literal substring `aia-harness:agent-routing`) in B + C.

**Risks for the implementer:**
- Task 1 Step 5: confirm `applyPlan`'s real signature + `HarnessPlan`/`Artifact` required fields; the test's minimal plan object may need an extra field (e.g. `title`) — keep it valid, do not weaken the assertion.
- The dry-run apply must NOT pass `--yes` (so nothing is written) — both doctor and scan rely on that.
- `claude-md-root` is the artifact id for the root CLAUDE.md (used by the existing behavioral-marker fix in doctor.md — reuse the same id).
