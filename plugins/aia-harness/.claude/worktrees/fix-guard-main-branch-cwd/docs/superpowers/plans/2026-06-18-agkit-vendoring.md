# ag-kit Vendoring Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Vendorizar um subset curado do ag-kit (agentes, skills, comandos, scripts) para `templates/ag-kit/`, convertendo frontmatters Antigravity → Claude Code, e fiá-lo no pipeline `scan → plan → apply` espelhando o padrão ECC.

**Architecture:** Módulo paralelo ao ECC: `scripts/agkit-source.json` (pin) + `scripts/sync-agkit.mjs` (vendoriza via GitHub tree + raw CDN) + `lib/agkit/transform.mjs` (transforms puros de frontmatter) + `lib/data/agkit-catalog.mjs` (stack→assets) + bloco novo em `lib/plan.mjs`. Transforms e catálogo são puros e unit-testados sem rede.

**Tech Stack:** Node ≥18, ESM `.mjs`, JSDoc + `tsc --checkJs`, `node:test`, ESLint flat config.

## Global Constraints

- Todo source é `.mjs` ESM com tipos JSDoc — sem `.ts`, sem build step.
- `lib/` puro; IO só nas bordas. Transforms (`lib/agkit/transform.mjs`) e catálogo (`lib/data/agkit-catalog.mjs`) **sem IO**.
- Provenance carimbada em cada arquivo vendorizado; atribuição: `ag-kit by vudovn — https://github.com/vudovn/ag-kit — MIT License`.
- Fonte pinada por commit: `a909d03c808296b86cc124e09acf5f1c7efa4e49`.
- Todos os agentes vendorizados: `model: sonnet`.
- `templates/` fica fora de lint/typecheck (já configurado).
- Comandos: só entram os cujo nome NÃO colide com slash-command embutido do Claude Code. Conjunto de colisão (built-ins): `init, doctor, status, review, compact, clear, config, help, mcp, memory, model, agents, cost, bug, permissions, resume, vim`. Dos 14 workflows ag-kit, só `status` colide → descartado.
- `npm test` (typecheck + lint + unit) verde ao final.

## File Structure

- `scripts/agkit-source.json` — **criar**. Pin do upstream (repo, ref, commit, bases, atribuição).
- `lib/agkit/transform.mjs` — **criar**. Transforms puros de frontmatter por tipo (agent/skill/command/script).
- `lib/data/agkit-catalog.mjs` — **criar**. `AGKIT_COMMON`, `AGKIT_BY_STACK`, `stackKeys`, `selectAgkitAssets`, `allAgkitAssets`.
- `scripts/sync-agkit.mjs` — **criar**. Vendoriza para `templates/ag-kit/`.
- `templates/ag-kit/**` — **gerado** pelo sync (agents/, skills/, commands/, scripts/, LICENSE, MANIFEST.json).
- `lib/plan.mjs` — **modificar**. Adicionar `"commands"` ao enum `category` e bloco de artifacts ag-kit após o ECC.
- `package.json` — **modificar**. Script `sync:agkit`.
- `tests/agkit-transform.test.mjs` — **criar**.
- `tests/agkit-catalog.test.mjs` — **criar**.
- `tests/agkit-plan-apply.test.mjs` — **criar**.
- `CLAUDE.md` — **modificar**. Documentar a segunda fonte de vendoring.

---

### Task 1: Transforms puros de frontmatter (`lib/agkit/transform.mjs`)

**Files:**
- Create: `lib/agkit/transform.mjs`
- Test: `tests/agkit-transform.test.mjs`

**Interfaces:**
- Consumes: `splitFrontmatter` de `lib/ecc/transform.mjs` (já existe, exportada).
- Produces:
  - `parseFrontmatter(frontmatter: string): {key:string,value:string}[]`
  - `renderFrontmatter(entries: {key:string,value:string}[]): string`
  - `mapAgentTools(value: string): string`
  - `cleanAgentMarkdown(content: string, meta: {sourcePath:string,commit:string}): string`
  - `cleanSkillMarkdown(content: string, meta): string`
  - `cleanCommandMarkdown(content: string, meta): string`
  - `cleanScript(content: string, meta): string`

- [ ] **Step 1: Write the failing test**

Create `tests/agkit-transform.test.mjs`:

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  mapAgentTools,
  cleanAgentMarkdown,
  cleanSkillMarkdown,
  cleanCommandMarkdown,
  cleanScript,
} from "../lib/agkit/transform.mjs";

const META = { sourcePath: ".agents/agent/x.md", commit: "abc123" };

test("mapAgentTools maps and drops Antigravity tools", () => {
  assert.equal(mapAgentTools("Read, Grep, FindByName, ViewCodeItem"), "Read, Grep, Glob");
  assert.equal(mapAgentTools("Read, Grep, Glob, Bash, Write, Edit, Agent"), "Read, Grep, Glob, Bash, Write, Edit, Task");
  assert.equal(mapAgentTools("Read, Glob, Glob"), "Read, Glob");
});

