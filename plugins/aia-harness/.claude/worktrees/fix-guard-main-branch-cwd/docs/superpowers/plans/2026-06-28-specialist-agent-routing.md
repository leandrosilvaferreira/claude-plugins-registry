# Specialist-Agent Routing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make scaffolded harnesses reliably dispatch to specialist agents (not generic/superpowers-generic) by upgrading every candidate agent's routing description across both routing surfaces, durably across re-vendoring, and emitting a dynamic superpowers-bridge in the generated CLAUDE.md.

**Architecture:** The three `*_AGENT_WHEN_TO_USE` maps (our code) become the single source of truth for each agent's best-practice description. One neutral folded-scalar frontmatter helper lets the same logical string render folded into agent frontmatter (native router) and flat into the CLAUDE.md table (explicit routing). Vendored frontmatter stays in sync via the ecc/agkit transforms; a local script refreshes files without a network sync. A unit-test gate enforces compliance; a local skill authors/maintains the descriptions.

**Tech Stack:** Node ≥18, pure ESM `.mjs`, JSDoc + `tsc --checkJs`, `node --test`, ESLint flat config.

## Global Constraints

- All source code in English (engine + templates + generated content). One line.
- All source is `.mjs` ESM with JSDoc types — no `.ts`, no build step. One line.
- `lib/` is pure (no IO); IO lives in `bin/`, `scripts/`, `detect`, `apply`. One line.
- Asset-catalog maintenance: a new candidate agent must be registered in its provenance catalog AND have a compliant description map entry (enforced by the new integrity test). One line.
- Hooks/scripts cross-platform: `.mjs` run via `node`; `path.join`/`os` for paths; `windowsHide:true` on spawn. One line.
- `templates/` is excluded from lint/typecheck. One line.
- Run `npm run typecheck && npm run lint && npm test` before declaring any task complete. One line.

---

## File Structure

### New files

- `lib/util/frontmatter-yaml.mjs` — neutral folded-scalar-aware frontmatter parse/render (pure).
- `lib/validate/agent-description.mjs` — `checkAgentDescription` + `applyCanonicalDescription` + `resolveCanonicalDescription` (pure).
- `scripts/apply-agent-descriptions.mjs` — IO script: map → all agent files (idempotent local refresh).
- `tests/frontmatter-yaml.test.mjs` — round-trip + folded tests.
- `tests/agent-description.test.mjs` — checker + apply tests.
- `tests/agent-frontmatter-standard.test.mjs` — integrity gate (runs under `npm test`).
- `skills/revise-agent-frontmatter/SKILL.md` — local authoring/maintenance skill (NOT distributed).
- `.claude/rules/agent-frontmatter-standard.md` — repo path-scoped enforcement reminder.

### Modified files

- `lib/agkit/transform.mjs` — `parseFrontmatter`/`renderFrontmatter` delegate to the neutral helper; `cleanAgentMarkdown` calls `applyCanonicalDescription`.
- `lib/ecc/transform.mjs` — `cleanAgentMarkdown` parses→applies canonical description→renders folded.
- `lib/data/ecc-catalog.mjs` — `ECC_AGENT_WHEN_TO_USE` upgraded to best-practice descriptions.
- `lib/data/agkit-catalog.mjs` — `AGKIT_AGENT_WHEN_TO_USE` upgraded.
- `lib/data/project-catalog.mjs` — `PROJECT_AGENT_WHEN_TO_USE` upgraded.
- `lib/data/asset-catalog.mjs` — add `resolveCanonicalDescription`; `resolveAgentWhenToUse` delegates to it.
- `lib/generate/claude-md.mjs` — `routingRole` classifier + bridge subsection in `agentsWorkflowBlock`.
- `templates/rules/07-subagent-dispatch.md` — point at the bridge subsection (no table duplication).
- `CLAUDE.md` (repo) — one maintenance line linking the agent-description standard.

---

## Task 1: Neutral folded-scalar frontmatter helper

**Files:**
- Create: `lib/util/frontmatter-yaml.mjs`
- Test: `tests/frontmatter-yaml.test.mjs`

**Interfaces:**
- Produces:
  - `parseFrontmatter(frontmatter: string) → { key: string, value: string }[]` — single-line entries AND `key: >` folded blocks (continuation lines folded to one logical value with spaces).
  - `renderFrontmatter(entries: { key: string, value: string }[], opts?: { fold?: Set<string>, width?: number }) → string` — emits `--- … ---\n`; keys in `opts.fold` whose value exceeds `width` (default 72) are emitted as folded blocks; others single-line, quoted when needed.
  - `quoteIfNeeded(value: string) → string`

- [ ] **Step 1: Write the failing test**

```js
// tests/frontmatter-yaml.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { parseFrontmatter, renderFrontmatter } from "../lib/util/frontmatter-yaml.mjs";

test("parses single-line entries", () => {
  const fm = "---\nname: foo\nmodel: sonnet\n---\n";
  assert.deepEqual(parseFrontmatter(fm), [
    { key: "name", value: "foo" },
    { key: "model", value: "sonnet" },
  ]);
});

test("folds a `key: >` block into one logical value", () => {
  const fm = "---\nname: foo\ndescription: >\n  Line one\n  line two\nmodel: sonnet\n---\n";
  const entries = parseFrontmatter(fm);
  assert.equal(entries.find((e) => e.key === "description").value, "Line one line two");
  assert.equal(entries.find((e) => e.key === "model").value, "sonnet");
});

test("round-trips the logical value through render→parse", () => {
  const value =
    "Reviews NestJS controllers and services for architecture, DB, and validation drift. Use proactively after editing any NestJS HTTP or persistence file.";
  const rendered = renderFrontmatter(
    [
      { key: "name", value: "nestjs-code-reviewer" },
      { key: "description", value },
      { key: "model", value: "sonnet" },
    ],
    { fold: new Set(["description"]) },
  );
  assert.match(rendered, /description: >\n {2}/); // folded block emitted
  const back = parseFrontmatter(rendered);
  assert.equal(back.find((e) => e.key === "description").value, value);
});

test("single-line short value is not folded", () => {
  const rendered = renderFrontmatter([{ key: "name", value: "x" }], { fold: new Set(["name"]) });
  assert.match(rendered, /^---\nname: x\n---\n$/);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/frontmatter-yaml.test.mjs`