test("cleanAgentMarkdown drops skills, forces model sonnet, maps tools, stamps", () => {
  const input = [
    "---",
    "name: backend-specialist",
    "description: Expert backend.",
    "tools: Read, Grep, Glob, FindByName",
    "model: inherit",
    "skills: clean-code, api-patterns",
    "---",
    "",
    "# Backend",
    "Body here.",
    "",
  ].join("\n");
  const out = cleanAgentMarkdown(input, META);
  assert.match(out, /^---\n/);
  assert.doesNotMatch(out, /^skills:/m);
  assert.doesNotMatch(out, /model: inherit/);
  assert.match(out, /^model: sonnet$/m);
  assert.match(out, /^tools: Read, Grep, Glob$/m);
  assert.match(out, /Vendored from ag-kit .* @ abc123/);
  assert.match(out, /# Backend/);
});

test("cleanSkillMarkdown folds when_to_use into description and removes it", () => {
  const input = [
    "---",
    "name: api-patterns",
    "description: API design principles.",
    'when_to_use: "When designing REST APIs. NOT for UI work."',
    "allowed-tools: Read, Write",
    "---",
    "",
    "# API Patterns",
    "",
  ].join("\n");
  const out = cleanSkillMarkdown(input, META);
  assert.doesNotMatch(out, /^when_to_use:/m);
  assert.match(out, /API design principles\. When designing REST APIs\. NOT for UI work\./);
  assert.match(out, /^allowed-tools: Read, Write$/m);
  assert.match(out, /Vendored from ag-kit/);
});

test("cleanCommandMarkdown preserves $ARGUMENTS and stamps provenance", () => {
  const input = [
    "---",
    "description: Debugging command.",
    "---",
    "",
    "# /debug",
    "",
    "$ARGUMENTS",
    "",
  ].join("\n");
  const out = cleanCommandMarkdown(input, META);
  assert.match(out, /^description: Debugging command\.$/m);
  assert.match(out, /\$ARGUMENTS/);
  assert.match(out, /Vendored from ag-kit/);
});

test("cleanScript strips AG Kit branding and stamps after shebang", () => {
  const input = "#!/usr/bin/env python3\n\"\"\"\nFull Verification Suite - AG Kit\n\"\"\"\nimport sys\n";
  const out = cleanScript(input, { sourcePath: ".agents/scripts/verify_all.py", commit: "abc123" });
  assert.match(out, /^#!\/usr\/bin\/env python3\n/);
  assert.match(out.split("\n")[1], /Vendored from ag-kit/);
  assert.doesNotMatch(out, /AG Kit/);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/agkit-transform.test.mjs`
Expected: FAIL — `Cannot find module '../lib/agkit/transform.mjs'`.

- [ ] **Step 3: Write minimal implementation**

Create `lib/agkit/transform.mjs`:

```js
/**
 * Pure transforms applied to ag-kit files when vendoring them into
 * templates/ag-kit/. ag-kit targets Antigravity, so frontmatters are
 * converted to Claude Code conventions. No IO here -> unit-testable.
 *
 * @module agkit/transform
 */
import { splitFrontmatter } from "../ecc/transform.mjs";

/** Antigravity agent tools that map onto a Claude Code equivalent. */
const AGENT_TOOL_MAP = /** @type {Record<string,string>} */ ({ FindByName: "Glob", Agent: "Task" });
/** Antigravity-only tools with no Claude Code equivalent -> dropped. */
const AGENT_TOOL_DROP = new Set(["ViewCodeItem"]);
/** Tools a Claude Code subagent may declare. Unknown tools are dropped. */
const CLAUDE_AGENT_TOOLS = new Set([
  "Read", "Write", "Edit", "Grep", "Glob", "Bash",
  "WebFetch", "WebSearch", "TodoWrite", "NotebookEdit", "Task",
]);

/** @param {string} sourcePath @param {string} commit @returns {string} */
function provenanceComment(sourcePath, commit) {
  return `<!-- Vendored from ag-kit (github.com/vudovn/ag-kit) @ ${commit} :: ${sourcePath}. MIT (c) vudovn. -->\n`;
}

/** @param {string} v @returns {string} */
function unquote(v) {
  const t = v.trim();
  if ((t.startsWith('"') && t.endsWith('"')) || (t.startsWith("'") && t.endsWith("'"))) {
    return t.slice(1, -1);
  }
  return t;
}

/** @param {string} v @returns {boolean} */
function needsQuote(v) {
  return /:\s/.test(v) || /^[\s"'#&*!|>%@`]/.test(v) || v.includes('"');
}

/** @param {string} v @returns {string} */
function quoteIfNeeded(v) {
  return needsQuote(v) ? `"${v.replace(/"/g, '\\"')}"` : v;
}

/**
 * Parse a flat YAML frontmatter block into ordered entries. Assumes one
 * `key: value` per line (true for ag-kit agent/skill/workflow frontmatters).
 * @param {string} frontmatter  Includes the --- fences.
 * @returns {{ key: string, value: string }[]}
 */
export function parseFrontmatter(frontmatter) {
  /** @type {{ key: string, value: string }[]} */
  const entries = [];
  for (const line of frontmatter.split("\n")) {
    if (line === "---" || line.trim() === "") continue;
    const m = line.match(/^([A-Za-z0-9_-]+):\s?(.*)$/);
    if (m) entries.push({ key: m[1], value: m[2] });
  }
  return entries;
}

/**
 * @param {{ key: string, value: string }[]} entries
 * @returns {string}  Frontmatter block including --- fences and trailing newline.
 */
export function renderFrontmatter(entries) {
  const body = entries.map((e) => `${e.key}: ${quoteIfNeeded(e.value)}`).join("\n");
  return `---\n${body}\n---\n`;
}

/**
 * Convert an ag-kit agent `tools:` value to Claude Code tool names: map known
 * Antigravity tools, drop unknown/unsupported ones, dedupe, preserve order.
 * @param {string} value
 * @returns {string}
 */
export function mapAgentTools(value) {
  /** @type {string[]} */
  const out = [];
  for (const raw of value.split(",").map((t) => t.trim()).filter(Boolean)) {
    if (AGENT_TOOL_DROP.has(raw)) continue;
    const mapped = AGENT_TOOL_MAP[raw] ?? raw;
    if (!CLAUDE_AGENT_TOOLS.has(mapped)) continue;
    if (!out.includes(mapped)) out.push(mapped);
  }
  return out.join(", ");
}

/**
 * Convert an ag-kit agent markdown for Claude Code: drop `skills:`, force
 * `model: sonnet`, rewrite `tools:`, stamp provenance.
 * @param {string} content
 * @param {{ sourcePath: string, commit: string }} meta
 * @returns {string}
 */
export function cleanAgentMarkdown(content, meta) {
  const { frontmatter, body } = splitFrontmatter(content);
  const entries = parseFrontmatter(frontmatter).filter((e) => e.key !== "skills" && e.key !== "model");
  for (const e of entries) {
    if (e.key === "tools") e.value = mapAgentTools(e.value);
  }
  entries.push({ key: "model", value: "sonnet" });
  const fm = renderFrontmatter(entries);
  return `${fm}${provenanceComment(meta.sourcePath, meta.commit)}\n${body.replace(/^\n+/, "")}`;
}

/**
 * Convert an ag-kit SKILL.md for Claude Code: fold `when_to_use` into
 * `description` (Claude Code triggers on description, ignores when_to_use),
 * drop the when_to_use key, keep name/allowed-tools, stamp provenance.
 * @param {string} content
 * @param {{ sourcePath: string, commit: string }} meta
 * @returns {string}
 */
export function cleanSkillMarkdown(content, meta) {
  const { frontmatter, body } = splitFrontmatter(content);
  const entries = parseFrontmatter(frontmatter);
  const whenIdx = entries.findIndex((e) => e.key === "when_to_use");
  const descIdx = entries.findIndex((e) => e.key === "description");
  if (whenIdx !== -1) {
    const when = unquote(entries[whenIdx].value);
    if (descIdx !== -1 && when) {
      const desc = unquote(entries[descIdx].value);
      entries[descIdx].value = `${desc} ${when}`.trim();
    }
    entries.splice(whenIdx, 1);
  }
  const fm = renderFrontmatter(entries);
  return `${fm}${provenanceComment(meta.sourcePath, meta.commit)}\n${body.replace(/^\n+/, "")}`;
}

/**
 * Keep a command verbatim (already Claude-Code-shaped: $ARGUMENTS, description
 * frontmatter) but stamp provenance after the frontmatter.
 * @param {string} content
 * @param {{ sourcePath: string, commit: string }} meta
 * @returns {string}
 */
export function cleanCommandMarkdown(content, meta) {
  const { frontmatter, body } = splitFrontmatter(content);
  return `${frontmatter}${provenanceComment(meta.sourcePath, meta.commit)}\n${body.replace(/^\n+/, "")}`;
}

/**
 * Strip "AG Kit" branding from a Python helper and stamp provenance (after the
 * shebang if present).
 * @param {string} content
 * @param {{ sourcePath: string, commit: string }} meta
 * @returns {string}
 */
export function cleanScript(content, meta) {
  const stripped = content.replace(/ ?- ?AG Kit/g, "").replace(/AG Kit/g, "ag-kit");
  const prov = `# Vendored from ag-kit (github.com/vudovn/ag-kit) @ ${meta.commit} :: ${meta.sourcePath}. MIT (c) vudovn.\n`;
  if (stripped.startsWith("#!")) {
    const nl = stripped.indexOf("\n");
    return stripped.slice(0, nl + 1) + prov + stripped.slice(nl + 1);
  }
  return prov + stripped;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/agkit-transform.test.mjs`
Expected: PASS (5 tests).

- [ ] **Step 5: Typecheck**

Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add lib/agkit/transform.mjs tests/agkit-transform.test.mjs
git commit -m "feat(agkit): pure frontmatter transforms for vendoring"
```

---

### Task 2: Catálogo stack→assets (`lib/data/agkit-catalog.mjs`)

**Files:**
- Create: `lib/data/agkit-catalog.mjs`
- Test: `tests/agkit-catalog.test.mjs`

**Interfaces:**
- Consumes: `stackKeys` de `lib/data/ecc-catalog.mjs` (já existe, exportada).
- Produces:
  - `AGKIT_COMMON: AgkitAssetSet`
  - `AGKIT_BY_STACK: Record<string, AgkitAssetSet>`
  - `stackKeys(profile): string[]`
  - `selectAgkitAssets(profile): AgkitAssetSet`
  - `allAgkitAssets(): AgkitAssetSet`
  - typedef `AgkitAssetSet = { agents: string[], skills: string[], commands: string[], scripts: string[] }`

- [ ] **Step 1: Write the failing test**

Create `tests/agkit-catalog.test.mjs`:

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { selectAgkitAssets, allAgkitAssets, AGKIT_COMMON } from "../lib/data/agkit-catalog.mjs";

/** @param {Partial<import('../lib/profile.mjs').ProjectProfile>} p */
function profile(p) {
  return /** @type {any} */ ({ root: "/x", primaryLanguage: "JavaScript", frameworks: [], ...p });
}

test("selectAgkitAssets always includes the common set", () => {
  const a = selectAgkitAssets(profile({ primaryLanguage: "Go" }));
  for (const agent of AGKIT_COMMON.agents) assert.ok(a.agents.includes(agent));
  assert.ok(a.commands.includes("debug"));
  assert.ok(a.scripts.includes("verify_all"));
});

test("commands never include the colliding 'status'", () => {
  const a = selectAgkitAssets(profile({}));
  assert.ok(!a.commands.includes("status"));
});

test("react stack adds the frontend specialist and tailwind skill", () => {
  const a = selectAgkitAssets(profile({ primaryLanguage: "TypeScript", frameworks: [{ name: "React" }] }));
  assert.ok(a.agents.includes("frontend-specialist"));
  assert.ok(a.skills.includes("tailwind-patterns"));
});

test("flutter/dart adds the mobile developer", () => {
  const a = selectAgkitAssets(profile({ primaryLanguage: "Dart", frameworks: [{ name: "Flutter" }] }));
  assert.ok(a.agents.includes("mobile-developer"));
  assert.ok(a.skills.includes("mobile-design"));
});

test("results are sorted and de-duplicated", () => {
  const a = selectAgkitAssets(profile({ primaryLanguage: "TypeScript", frameworks: [{ name: "React" }] }));
  assert.deepEqual(a.agents, [...new Set(a.agents)].sort());
  assert.deepEqual(a.skills, [...new Set(a.skills)].sort());
});

test("allAgkitAssets is a superset of any single selection", () => {
  const all = allAgkitAssets();
  const a = selectAgkitAssets(profile({ primaryLanguage: "TypeScript", frameworks: [{ name: "React" }] }));
  for (const x of a.agents) assert.ok(all.agents.includes(x));
  for (const x of a.skills) assert.ok(all.skills.includes(x));
  assert.ok(all.agents.includes("game-developer"));
  assert.ok(all.skills.includes("game-development"));
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/agkit-catalog.test.mjs`
Expected: FAIL — module not found.

- [ ] **Step 3: Write minimal implementation**

Create `lib/data/agkit-catalog.mjs`:

```js
/**
 * Curated map of detected-stack -> ag-kit assets (agents / skills / commands /
 * scripts). Single source of truth for BOTH the sync script (what to vendor)
 * and the planner (what to install). Asset names are ag-kit's filenames.
 *
 * @module data/agkit-catalog
 */
import { stackKeys as eccStackKeys } from "./ecc-catalog.mjs";

/** @typedef {{ agents: string[], skills: string[], commands: string[], scripts: string[] }} AgkitAssetSet */

/** Workflows that survive the name-collision rule (only `status` collides). */
const AGKIT_COMMANDS = [
  "brainstorm", "coordinate", "create", "debug", "deploy", "enhance",
  "orchestrate", "plan", "preview", "remember", "test", "verify",
];

/** Installed for every project. */
export const AGKIT_COMMON = {
  agents: [
    "orchestrator", "project-planner", "code-archaeologist", "documentation-writer",
    "devops-engineer", "database-architect", "performance-optimizer",
    "qa-automation-engineer", "penetration-tester", "product-manager", "product-owner",
  ],
  skills: [
    "architecture", "clean-code", "context-compression", "memory-system",
    "lint-and-validate", "behavioral-modes", "intelligent-routing", "coordinator-mode",
    "batch-operations", "documentation-templates", "deployment-procedures",
    "testing-patterns", "database-design", "server-management", "performance-profiling",
    "bash-linux", "powershell-windows", "code-review-graph", "red-team-tactics",
    "vulnerability-scanner",
  ],
  commands: AGKIT_COMMANDS,
  scripts: ["verify_all", "checklist"],
};

const WEB = {
  agents: ["frontend-specialist", "backend-specialist", "seo-specialist"],
  skills: ["tailwind-patterns", "web-design-guidelines", "app-builder", "i18n-localization"],
  commands: [],
  scripts: [],
};
const BACKEND = { agents: ["backend-specialist"], skills: [], commands: [], scripts: [] };
const MOBILE = {
  agents: ["mobile-developer"],
  skills: ["mobile-design", "i18n-localization"],
  commands: [],
  scripts: [],
};
const GAMES = { agents: ["game-developer"], skills: ["game-development"], commands: [], scripts: [] };

/** @type {Record<string, AgkitAssetSet>} */
export const AGKIT_BY_STACK = {
  react: WEB,
  vue: WEB,
  typescript: BACKEND,
  python: BACKEND,
  go: BACKEND,
  rust: BACKEND,
  java: BACKEND,
  "java-spring": BACKEND,
  "java-quarkus": BACKEND,
  kotlin: BACKEND,
  php: BACKEND,
  "php-laravel": BACKEND,
  django: BACKEND,
  fastapi: BACKEND,
  csharp: BACKEND,
  cpp: BACKEND,
  dart: MOBILE,
  mobile: MOBILE,
  games: GAMES,
};

/**
 * ag-kit stack keys: ECC's keys plus ag-kit-only `mobile`/`games` derived from
 * the same profile (no new detectors).
 * @param {import('../profile.mjs').ProjectProfile} profile
 * @returns {string[]}
 */
export function stackKeys(profile) {
  const keys = eccStackKeys(profile);
  const fw = profile.frameworks.map((f) => f.name);
  if (profile.primaryLanguage === "Dart" || fw.some((n) => /react native|expo|flutter/i.test(n))) {
    keys.push("mobile");
  }
  if (fw.some((n) => /unity|godot|phaser|unreal|bevy/i.test(n))) keys.push("games");
  return [...new Set(keys)];
}

/**
 * @param {AgkitAssetSet} into
 * @param {AgkitAssetSet} from
 */
function merge(into, from) {
  from.agents.forEach((a) => into.agents.add(a));
  from.skills.forEach((s) => into.skills.add(s));
  from.commands.forEach((c) => into.commands.add(c));
  from.scripts.forEach((s) => into.scripts.add(s));
}

/** @param {{agents:Set<string>,skills:Set<string>,commands:Set<string>,scripts:Set<string>}} sets @returns {AgkitAssetSet} */
function freeze(sets) {
  return {
    agents: [...sets.agents].sort(),
    skills: [...sets.skills].sort(),
    commands: [...sets.commands].sort(),
    scripts: [...sets.scripts].sort(),
  };
}

/** @returns {{agents:Set<string>,skills:Set<string>,commands:Set<string>,scripts:Set<string>}} */
function commonSets() {
  return {
    agents: new Set(AGKIT_COMMON.agents),
    skills: new Set(AGKIT_COMMON.skills),
    commands: new Set(AGKIT_COMMON.commands),
    scripts: new Set(AGKIT_COMMON.scripts),
  };
}

/**
 * Resolve the ag-kit assets to install for a profile (deduped, common included).
 * @param {import('../profile.mjs').ProjectProfile} profile
 * @returns {AgkitAssetSet}
 */
export function selectAgkitAssets(profile) {
  const sets = commonSets();
  for (const key of stackKeys(profile)) {
    const set = AGKIT_BY_STACK[key];
    if (set) merge(/** @type {any} */ (sets), set);
  }
  return freeze(sets);
}

/**
 * The union of every catalogued asset — used by the sync script to decide what
 * to vendor.
 * @returns {AgkitAssetSet}
 */
export function allAgkitAssets() {
  const sets = commonSets();
  for (const set of Object.values(AGKIT_BY_STACK)) merge(/** @type {any} */ (sets), set);
  return freeze(sets);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/agkit-catalog.test.mjs`
Expected: PASS (6 tests).

- [ ] **Step 5: Typecheck**

Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add lib/data/agkit-catalog.mjs tests/agkit-catalog.test.mjs
git commit -m "feat(agkit): stack->asset catalog mirroring ECC"
```

---

### Task 3: Pin de fonte + sync script + vendoring

**Files:**
- Create: `scripts/agkit-source.json`
- Create: `scripts/sync-agkit.mjs`
- Modify: `package.json` (add `sync:agkit`)
- Generated: `templates/ag-kit/**`

**Interfaces:**
- Consumes: `allAgkitAssets()` de `lib/data/agkit-catalog.mjs`; `cleanAgentMarkdown`, `cleanSkillMarkdown`, `cleanCommandMarkdown`, `cleanScript` de `lib/agkit/transform.mjs`.
- Produces: `templates/ag-kit/{agents,skills,commands,scripts}/`, `templates/ag-kit/LICENSE`, `templates/ag-kit/MANIFEST.json`.

- [ ] **Step 1: Criar o pin de fonte**

Create `scripts/agkit-source.json`:

```json
{
  "repo": "vudovn/ag-kit",
  "ref": "main",
  "commit": "a909d03c808296b86cc124e09acf5f1c7efa4e49",
  "rawBase": "https://raw.githubusercontent.com",
  "apiBase": "https://api.github.com",
  "attribution": "ag-kit by vudovn — https://github.com/vudovn/ag-kit — MIT License"
}
```

- [ ] **Step 2: Escrever o sync script**

Create `scripts/sync-agkit.mjs`:

```js
#!/usr/bin/env node
/**
 * Vendor a curated subset of ag-kit (vudovn/ag-kit, MIT) into templates/ag-kit/.
 * One GitHub API call (recursive tree); all file content via the raw CDN.
 * Frontmatters are converted to Claude Code conventions via lib/agkit/transform.
 * Run with: npm run sync:agkit
 *
 * @module scripts/sync-agkit
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { allAgkitAssets } from "../lib/data/agkit-catalog.mjs";
import {
  cleanAgentMarkdown,
  cleanSkillMarkdown,
  cleanCommandMarkdown,
  cleanScript,
} from "../lib/agkit/transform.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..");
const OUT_DIR = path.join(ROOT, "templates", "ag-kit");
const SOURCE_PATH = path.join(HERE, "agkit-source.json");

/** @type {{ repo: string, ref: string, commit: string|null, rawBase: string, apiBase: string, attribution: string }} */
const source = JSON.parse(fs.readFileSync(SOURCE_PATH, "utf8"));

const AG = ".agents";

/** @param {string} url @returns {Promise<Response>} */
async function get(url) {
  /** @type {Record<string, string>} */
  const headers = { "User-Agent": "aia-harness-sync" };
  const token = process.env.GITHUB_TOKEN;
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(url, { headers });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  return res;
}

/** @returns {Promise<string>} */
async function resolveCommit() {
  if (source.commit) return source.commit;
  const res = await get(`${source.apiBase}/repos/${source.repo}/commits/${source.ref}`);
  const json = /** @type {any} */ (await res.json());
  return json.sha;
}

/** @param {string} commit @returns {Promise<{ path: string, type: string }[]>} */
async function fetchTree(commit) {
  const res = await get(`${source.apiBase}/repos/${source.repo}/git/trees/${commit}?recursive=1`);
  const json = /** @type {any} */ (await res.json());
  if (json.truncated) throw new Error("ag-kit git tree is truncated; re-run with GITHUB_TOKEN.");
  return json.tree;
}

/** @param {string} commit @param {string} repoPath @returns {Promise<string>} */
async function fetchRaw(commit, repoPath) {
  const res = await get(`${source.rawBase}/${source.repo}/${commit}/${repoPath}`);
  return res.text();
}

/** @param {string} target @param {string} content */
function writeFile(target, content) {
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, content);
}

async function main() {
  const commit = await resolveCommit();
  console.log(`ag-kit sync @ ${commit}`);
  const tree = await fetchTree(commit);
  const blobPaths = new Set(tree.filter((t) => t.type === "blob").map((t) => t.path));

  const want = allAgkitAssets();
  fs.rmSync(OUT_DIR, { recursive: true, force: true });
  const counts = { agents: 0, skills: 0, commands: 0, scripts: 0, other: 0 };

  // Agents.
  for (const name of want.agents) {
    const repoPath = `${AG}/agent/${name}.md`;
    if (!blobPaths.has(repoPath)) { console.warn(`  ! missing agent: ${repoPath}`); continue; }
    const raw = await fetchRaw(commit, repoPath);
    writeFile(path.join(OUT_DIR, "agents", `${name}.md`), cleanAgentMarkdown(raw, { sourcePath: repoPath, commit }));
    counts.agents += 1;
  }

  // Skills (whole directory; SKILL.md transformed, support files verbatim).
  for (const name of want.skills) {
    const prefix = `${AG}/skills/${name}/`;
    const files = [...blobPaths].filter((p) => p.startsWith(prefix));
    if (files.length === 0) { console.warn(`  ! missing skill: ${name}`); continue; }
    for (const repoPath of files) {
      const raw = await fetchRaw(commit, repoPath);
      const rel = repoPath.slice(`${AG}/skills/`.length); // <name>/...
      const content = repoPath.endsWith("/SKILL.md")
        ? cleanSkillMarkdown(raw, { sourcePath: repoPath, commit })
        : raw;
      writeFile(path.join(OUT_DIR, "skills", rel), content);
    }
    counts.skills += 1;
  }

  // Commands (ag-kit workflows).
  for (const name of want.commands) {
    const repoPath = `${AG}/workflows/${name}.md`;
    if (!blobPaths.has(repoPath)) { console.warn(`  ! missing command: ${repoPath}`); continue; }
    const raw = await fetchRaw(commit, repoPath);
    writeFile(path.join(OUT_DIR, "commands", `${name}.md`), cleanCommandMarkdown(raw, { sourcePath: repoPath, commit }));
    counts.commands += 1;
  }

  // Scripts.
  for (const name of want.scripts) {
    const repoPath = `${AG}/scripts/${name}.py`;
    if (!blobPaths.has(repoPath)) { console.warn(`  ! missing script: ${repoPath}`); continue; }
    const raw = await fetchRaw(commit, repoPath);
    writeFile(path.join(OUT_DIR, "scripts", `${name}.py`), cleanScript(raw, { sourcePath: repoPath, commit }));
    counts.scripts += 1;
  }

  // License (verbatim).
  if (blobPaths.has("LICENSE")) {
    writeFile(path.join(OUT_DIR, "LICENSE"), await fetchRaw(commit, "LICENSE"));
    counts.other += 1;
  }

  const manifest = {
    source: source.repo,
    ref: source.ref,
    commit,
    attribution: source.attribution,
    vendoredAt: new Date().toISOString(),
    counts,
    assets: want,
  };
  writeFile(path.join(OUT_DIR, "MANIFEST.json"), JSON.stringify(manifest, null, 2) + "\n");

  if (!source.commit) {
    source.commit = commit;
    fs.writeFileSync(SOURCE_PATH, JSON.stringify(source, null, 2) + "\n");
  }

  console.log(`Vendored: ${counts.agents} agents, ${counts.skills} skills, ${counts.commands} commands, ${counts.scripts} scripts.`);
  console.log(`-> ${path.relative(ROOT, OUT_DIR)}`);
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
```

- [ ] **Step 3: Add npm script**

In `package.json`, in `"scripts"`, after the `"sync:tools"` line, add:

```json
    "sync:agkit": "node scripts/sync-agkit.mjs",
```

- [ ] **Step 4: Run the sync (vendoriza)**

Run: `npm run sync:agkit`
Expected: `Vendored: N agents, M skills, K commands, 2 scripts.` and a populated `templates/ag-kit/`. No `! missing` warnings (if any appear, the catalog references a non-existent upstream asset — fix the name in `agkit-catalog.mjs`).

- [ ] **Step 5: Spot-check the conversion**

Run: `grep -l "model: sonnet" templates/ag-kit/agents/*.md | wc -l` then `grep -rL "model: sonnet" templates/ag-kit/agents/*.md`
Expected: every agent file has `model: sonnet`; second command prints nothing.

Run: `grep -rc "when_to_use" templates/ag-kit/skills/ | grep -v ':0' || echo "no when_to_use left"`
Expected: `no when_to_use left`.

Run: `test -f templates/ag-kit/LICENSE && test -f templates/ag-kit/MANIFEST.json && echo OK`
Expected: `OK`.

- [ ] **Step 6: Audit provenance (sub-agent)**

Dispatch the `vendor-provenance-auditor` agent on `templates/ag-kit/`. Expected: provenance stamp on every agent/skill/command/script, license retained, no secrets or network/exec calls introduced. Fix anything it flags before committing.

- [ ] **Step 7: Commit**

```bash
git add scripts/agkit-source.json scripts/sync-agkit.mjs package.json templates/ag-kit
git commit -m "feat(agkit): sync script + vendored ag-kit subset"
```

---

### Task 4: Fiar no `buildPlan` (`lib/plan.mjs`)

**Files:**
- Modify: `lib/plan.mjs` (category enum ~L28; new block after ECC ~L310)
- Test: `tests/agkit-plan-apply.test.mjs`

**Interfaces:**
- Consumes: `selectAgkitAssets` de `lib/data/agkit-catalog.mjs`; vendored files under `templates/ag-kit/`.
- Produces: artifacts `agkit-agent:<name>`, `agkit-skill:<name>`, `agkit-command:<name>`, `agkit-script:<name>`.

- [ ] **Step 1: Write the failing test**

Create `tests/agkit-plan-apply.test.mjs`:

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { scanProject } from "../lib/detect/index.mjs";
import { buildPlan } from "../lib/plan.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const FIX = path.join(ROOT, "tests", "fixtures");

test("buildPlan emits ag-kit agent/skill/command/script artifacts", () => {
  const profile = scanProject(path.join(FIX, "js-ts-app"));
  const plan = buildPlan(profile, { pluginRoot: ROOT });
  const ids = plan.artifacts.map((a) => a.id);
  assert.ok(ids.includes("agkit-agent:orchestrator"));
  assert.ok(ids.some((id) => id.startsWith("agkit-skill:")));
  assert.ok(ids.includes("agkit-command:debug"));
  assert.ok(ids.includes("agkit-script:verify_all"));

  const cmd = plan.artifacts.find((a) => a.id === "agkit-command:debug");
  if (!cmd) throw new Error("agkit command missing");
  assert.equal(cmd.relPath, ".claude/commands/debug.md");
  assert.equal(cmd.category, "commands");
  assert.equal(cmd.contextCost, 0);

  const script = plan.artifacts.find((a) => a.id === "agkit-script:verify_all");
  if (!script) throw new Error("agkit script missing");
  assert.equal(script.relPath, ".claude/scripts/verify_all.py");
  assert.equal(script.executable, true);

  // No colliding command leaked in.
  assert.ok(!ids.includes("agkit-command:status"));
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/agkit-plan-apply.test.mjs`
Expected: FAIL — `agkit-agent:orchestrator` not in ids.

- [ ] **Step 3: Add `"commands"` to the category enum**

In `lib/plan.mjs`, modify the `category` typedef line (~L28). Change:

```js
 * @property {"claude-md"|"rules"|"settings"|"mcp"|"hooks"|"skills"|"agents"|"tools"|"worktree"|"lsp"|"docs"|"script"} category
```

to:

```js
 * @property {"claude-md"|"rules"|"settings"|"mcp"|"hooks"|"skills"|"agents"|"commands"|"tools"|"worktree"|"lsp"|"docs"|"script"} category
```

- [ ] **Step 4: Add the import**

In `lib/plan.mjs`, after the `import { selectEccAssets } from "./data/ecc-catalog.mjs";` line (~L19), add:

```js
import { selectAgkitAssets } from "./data/agkit-catalog.mjs";
```

- [ ] **Step 5: Add the ag-kit artifact block**

In `lib/plan.mjs`, immediately after the ECC rules loop closes (the block ending ~L310, just before the `// Project-level tools:` comment), insert:

```js
  // ag-kit-sourced assets (vendored under templates/ag-kit/), assigned by stack.
  const agkit = selectAgkitAssets(profile);
  const agkitRoot = path.join(pluginRoot, "templates", "ag-kit");
  for (const name of agkit.agents) {
    const from = path.join(agkitRoot, "agents", `${name}.md`);
    if (!exists(from)) continue;
    add({
      id: `agkit-agent:${name}`,
      relPath: `.claude/agents/${name}.md`,
      title: `ag-kit agent: ${name}`,
      category: "agents",
      rationale: "Role-based specialist from ag-kit (MIT, vudovn).",
      contextCost: 0,
      defaultSelected: true,
      copyFrom: from,
    });
  }
  for (const name of agkit.skills) {
    const from = path.join(agkitRoot, "skills", name);
    if (!exists(from)) continue;
    add({
      id: `agkit-skill:${name}`,
      relPath: `.claude/skills/${name}`,
      title: `ag-kit skill: ${name}`,
      category: "skills",
      rationale: "Skill from ag-kit (MIT, vudovn).",
      contextCost: 0,
      defaultSelected: true,
      copyFrom: from,
    });
  }
  for (const name of agkit.commands) {
    const from = path.join(agkitRoot, "commands", `${name}.md`);
    if (!exists(from)) continue;
    add({
      id: `agkit-command:${name}`,
      relPath: `.claude/commands/${name}.md`,
      title: `ag-kit command: /${name}`,
      category: "commands",
      rationale: "Workflow command from ag-kit (MIT, vudovn).",
      contextCost: 0,
      defaultSelected: true,
      copyFrom: from,
    });
  }
  for (const name of agkit.scripts) {
    const from = path.join(agkitRoot, "scripts", `${name}.py`);
    if (!exists(from)) continue;
    add({
      id: `agkit-script:${name}`,
      relPath: `.claude/scripts/${name}.py`,
      title: `ag-kit script: ${name}.py`,
      category: "script",
      rationale: "Optional Python helper from ag-kit (MIT, vudovn).",
      contextCost: 0,
      defaultSelected: false,
      executable: true,
      copyFrom: from,
    });
  }
```

- [ ] **Step 6: Run test to verify it passes**

Run: `node --test tests/agkit-plan-apply.test.mjs`
Expected: PASS.

- [ ] **Step 7: Typecheck**

Run: `npm run typecheck`
Expected: no errors (the `category: "commands"` is now valid).

- [ ] **Step 8: Commit**

```bash
git add lib/plan.mjs tests/agkit-plan-apply.test.mjs
git commit -m "feat(agkit): wire vendored ag-kit assets into buildPlan"
```

---

### Task 5: Documentação + verificação final

**Files:**
- Modify: `CLAUDE.md` (Vendoring section)

- [ ] **Step 1: Document the second vendoring source**

In `CLAUDE.md`, in the `### Vendoring (ECC + tools)` subsection, after the paragraph describing `templates/ecc/` and `templates/tools/`, add:

```markdown

A third vendored source, `templates/ag-kit/`, mirrors the ECC pattern for
[vudovn/ag-kit](https://github.com/vudovn/ag-kit) (MIT): `scripts/agkit-source.json`
pins the commit, `scripts/sync-agkit.mjs` (`npm run sync:agkit`) fetches and rewrites
through the pure transforms in `lib/agkit/transform.mjs` (Antigravity→Claude Code
frontmatter conversion: drop the agent `skills:` field, force `model: sonnet`, map
Antigravity tools, fold skill `when_to_use` into `description`). `lib/data/agkit-catalog.mjs`
decides what applies by detected stack. ag-kit content is MIT © vudovn — keep attribution.
```

- [ ] **Step 2: Update the Commands section reference (if present)**

In `CLAUDE.md`, in the `## Commands` block, after the `npm run sync:tools` line, add:

```bash
npm run sync:agkit  # re-vendor ag-kit assets, pinned in scripts/agkit-source.json
```

- [ ] **Step 3: Run the full suite**

Run: `npm test`
Expected: typecheck + lint + all unit tests PASS, including the three new ag-kit test files.

- [ ] **Step 4: Commit**

```bash
git add CLAUDE.md
git commit -m "docs(agkit): document ag-kit as a vendored template source"
```

---

## Self-Review

**Spec coverage:**
- §1 Arquitetura → Tasks 1-4 (transform, catalog, sync, wiring). ✓
- §2 Conversão de frontmatter (agents drop skills/model sonnet/tools; skills when_to_use; commands stamp) → Task 1 + tests. ✓
- §3 Curadoria (skills/agents excluded, commands non-colliding) → Task 2 catalog (`AGKIT_COMMON`/`AGKIT_BY_STACK` omit excluded; `AGKIT_COMMANDS` drops `status`). ✓
- §4 Scripts (keep verify_all/checklist) → Task 2 `AGKIT_COMMON.scripts` + Task 3 sync. ✓
- §5 Seleção stack-mapped → Task 2 `stackKeys`/`selectAgkitAssets`/`allAgkitAssets`. ✓
- §6 Fiação buildPlan + category enum → Task 4. ✓
- §7 Testes + licença → Tasks 1,2,4 tests; LICENSE+MANIFEST in Task 3. ✓
- Decisões travadas (scripts subset, non-colliding commands, excluded agents, model sonnet) → all encoded in catalog + transform. ✓

**Placeholder scan:** No TBD/TODO. Every code step shows full content. ✓

**Type consistency:** `AgkitAssetSet = {agents,skills,commands,scripts}` used uniformly across catalog, sync (`want.agents` etc.), and plan block. Transform exports (`cleanAgentMarkdown`/`cleanSkillMarkdown`/`cleanCommandMarkdown`/`cleanScript`) match sync imports. `meta` shape `{sourcePath,commit}` consistent. Artifact `category: "commands"` added to enum before use. ✓

## Notes / refinamentos sobre o spec

- O spec deixou a lista exata de commands para a implementação; este plano fixa: descartar só `status` (única colisão com built-in). Os demais 13 entram, mesmo quando o conceito sobrepõe superpowers — a regra travada é colisão de **nome**, não de conceito.
- `game-developer`/`game-development` ficam catalogados sob a chave `games`, derivada de `profile.frameworks` (Unity/Godot/Phaser/Unreal/Bevy) sem novo detector. Se nenhum projeto-alvo casar, ficam vendorizados mas não auto-selecionados — comportamento aceito.
- Scripts entram com `defaultSelected: false` (helpers opcionais, não impostos a todo projeto), coerente com o spec §4 ("helpers opcionais").