Expected: FAIL — `Cannot find module '../lib/util/frontmatter-yaml.mjs'`.

- [ ] **Step 3: Write the implementation**

```js
// lib/util/frontmatter-yaml.mjs
/**
 * Neutral, folded-scalar-aware flat-YAML frontmatter parse/render. Pure — no IO.
 * Shared by the ecc/agkit transforms, the agent-description propagation, the
 * checker, and the integrity test so there is ONE folded implementation.
 *
 * Supports: one `key: value` per line, and `key: >` folded blocks whose
 * indented continuation lines fold (newlines → spaces) into one logical value.
 *
 * @module util/frontmatter-yaml
 */

/** @param {string} v @returns {boolean} */
function needsQuote(v) {
  return /:\s/.test(v) || /^[\s"'#&*!|>%@`]/.test(v) || v.includes('"');
}

/** @param {string} v @returns {string} */
export function quoteIfNeeded(v) {
  return needsQuote(v) ? `"${v.replace(/"/g, '\\"')}"` : v;
}

/**
 * @param {string} frontmatter  Block including --- fences.
 * @returns {{ key: string, value: string }[]}
 */
export function parseFrontmatter(frontmatter) {
  /** @type {{ key: string, value: string }[]} */
  const entries = [];
  const lines = frontmatter.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line === "---" || line.trim() === "") continue;
    const folded = line.match(/^([A-Za-z0-9_-]+):\s*>\s*$/);
    if (folded) {
      /** @type {string[]} */
      const parts = [];
      while (i + 1 < lines.length && /^\s{2,}\S/.test(lines[i + 1])) {
        parts.push(lines[i + 1].trim());
        i++;
      }
      entries.push({ key: folded[1], value: parts.join(" ") });
      continue;
    }
    const m = line.match(/^([A-Za-z0-9_-]+):\s?(.*)$/);
    if (m) entries.push({ key: m[1], value: m[2] });
  }
  return entries;
}

/**
 * @param {string} value
 * @param {number} width
 * @returns {string}  Indented folded body (2-space indent, wrapped at width).
 */
function foldBody(value, width) {
  const words = value.split(/\s+/).filter(Boolean);
  /** @type {string[]} */
  const out = [];
  let line = "";
  for (const w of words) {
    if (line && (line.length + 1 + w.length) > width) {
      out.push(line);
      line = w;
    } else {
      line = line ? `${line} ${w}` : w;
    }
  }
  if (line) out.push(line);
  return out.map((l) => `  ${l}`).join("\n");
}

/**
 * @param {{ key: string, value: string }[]} entries
 * @param {{ fold?: Set<string>, width?: number }} [opts]
 * @returns {string}  Frontmatter block including --- fences and trailing newline.
 */
export function renderFrontmatter(entries, opts = {}) {
  const fold = opts.fold ?? new Set();
  const width = opts.width ?? 72;
  const body = entries
    .map((e) => {
      if (fold.has(e.key) && e.value.length > width) {
        return `${e.key}: >\n${foldBody(e.value, width)}`;
      }
      return `${e.key}: ${quoteIfNeeded(e.value)}`;
    })
    .join("\n");
  return `---\n${body}\n---\n`;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/frontmatter-yaml.test.mjs`
Expected: PASS (4 tests).

- [ ] **Step 5: Typecheck + lint**

Run: `npm run typecheck && npm run lint`
Expected: clean.

- [ ] **Step 6: Commit**

```bash
git add lib/util/frontmatter-yaml.mjs tests/frontmatter-yaml.test.mjs
git commit -m "feat(frontmatter): neutral folded-scalar-aware parse/render helper"
```

---

## Task 2: Canonical description resolver + checker + applier

**Files:**
- Create: `lib/validate/agent-description.mjs`
- Modify: `lib/data/asset-catalog.mjs` (add `resolveCanonicalDescription`, delegate `resolveAgentWhenToUse`)
- Test: `tests/agent-description.test.mjs`

**Interfaces:**
- Consumes: the three `*_AGENT_WHEN_TO_USE` maps via `asset-catalog.mjs`; `parseFrontmatter`/`renderFrontmatter` from Task 1.
- Produces:
  - `resolveCanonicalDescription(name: string) → string | null` (in `asset-catalog.mjs`) — ECC ?? agkit ?? project map, else `null`.
  - `checkAgentDescription(value: string) → { ok: boolean, violations: string[] }`
  - `applyCanonicalDescription(entries: {key,value}[], name: string) → {key,value}[]` — replaces/inserts the `description` entry from the canonical map; no-op when the map has no entry.

- [ ] **Step 1: Add `resolveCanonicalDescription` to `asset-catalog.mjs`**

In `lib/data/asset-catalog.mjs`, replace the existing `resolveAgentWhenToUse` function with:

```js
/**
 * Canonical best-practice description for an agent, or null if not catalogued.
 * Single source of truth for BOTH the native-router frontmatter and the
 * CLAUDE.md routing table.
 * @param {string} name
 * @returns {string | null}
 */
export function resolveCanonicalDescription(name) {
  return (
    ECC_AGENT_WHEN_TO_USE[name] ??
    AGKIT_AGENT_WHEN_TO_USE[name] ??
    PROJECT_AGENT_WHEN_TO_USE[name] ??
    null
  );
}

/**
 * Resolve a "when to use" label for the CLAUDE.md table; falls back to the bare
 * name if the agent is not catalogued.
 * @param {string} name
 * @returns {string}
 */
export function resolveAgentWhenToUse(name) {
  return resolveCanonicalDescription(name) ?? name;
}
```

- [ ] **Step 2: Write the failing test**

```js
// tests/agent-description.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  checkAgentDescription,
  applyCanonicalDescription,
} from "../lib/validate/agent-description.mjs";
import { resolveCanonicalDescription } from "../lib/data/asset-catalog.mjs";

test("checker rejects a capability-shaped description (no trigger signal)", () => {
  const r = checkAgentDescription("Expert code review specialist for the project.");
  assert.equal(r.ok, false);
  assert.ok(r.violations.some((v) => /trigger|proactiv/i.test(v)));
});

test("checker accepts a condition-shaped description with a proactivity signal", () => {
  const r = checkAgentDescription(
    "Reviews code for security and correctness. Use proactively after editing any source file.",
  );
  assert.deepEqual(r, { ok: true, violations: [] });
});

test("checker rejects a raw pipe (breaks the markdown table)", () => {
  const r = checkAgentDescription("Use proactively when editing files | always.");
  assert.equal(r.ok, false);
  assert.ok(r.violations.some((v) => /pipe|\|/.test(v)));
});

test("applyCanonicalDescription replaces description from the map", () => {
  const name = "code-reviewer";
  const canonical = resolveCanonicalDescription(name);
  assert.ok(canonical, "code-reviewer must be catalogued");
  const out = applyCanonicalDescription(
    [
      { key: "name", value: name },
      { key: "description", value: "stale" },
      { key: "model", value: "sonnet" },
    ],
    name,
  );
  assert.equal(out.find((e) => e.key === "description").value, canonical);
});

test("applyCanonicalDescription is a no-op for an unknown agent", () => {
  const entries = [{ key: "name", value: "nope" }, { key: "description", value: "keep" }];
  assert.deepEqual(applyCanonicalDescription(entries, "nope"), entries);
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `node --test tests/agent-description.test.mjs`
Expected: FAIL — `Cannot find module '../lib/validate/agent-description.mjs'`.

- [ ] **Step 4: Write the implementation**

```js
// lib/validate/agent-description.mjs
/**
 * Standard for agent routing descriptions + helpers to apply the canonical
 * description from the catalog maps onto parsed frontmatter entries. Pure — no IO.
 *
 * @module validate/agent-description
 */
import { resolveCanonicalDescription } from "../data/asset-catalog.mjs";

const MIN_LEN = 40;
const MAX_LEN = 600;
/** Signals that a description tells Claude WHEN to use the agent. */
const TRIGGER_RE = /\b(use proactively|MUST BE USED|use (this )?(agent )?(when|after|before|for)|proactively|when |after |before )/i;

/**
 * Validate one routing description against the best-practice standard.
 * @param {string} value
 * @returns {{ ok: boolean, violations: string[] }}
 */
export function checkAgentDescription(value) {
  /** @type {string[]} */
  const violations = [];
  const v = (value ?? "").trim();
  if (v.length < MIN_LEN) violations.push(`too short (<${MIN_LEN} chars) — describe when to use it`);
  if (v.length > MAX_LEN) violations.push(`too long (>${MAX_LEN} chars)`);
  if (v.includes("|")) violations.push("contains a raw pipe `|` — breaks the CLAUDE.md table");
  if (v.includes("\n")) violations.push("contains a newline — must fold to one logical line");
  if (!TRIGGER_RE.test(v))
    violations.push('missing a trigger signal — add "Use proactively" + when/after/before conditions');
  return { ok: violations.length === 0, violations };
}

/**
 * Replace/insert the `description` entry from the canonical map. No-op when the
 * agent is not catalogued (so an unknown agent is never clobbered with junk).
 * @param {{ key: string, value: string }[]} entries
 * @param {string} name
 * @returns {{ key: string, value: string }[]}
 */
export function applyCanonicalDescription(entries, name) {
  const canonical = resolveCanonicalDescription(name);
  if (!canonical) return entries;
  const i = entries.findIndex((e) => e.key === "description");
  if (i >= 0) entries[i] = { key: "description", value: canonical };
  else {
    const after = entries.findIndex((e) => e.key === "name");
    entries.splice(after >= 0 ? after + 1 : 0, 0, { key: "description", value: canonical });
  }
  return entries;
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `node --test tests/agent-description.test.mjs`
Expected: PASS (5 tests). (The `code-reviewer` test passes because the map already has an entry; Task 9 upgrades its prose.)

- [ ] **Step 6: Typecheck + lint + commit**

```bash
npm run typecheck && npm run lint
git add lib/validate/agent-description.mjs lib/data/asset-catalog.mjs tests/agent-description.test.mjs
git commit -m "feat(agents): canonical description resolver, checker, and applier"
```

---

## Task 3: Inject canonical description in transforms + local refresh script

**Files:**
- Modify: `lib/agkit/transform.mjs` (delegate parse/render to neutral helper; call applier in `cleanAgentMarkdown`)
- Modify: `lib/ecc/transform.mjs` (parse→apply→render folded in `cleanAgentMarkdown`)
- Create: `scripts/apply-agent-descriptions.mjs`
- Test: extend `tests/agkit-transform.test.mjs` and `tests/ecc-transform.test.mjs`

**Interfaces:**
- Consumes: `parseFrontmatter`/`renderFrontmatter` (Task 1), `applyCanonicalDescription` (Task 2), `splitFrontmatter` (existing ecc).
- Produces: vendored agent frontmatter carries the canonical folded description after sync; `node scripts/apply-agent-descriptions.mjs` refreshes all agent files in place from the maps.

- [ ] **Step 1: Point agkit parse/render at the neutral helper**

In `lib/agkit/transform.mjs`, replace the local `parseFrontmatter`/`renderFrontmatter`/`quoteIfNeeded`/`needsQuote` definitions with a re-export and import (keeps existing import sites working):

```js
import { splitFrontmatter } from "../ecc/transform.mjs";
import { normalizeToolsValue } from "../validate/frontmatter.mjs";
import {
  parseFrontmatter,
  renderFrontmatter,
  quoteIfNeeded,
} from "../util/frontmatter-yaml.mjs";
import { applyCanonicalDescription } from "../validate/agent-description.mjs";

export { parseFrontmatter, renderFrontmatter };
```

`cleanAgentMarkdown` / `cleanSkillMarkdown` inside agkit use `parseFrontmatter`/`renderFrontmatter` internally, so the import is required. The `export { … }` re-export is OPTIONAL (no external module imports those names from agkit — verified: `tests/agkit-transform.test.mjs` imports only `mapAgentTools`, `cleanAgentMarkdown`, `cleanSkillMarkdown`, `cleanCommandMarkdown`, `cleanScript`, `stampMarkdown`); keep it for symmetry or drop it. Keep `unquote` (still used by `cleanSkillMarkdown`). Remove the now-duplicated local `parseFrontmatter`, `renderFrontmatter`, `needsQuote`, `quoteIfNeeded` bodies.

- [ ] **Step 2: Call the applier in agkit `cleanAgentMarkdown`, render description folded**

In `lib/agkit/transform.mjs`, update `cleanAgentMarkdown`:

```js
export function cleanAgentMarkdown(content, meta) {
  const { frontmatter, body } = splitFrontmatter(content);
  let entries = parseFrontmatter(frontmatter).filter(
    (e) => e.key !== "skills" && e.key !== "model",
  );
  for (const e of entries) {
    if (e.key === "tools") e.value = mapAgentTools(e.value);
  }
  const name = entries.find((e) => e.key === "name")?.value ?? "";
  entries = applyCanonicalDescription(entries, name);
  entries.push({ key: "model", value: "sonnet" });
  const fm = renderFrontmatter(entries, { fold: new Set(["description"]) });
  return `${fm}${provenanceComment(meta.sourcePath, meta.commit)}\n${body.replace(/^\n+/, "")}`;
}
```

- [ ] **Step 3: Refactor ecc `cleanAgentMarkdown` to apply the canonical description**

In `lib/ecc/transform.mjs`, add imports at top:

```js
import { parseFrontmatter, renderFrontmatter } from "../util/frontmatter-yaml.mjs";
import { applyCanonicalDescription } from "../validate/agent-description.mjs";
```

Replace the body of `cleanAgentMarkdown` with parse→normalize tools→apply description→render folded:

```js
export function cleanAgentMarkdown(content, meta) {
  const { frontmatter, body } = splitFrontmatter(content);
  let entries = parseFrontmatter(frontmatter);
  for (const e of entries) {
    if (e.key === "tools") {
      e.value = normalizeToolsValue(e.value)
        .split(",")
        .map((t) => t.trim())
        .filter((t) => !t.startsWith("mcp__code-review-graph__"))
        .join(", ");
    }
  }
  const name = entries.find((e) => e.key === "name")?.value ?? "";
  entries = applyCanonicalDescription(entries, name);
  const fm = renderFrontmatter(entries, { fold: new Set(["description"]) });
  let cleaned = removeSection(body, /^##\s+Prompt Defense/i);
  cleaned = removeSection(cleaned, /^##\s+Related/i);
  cleaned = cleaned.replace(/\n{3,}/g, "\n\n").trim();
  return `${fm}${provenanceComment(meta)}\n${cleaned}\n`;
}
```

- [ ] **Step 4: Write failing transform tests**

Add to `tests/agkit-transform.test.mjs`:

```js
test("cleanAgentMarkdown injects the canonical description (folded) for a catalogued agent", () => {
  const src = "---\nname: code-archaeologist\ndescription: old\ntools: Read\n---\nBody\n";
  const out = cleanAgentMarkdown(src, { sourcePath: ".agents/agent/code-archaeologist.md", commit: "abc" });
  const { resolveCanonicalDescription } = require; // see import note
  assert.match(out, /description: >/);
});
```

Because the repo is ESM, import at the top of the test file instead of `require`:

```js
import { resolveCanonicalDescription } from "../lib/data/asset-catalog.mjs";
import { parseFrontmatter } from "../lib/util/frontmatter-yaml.mjs";
```

(Import `parseFrontmatter` from the neutral helper, NOT from `agkit/transform.mjs` — nothing external imports it from agkit, so the agkit re-export is optional.) Assert the folded value round-trips to the canonical string:

```js
test("agkit agent description equals the canonical map value", () => {
  const src = "---\nname: code-archaeologist\ndescription: old\ntools: Read\n---\nBody\n";
  const out = cleanAgentMarkdown(src, { sourcePath: "x", commit: "abc" });
  const desc = parseFrontmatter(out.match(/^---\n[\s\S]*?\n---\n/)[0]).find((e) => e.key === "description").value;
  assert.equal(desc, resolveCanonicalDescription("code-archaeologist"));
});
```

Add the analogous test to `tests/ecc-transform.test.mjs` for `code-reviewer`.

- [ ] **Step 5: Run transform tests to verify they fail, then pass after Steps 1-3**

Run: `node --test tests/agkit-transform.test.mjs tests/ecc-transform.test.mjs`
Expected after Steps 1-3: PASS. (If you wrote tests first, they fail with the old single-line description.)

- [ ] **Step 6: Write the local refresh script**

```js
// scripts/apply-agent-descriptions.mjs
#!/usr/bin/env node
/**
 * Refresh every vendored/first-party agent file's `description` frontmatter from
 * the canonical catalog maps, in place. Idempotent. Lets the maps be the source
 * of truth without a network re-sync (sync:ecc/sync:agkit do the same inline).
 */
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { splitFrontmatter } from "../lib/ecc/transform.mjs";
import { parseFrontmatter, renderFrontmatter } from "../lib/util/frontmatter-yaml.mjs";
import { applyCanonicalDescription } from "../lib/validate/agent-description.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const DIRS = [
  path.join(ROOT, "templates", "ecc", "agents"),
  path.join(ROOT, "templates", "ag-kit", "agents"),
  path.join(ROOT, "templates", "agents"),
];

let changed = 0;
for (const dir of DIRS) {
  let files;
  try {
    files = readdirSync(dir).filter((f) => f.endsWith(".md"));
  } catch {
    continue;
  }
  for (const file of files) {
    const full = path.join(dir, file);
    const content = readFileSync(full, "utf8");
    const { frontmatter, body } = splitFrontmatter(content);
    if (!frontmatter) continue;
    const name = file.replace(/\.md$/, "");
    const entries = applyCanonicalDescription(parseFrontmatter(frontmatter), name);
    const fm = renderFrontmatter(entries, { fold: new Set(["description"]) });
    const next = `${fm}${body}`;
    if (next !== content) {
      writeFileSync(full, next);
      changed += 1;
    }
  }
}
console.log(`apply-agent-descriptions: updated ${changed} file(s).`);
```

- [ ] **Step 7: Run script + full test suite**

Run: `node scripts/apply-agent-descriptions.mjs && npm run typecheck && npm run lint`
Expected: prints updated count; typecheck + lint clean. (Files now carry whatever the maps currently hold; Task 9 upgrades the prose.)

- [ ] **Step 8: Commit**

```bash
git add lib/agkit/transform.mjs lib/ecc/transform.mjs scripts/apply-agent-descriptions.mjs tests/agkit-transform.test.mjs tests/ecc-transform.test.mjs templates/ecc/agents templates/ag-kit/agents templates/agents
git commit -m "feat(agents): inject canonical folded description via transforms + refresh script"
```

---

## Task 4: Integrity gate (unit test)

**Files:**
- Create: `tests/agent-frontmatter-standard.test.mjs`

**Interfaces:**
- Consumes: `resolveCanonicalDescription` (Task 2), `checkAgentDescription` (Task 2), `parseFrontmatter` (Task 1), `validateFrontmatter` (existing), the agent files on disk.
- Produces: `npm test` fails on any missing/non-compliant/drifted/orphaned agent description.

- [ ] **Step 1: Write the test (initially red until Task 9 populates prose)**

```js
// tests/agent-frontmatter-standard.test.mjs
/**
 * Integrity gate: every candidate agent file has a compliant canonical
 * description in its provenance map, the file frontmatter matches it (no drift),
 * and there are no orphan map entries. Mirrors deps-catalog-integrity.test.mjs.
 *
 * Run: node --test tests/agent-frontmatter-standard.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { splitFrontmatter } from "../lib/ecc/transform.mjs";
import { parseFrontmatter } from "../lib/util/frontmatter-yaml.mjs";
import { resolveCanonicalDescription } from "../lib/data/asset-catalog.mjs";
import { checkAgentDescription } from "../lib/validate/agent-description.mjs";
import { validateFrontmatter } from "../lib/validate/frontmatter.mjs";
import {
  ECC_AGENT_WHEN_TO_USE,
  AGKIT_AGENT_WHEN_TO_USE,
  PROJECT_AGENT_WHEN_TO_USE,
} from "../lib/data/asset-catalog.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DIRS = ["templates/ecc/agents", "templates/ag-kit/agents", "templates/agents"];

/** @returns {{ name: string, file: string, content: string }[]} */
function candidateAgents() {
  /** @type {{ name: string, file: string, content: string }[]} */
  const out = [];
  for (const rel of DIRS) {
    const dir = path.join(ROOT, rel);
    let files;
    try {
      files = readdirSync(dir).filter((f) => f.endsWith(".md"));
    } catch {
      continue;
    }
    for (const f of files) {
      out.push({ name: f.replace(/\.md$/, ""), file: path.join(dir, f), content: readFileSync(path.join(dir, f), "utf8") });
    }
  }
  return out;
}

const AGENTS = candidateAgents();

test("every candidate agent has a canonical description in its provenance map", () => {
  for (const a of AGENTS) {
    assert.ok(
      resolveCanonicalDescription(a.name) !== null,
      `no description map entry for agent "${a.name}" — add it to its *_AGENT_WHEN_TO_USE map`,
    );
  }
});

test("every canonical description meets the best-practice standard", () => {
  for (const a of AGENTS) {
    const desc = resolveCanonicalDescription(a.name);
    if (desc === null) continue;
    const { ok, violations } = checkAgentDescription(desc);
    assert.ok(ok, `agent "${a.name}" description violations: ${violations.join("; ")}`);
  }
});

test("agent frontmatter description matches the map (no drift)", () => {
  for (const a of AGENTS) {
    const expected = resolveCanonicalDescription(a.name);
    if (expected === null) continue;
    const { frontmatter } = splitFrontmatter(a.content);
    const actual = parseFrontmatter(frontmatter).find((e) => e.key === "description")?.value;
    assert.equal(
      actual,
      expected,
      `agent "${a.name}" frontmatter drifted from map — run: node scripts/apply-agent-descriptions.mjs`,
    );
  }
});

test("agent frontmatter is schema-valid and name matches filename", () => {
  for (const a of AGENTS) {
    const res = validateFrontmatter(a.content, "agent");
    assert.ok(res.valid, `agent "${a.name}" frontmatter invalid: ${res.errors.join("; ")}`);
    const { frontmatter } = splitFrontmatter(a.content);
    const nameField = parseFrontmatter(frontmatter).find((e) => e.key === "name")?.value;
    assert.equal(nameField, a.name, `agent "${a.name}" name field must match filename`);
  }
});

test("no orphan map entries (every key maps to an agent file)", () => {
  const names = new Set(AGENTS.map((a) => a.name));
  for (const map of [ECC_AGENT_WHEN_TO_USE, AGKIT_AGENT_WHEN_TO_USE, PROJECT_AGENT_WHEN_TO_USE]) {
    for (const key of Object.keys(map)) {
      assert.ok(names.has(key), `orphan description map entry "${key}" — no matching agent file`);
    }
  }
});
```

- [ ] **Step 2: Run to confirm it passes (maps already populated in the prior task)**

Run: `node --test tests/agent-frontmatter-standard.test.mjs`
Expected: PASS — all 5 tests green (entry exists, standard met, no drift, schema-valid, no orphans). The canonical descriptions were authored and propagated in the preceding populate task, so this gate is born green. If any test fails, the failure is a real gap — fix the offending map entry and re-run `node scripts/apply-agent-descriptions.mjs`.

- [ ] **Step 3: Commit**

```bash
git add tests/agent-frontmatter-standard.test.mjs
git commit -m "test(agents): integrity gate for canonical agent descriptions"
```

---

## Task 5: `routingRole` classifier + superpowers bridge in generated CLAUDE.md

**Files:**
- Modify: `lib/generate/claude-md.mjs` (add `routingRole`, enhance `agentsWorkflowBlock`)
- Modify: `templates/rules/07-subagent-dispatch.md` (point at the bridge subsection)
- Test: extend `tests/claude-md.test.mjs` (or create if absent — check first)

**Interfaces:**
- Consumes: `AgentMeta[]` (`{ name, whenToUse }`) already passed to `agentsWorkflowBlock`.
- Produces: a richer `## Workflow & Agents` section with the existing table PLUS a "Superpowers → Project Specialists" bridge built only from installed agents.

- [ ] **Step 1: Write the failing test**

Create `tests/claude-md.test.mjs` (it does not exist yet). Add:

```js
import { agentsWorkflowBlock } from "../lib/generate/claude-md.mjs";

test("agentsWorkflowBlock emits the superpowers bridge only for installed roles", () => {
  const md = agentsWorkflowBlock([
    { name: "backend-specialist", whenToUse: "API and server-side logic. Use proactively." },
    { name: "test-engineer", whenToUse: "Unit/integration tests. Use proactively." },
  ]);
  assert.match(md, /Superpowers/);
  assert.match(md, /never .*general-purpose/i);
  assert.match(md, /backend-specialist/);
  assert.match(md, /test-engineer/);
  // a role with no installed specialist must NOT appear as a row
  assert.doesNotMatch(md, /database-architect/);
});

test("agentsWorkflowBlock returns empty string when no agents", () => {
  assert.equal(agentsWorkflowBlock([]), "");
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `node --test tests/claude-md.test.mjs`
Expected: FAIL — current output has no "Superpowers" bridge / no "never general-purpose" line.

- [ ] **Step 3: Add the `routingRole` classifier**

In `lib/generate/claude-md.mjs`, above `agentsWorkflowBlock`, add:

```js
/**
 * Coarse routing role for an agent name, used to build the superpowers bridge.
 * Returns null for agents that don't map to a generic superpowers role.
 * @param {string} name
 * @returns {{ role: string, superpowersGeneric: string } | null}
 */
export function routingRole(name) {
  if (name.endsWith("-build-resolver")) return { role: "Fix a failing build", superpowersGeneric: "general-purpose" };
  if (name.endsWith("-reviewer")) return { role: "Review / audit changed code", superpowersGeneric: "general-purpose" };
  /** @type {Record<string,string>} */
  const exact = {
    "backend-specialist": "Backend / API / server-side / domain logic",
    "frontend-specialist": "UI / components / styling / pages",
    "database-architect": "Schema / migration / query / data modeling",
    "test-engineer": "Unit / integration tests",
    "qa-automation-engineer": "E2E / QA automation",
    debugger: "Bug / crash / root-cause analysis",
    "explorer-agent": "Explore / map an unfamiliar codebase",
    "code-archaeologist": "Understand legacy code before changing it",
    orchestrator: "Multi-domain feature — subdelegates to specialists",
    "performance-optimizer": "Performance profiling / optimization",
    "devops-engineer": "Deploy / CI/CD / infra",
    "security-auditor": "Security audit / defensive review",
    "penetration-tester": "Offensive security / pentest",
    "mobile-developer": "Mobile (React Native / Flutter)",
    "documentation-writer": "Documentation (only when explicitly requested)",
  };
  return exact[name] ? { role: exact[name], superpowersGeneric: "general-purpose" } : null;
}
```

- [ ] **Step 4: Enhance `agentsWorkflowBlock`**

Replace the `agentsWorkflowBlock` body (keep the signature and the existing sort/table) so it appends the bridge:

```js
export function agentsWorkflowBlock(agents) {
  if (!agents.length) return "";
  const sorted = [...agents].sort((a, b) => {
    const ai = AGENT_ORDER.indexOf(a.name);
    const bi = AGENT_ORDER.indexOf(b.name);
    if (ai === -1 && bi === -1) return a.name.localeCompare(b.name);
    if (ai === -1) return 1;
    if (bi === -1) return -1;
    return ai - bi;
  });
  const rows = sorted.map((a) => `| \`${a.name}\` | ${a.whenToUse} |`).join("\n");

  const bridgeRows = sorted
    .map((a) => ({ name: a.name, role: routingRole(a.name) }))
    .filter((x) => x.role !== null)
    .map((x) => `| ${x.role.role} | \`${x.name}\` |`)
    .join("\n");

  const bridge = bridgeRows
    ? `
### Superpowers → Project Specialists (mandatory bridging)

Superpowers skills (\`dispatching-parallel-agents\`, \`subagent-driven-development\`,
\`executing-plans\`, \`systematic-debugging\`) show \`general-purpose\` as the default
\`subagent_type\` in their examples. **Never dispatch \`general-purpose\` (or a generic
implementer) when a specialist below covers the domain** — pass the specialist's exact
name as \`subagent_type\` instead.

> Basis: superpowers itself states "User's explicit instructions (CLAUDE.md) — highest
> priority." This section applies that priority over the agent types its examples suggest.
> The normal flow is unchanged (brainstorming → writing-plans → subagent-driven-development);
> only the dispatched \`subagent_type\` changes.

| When superpowers would use \`general-purpose\` for… | Dispatch instead |
|---|---|
${bridgeRows}
`
    : "";

  return `## Workflow & Agents

For every non-trivial implementation: invoke \`superpowers:subagent-driven-development\`.
When dispatching subagents, you MUST use the matching specialist agent from the table below — never the generic agent when a specialist is listed. Cross-reference the task type with the "When to use" column and pass the exact name as \`subagent_type\`.

| Agent | When to use |
|---|---|
${rows}
${bridge}`;
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `node --test tests/claude-md.test.mjs`
Expected: PASS.

- [ ] **Step 6: Update the distributed dispatch rule**

In `templates/rules/07-subagent-dispatch.md`, replace the "Task → agent mapping" table with a pointer (avoid duplicating the per-project table):

```markdown
## Superpowers bridging

The root `CLAUDE.md` "## Workflow & Agents" section contains a
"Superpowers → Project Specialists" table built from the agents installed in THIS
project. When a superpowers skill example shows `general-purpose`, consult that table
and dispatch the listed specialist instead. Only fall back to `general-purpose` when no
specialist row covers the task.
```

- [ ] **Step 7: Typecheck + lint + commit**

```bash
npm run typecheck && npm run lint
git add lib/generate/claude-md.mjs templates/rules/07-subagent-dispatch.md tests/claude-md.test.mjs
git commit -m "feat(claude-md): dynamic superpowers→specialist bridge from installed agents"
```

---

## Task 6: Local skill `revise-agent-frontmatter`

**Files:**
- Create: `skills/revise-agent-frontmatter/SKILL.md`

**Interfaces:**
- Consumes: `scripts/apply-agent-descriptions.mjs` (Task 3), `checkAgentDescription` (Task 2), the integrity test (Task 4), the catalog maps.
- Produces: an invocable `/revise-agent-frontmatter` skill (local to this repo, NOT under `templates/`, so never distributed).

- [ ] **Step 1: Write the skill**

```markdown
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
```

- [ ] **Step 2: Sanity-check the skill frontmatter validates**

Run: `node --test tests/frontmatter-validator.test.mjs`
Expected: PASS (no regression). The skill uses `allowed-tools` (correct for skills).

- [ ] **Step 3: Commit**

```bash
git add skills/revise-agent-frontmatter/SKILL.md
git commit -m "feat(skill): revise-agent-frontmatter — author/maintain canonical agent descriptions"
```

---

## Task 7: Repo enforcement rule + CLAUDE.md maintenance line

**Files:**
- Create: `.claude/rules/agent-frontmatter-standard.md`
- Modify: `CLAUDE.md` (repo) — one maintenance line

**Interfaces:**
- Consumes: nothing at runtime; it is a path-scoped reminder loaded when editing candidate agents or the catalogs.
- Produces: an auto-surfaced reminder to run the skill + the gate.

- [ ] **Step 1: Write the path-scoped rule**

```markdown
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
```

- [ ] **Step 2: Add one maintenance line to the repo CLAUDE.md**

In `CLAUDE.md`, inside the "Asset catalog — mandatory maintenance" bullet group under `## Conventions`, append:

```markdown
- **Agent description standard — mandatory**: every candidate agent's routing
  description lives in its provenance `*_AGENT_WHEN_TO_USE` map (single source of
  truth for frontmatter + CLAUDE.md table). After adding/editing an agent, run
  `/revise-agent-frontmatter` and `npm test`
  (`tests/agent-frontmatter-standard.test.mjs` enforces it). See
  `.claude/rules/agent-frontmatter-standard.md`.
```

- [ ] **Step 3: Commit**

```bash
git add .claude/rules/agent-frontmatter-standard.md CLAUDE.md
git commit -m "docs(agents): enforce agent routing-description standard via rule + CLAUDE.md"
```

---

## Task 8: Populate all canonical descriptions (turn the gate green)

**Files:**
- Modify: `lib/data/ecc-catalog.mjs`, `lib/data/agkit-catalog.mjs`, `lib/data/project-catalog.mjs` (map prose)
- Modify: every file under `templates/ecc/agents/`, `templates/ag-kit/agents/`, `templates/agents/` (via the script)

**Interfaces:**
- Consumes: everything from Tasks 1–7.
- Produces: integrity gate green; all descriptions best-practice; files in sync with maps.

- [ ] **Step 1: Author + propagate (follow the revise-agent-frontmatter procedure directly)**

Follow the procedure documented in `skills/revise-agent-frontmatter/SKILL.md` directly
(do not rely on invoking the slash command). For EVERY agent file under
`templates/ecc/agents/`, `templates/ag-kit/agents/`, `templates/agents/`:
read the agent body to understand its real domain, author a single-line description
meeting `checkAgentDescription` (condition-shaped, "Use proactively" + explicit
triggers), and write it into the matching map (`ECC_AGENT_WHEN_TO_USE` /
`AGKIT_AGENT_WHEN_TO_USE` / `PROJECT_AGENT_WHEN_TO_USE`) by provenance. Then run the
propagation script (Step 2) to write the files.

Worked examples of the target prose (shape, not the full set):

ECC (`ECC_AGENT_WHEN_TO_USE`):
```js
"go-reviewer":
  "Reviews Go code for idiomatic style, concurrency safety, error handling, and performance. Use proactively after editing any .go file. MUST BE USED before merging Go changes.",
"go-build-resolver":
  "Diagnoses and fixes failing Go builds — compile errors, module/version conflicts, vet failures. Use proactively when `go build` or `go test` fails.",
```

ag-kit (`AGKIT_AGENT_WHEN_TO_USE`):
```js
"backend-specialist":
  "Owns API, server-side logic, and database integration. Use proactively when implementing endpoints, services, auth, or persistence on the backend.",
debugger:
  "Finds the root cause of bugs, crashes, and flaky behavior. Use proactively when a test fails or a defect is reported, before attempting a fix.",
```

first-party (`PROJECT_AGENT_WHEN_TO_USE`):
```js
"nestjs-code-reviewer":
  "Reviews NestJS controllers, services, modules, schemas, and DTOs for architecture, DB, validation, TypeScript, and Swagger drift. Use proactively after editing any NestJS HTTP or persistence file (not auth).",
"nestjs-security-reviewer":
  "Exploitability-focused review of NestJS auth, users, env, and new endpoints. Use proactively after any auth/users/env change or new endpoint, before merge.",
```

Remove the now-inaccurate `≤8 words` comments above each map.

- [ ] **Step 2: Run the propagation script (if the skill didn't already)**

Run: `node scripts/apply-agent-descriptions.mjs`
Expected: updates the remaining agent files; re-running prints `updated 0 file(s)` (idempotent).

- [ ] **Step 3: Verify every map value meets the standard**

The integrity test does NOT exist yet (it is the next task). Verify compliance with a
one-off check that runs the checker over all three maps:

Run: `node -e "import('./lib/validate/agent-description.mjs').then(async m=>{const a=await import('./lib/data/asset-catalog.mjs');let bad=0;for(const map of [a.ECC_AGENT_WHEN_TO_USE,a.AGKIT_AGENT_WHEN_TO_USE,a.PROJECT_AGENT_WHEN_TO_USE])for(const [k,v] of Object.entries(map)){const r=m.checkAgentDescription(v);if(!r.ok){bad++;console.log(k,r.violations.join('; '))}}console.log(bad?('FAIL '+bad):'OK all compliant')})"`
Expected: `OK all compliant`. Fix any printed agent's map entry and re-run Step 2.

- [ ] **Step 4: Full verification**

Run: `node scripts/apply-agent-descriptions.mjs && npm run typecheck && npm run lint && npm test`
Expected: `updated 0 file(s).` (idempotent), then all clean/green (existing suite — the integrity gate is added in the next task).

- [ ] **Step 5: Spot-check a generated CLAUDE.md**

Run: `node bin/harness.mjs plan tests/fixtures/go-app --json | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{const p=JSON.parse(s);const a=p.artifacts.find(x=>x.path==='CLAUDE.md');console.log(a.content)})"`

(`tests/fixtures/go-app` selects the ECC `go-reviewer` + `go-build-resolver`. Other fixtures available: `java-spring`, `java-quarkus`, `php-laravel`, `php-adianti`, `js-ts-app`, `monorepo`.)
Expected: the `## Workflow & Agents` table shows best-practice descriptions AND the "Superpowers → Project Specialists" bridge with only the installed agents' rows.

- [ ] **Step 6: Commit**

```bash
git add lib/data/ecc-catalog.mjs lib/data/agkit-catalog.mjs lib/data/project-catalog.mjs templates/ecc/agents templates/ag-kit/agents templates/agents
git commit -m "feat(agents): best-practice routing descriptions for all candidate agents"
```

---

## Task 9: Re-vendor smoke check (durability across sync)

**Files:** none (verification only)

**Interfaces:**
- Consumes: the wired transforms (Task 3) + populated maps (Task 8).
- Produces: confidence that `sync:ecc` / `sync:agkit` preserve canonical descriptions.

- [ ] **Step 1: Dry verification without network (preferred)**

Re-running `node scripts/apply-agent-descriptions.mjs` must be a no-op after Task 8:

Run: `node scripts/apply-agent-descriptions.mjs`
Expected: `updated 0 file(s).` — proves files already equal the maps.

- [ ] **Step 2: Transform-level assertion (no network)**

Confirm the transform itself injects the map value. This is already covered by the
Task 3 tests; re-run them:

Run: `node --test tests/agkit-transform.test.mjs tests/ecc-transform.test.mjs`
Expected: PASS — the folded description equals `resolveCanonicalDescription(name)`.

- [ ] **Step 3 (optional, networked): real re-vendor**

Only if network + pins are available:

```bash
npm run sync:agkit && npm run sync:ecc
git diff --stat templates/ecc/agents templates/ag-kit/agents
node --test tests/agent-frontmatter-standard.test.mjs
```

Expected: descriptions unchanged (still the canonical map values); gate green. If the
diff shows description churn, the transform wiring regressed — fix before merging.

- [ ] **Step 4: Final full suite**

Run: `npm test`
Expected: all green.

---

## Self-Review

**Spec coverage:**
- C1 canonical maps → Task 8 (prose) + Tasks 2/3 (plumbing). ✅
- C2 durable propagation (folded parser, applier, transforms, script) → Tasks 1, 2, 3. ✅
- C3 skill → Task 6. ✅
- C4 deterministic gate → Task 4. ✅
- C5 dynamic bridge + routingRole + 07-subagent-dispatch alignment → Task 5. ✅
- C6 repo rule + CLAUDE.md line → Task 7. ✅
- Durability across re-sync → Task 9. ✅
- Acceptance criteria 1–6 → Tasks 4, 9, 5, 6, 7, 8 respectively. ✅

**Placeholder scan:** Task 8's 46 descriptions are authored by the skill at execution; the plan fixes the exact shape (standard + worked examples per provenance) and the verifiable deliverable (integrity gate green). This is a test-defined deliverable, not a placeholder.

**Type consistency:** `parseFrontmatter`/`renderFrontmatter` (Task 1) reused identically in Tasks 2–4 and the script. `resolveCanonicalDescription` (Task 2) → consumed in Tasks 3, 4. `applyCanonicalDescription` (Task 2) → consumed in Tasks 3, script. `routingRole`/`agentsWorkflowBlock` (Task 5) → tested in Task 5. `checkAgentDescription` (Task 2) → consumed in Tasks 4, 6. Names consistent across tasks.

**Risks flagged for the implementer:**
- agkit `transform.mjs` currently exports `parseFrontmatter`/`renderFrontmatter`, but NO external module imports them (verified: `agkit-transform.test.mjs` imports only the `clean*`/`mapAgentTools`/`stampMarkdown` symbols). So the neutral-module migration needs only the internal import; the re-export is optional. New tests import `parseFrontmatter` from `lib/util/frontmatter-yaml.mjs`.
- ECC agent frontmatter is simple (name/description/tools/model). If any ECC agent has an exotic field the neutral parser doesn't round-trip, the Task 3 ecc refactor surfaces it in `ecc-transform.test.mjs` — handle by keeping the field as a normal single-line entry (the parser already does).
- Confirm `tests/claude-md.test.mjs` exists before Task 5 Step 1 (`ls tests | grep claude-md`); create it if absent.
