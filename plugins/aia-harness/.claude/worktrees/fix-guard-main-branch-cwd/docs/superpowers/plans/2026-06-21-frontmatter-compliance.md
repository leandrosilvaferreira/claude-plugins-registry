# Frontmatter Compliance Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ensure all Claude Code asset templates (agents, skills, commands, rules) distributed to target projects have spec-compliant YAML frontmatter — auto-fixing format errors in transforms and at apply time, surfacing developer warnings via a normalization script and a plugin PreToolUse hook.

**Architecture:** A pure `lib/validate/frontmatter.mjs` module defines schema, detection, and normalization — imported by the ECC transform (fix at sync time), the apply pipeline (safety net), and the plugin hook (dev-time guard). A `scripts/normalize-frontmatter.mjs` dev tool performs a one-time fix of existing templates without touching body content.

**Tech Stack:** Node ≥18 ESM (.mjs), `node:fs`, `node:readline/promises`, `node:test` + `node:assert/strict`, existing `lib/validate/hook-schema.mjs`, `lib/ecc/transform.mjs`, `lib/apply.mjs`.

## Global Constraints

- All source files are `.mjs` ESM — no TypeScript, no build step
- JSDoc types only — no `.ts` annotations in `.mjs` files
- Tests use `node:test` + `node:assert/strict` — no third-party test framework
- `templates/` is excluded from lint/typecheck — do not add it to tsconfig or eslint scope
- Hook compliance is mandatory: every output path of a distributed hook must pass its schema validator from `lib/validate/hook-schema.mjs`
- Hook exit codes: 0 (success/allow) and 2 (block/stderr) only — any other code is a bug
- `npm test` must pass (typecheck + lint + unit) before each commit
- Body content of template files must never be modified — normalize frontmatter block only
- The normalize script is a dev tool — not distributed, not user-facing

## Claude Code Frontmatter Spec (reference)

| Type | Required | Optional | Tools field |
|------|----------|----------|-------------|
| `agent` | `name`, `description` | `tools` (CSV), `model` | `tools:` |
| `skill` | `name`, `description` | `allowed-tools` (CSV), `disable-model-invocation` | `allowed-tools:` |
| `command` | `description` | `allowed-tools` (CSV), `model` | `allowed-tools:` |
| `rule` | — | `paths` (YAML block list) | — |
| hook `.mjs` | N/A — no frontmatter | | |

Tools field format: comma-separated scalar, unquoted. Never JSON/YAML array, never quoted entries.

---

## Task 1: `lib/validate/frontmatter.mjs` + barrel + unit tests

**Files:**
- Create: `lib/validate/frontmatter.mjs`
- Create: `lib/validate/index.mjs`
- Create: `tests/frontmatter-validator.test.mjs`

**Interfaces:**
- Produces:
  - `detectAssetType(relPath: string): 'agent'|'skill'|'command'|'rule'|null`
  - `normalizeToolsValue(value: string): string`
  - `validateFrontmatter(content: string, type: AssetType): { valid: boolean, errors: string[], warnings: string[], normalized: string }`

- [ ] **Step 1: Write failing tests**

```js
// tests/frontmatter-validator.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { detectAssetType, normalizeToolsValue, validateFrontmatter } from "../lib/validate/frontmatter.mjs";

// --- detectAssetType ---

test("detectAssetType: agent path", () => {
  assert.equal(detectAssetType("ecc/agents/go-reviewer.md"), "agent");
  assert.equal(detectAssetType("ag-kit/agents/backend-specialist.md"), "agent");
});

test("detectAssetType: skill SKILL.md", () => {
  assert.equal(detectAssetType("ag-kit/skills/coordinator-mode/SKILL.md"), "skill");
  assert.equal(detectAssetType("ag-kit/skills/app-builder/templates/SKILL.md"), "skill");
});

test("detectAssetType: command", () => {
  assert.equal(detectAssetType("ag-kit/commands/brainstorm.md"), "command");
});

test("detectAssetType: rule", () => {
  assert.equal(detectAssetType("ecc/rules/01-ddd.md"), "rule");
});

test("detectAssetType: unrecognised paths → null", () => {
  assert.equal(detectAssetType("ag-kit/MANIFEST.json"), null);
  assert.equal(detectAssetType("hooks/secret-scan.mjs"), null);
  assert.equal(detectAssetType("ag-kit/skills/coordinator-mode/support.md"), null);
});

// --- normalizeToolsValue ---

test("normalizeToolsValue: JSON array with quotes", () => {
  assert.equal(normalizeToolsValue('["Read", "Grep", "Glob"]'), "Read, Grep, Glob");
});

test("normalizeToolsValue: JSON array without quotes", () => {
  assert.equal(normalizeToolsValue("[Read, Grep]"), "Read, Grep");
});

test("normalizeToolsValue: CSV with some quoted entries", () => {
  assert.equal(
    normalizeToolsValue('Read, Grep, "mcp__foo__bar"'),
    "Read, Grep, mcp__foo__bar"
  );
});

test("normalizeToolsValue: all quoted entries", () => {
  assert.equal(normalizeToolsValue('"Read", "Grep"'), "Read, Grep");
});

test("normalizeToolsValue: already clean CSV unchanged", () => {
  assert.equal(normalizeToolsValue("Read, Grep, Glob"), "Read, Grep, Glob");
});

test("normalizeToolsValue: MCP tool with underscores unquoted", () => {
  assert.equal(
    normalizeToolsValue("Read, mcp__code-review-graph__semantic_search"),
    "Read, mcp__code-review-graph__semantic_search"
  );
});

// --- validateFrontmatter: agent ---

test("validateFrontmatter agent: valid → no errors, no warnings when tools+model present", () => {
  const content = "---\nname: foo\ndescription: bar\ntools: Read, Grep\nmodel: sonnet\n---\nBody.\n";
  const r = validateFrontmatter(content, "agent");
  assert.equal(r.valid, true);
  assert.deepEqual(r.errors, []);
  assert.deepEqual(r.warnings, []);
  assert.equal(r.normalized, content);
});

test("validateFrontmatter agent: JSON array tools → error, normalized has CSV", () => {
  const content = '---\nname: foo\ndescription: bar\ntools: ["Read", "Grep"]\nmodel: sonnet\n---\nBody.\n';
  const r = validateFrontmatter(content, "agent");
  assert.equal(r.valid, false);
  assert.ok(r.errors.some(e => e.includes("tools")));
  assert.match(r.normalized, /^tools: Read, Grep$/m);
  assert.doesNotMatch(r.normalized, /\[/);
});

test("validateFrontmatter agent: mixed quoted MCP tool → error, normalized clean", () => {
  const content = '---\nname: foo\ndescription: bar\ntools: Read, "mcp__foo__bar"\nmodel: sonnet\n---\nBody.\n';
  const r = validateFrontmatter(content, "agent");
  assert.equal(r.valid, false);
  assert.match(r.normalized, /^tools: Read, mcp__foo__bar$/m);
});

test("validateFrontmatter agent: missing tools → warning, valid=true", () => {
  const content = "---\nname: foo\ndescription: bar\nmodel: sonnet\n---\nBody.\n";
  const r = validateFrontmatter(content, "agent");
  assert.equal(r.valid, true);
  assert.ok(r.warnings.some(w => w.includes("tools")));
  assert.equal(r.normalized, content);
});

test("validateFrontmatter agent: missing model → warning, valid=true", () => {
  const content = "---\nname: foo\ndescription: bar\ntools: Read\n---\nBody.\n";
  const r = validateFrontmatter(content, "agent");
  assert.equal(r.valid, true);
  assert.ok(r.warnings.some(w => w.includes("model")));
});

test("validateFrontmatter agent: missing name → error", () => {
  const content = "---\ndescription: bar\ntools: Read\n---\nBody.\n";
  const r = validateFrontmatter(content, "agent");
  assert.equal(r.valid, false);
  assert.ok(r.errors.some(e => e.includes("name")));
});

test("validateFrontmatter agent: wrong field allowed-tools → renamed to tools in normalized", () => {
  const content = "---\nname: foo\ndescription: bar\nallowed-tools: Read, Grep\n---\nBody.\n";
  const r = validateFrontmatter(content, "agent");
  assert.equal(r.valid, false);
  assert.match(r.normalized, /^tools: Read, Grep$/m);
  assert.doesNotMatch(r.normalized, /allowed-tools/);
});

// --- validateFrontmatter: skill ---

test("validateFrontmatter skill: valid allowed-tools → no errors", () => {
  const content = "---\nname: foo\ndescription: bar\nallowed-tools: Read, Grep\n---\nBody.\n";
  const r = validateFrontmatter(content, "skill");
  assert.equal(r.valid, true);
  assert.deepEqual(r.errors, []);
});

test("validateFrontmatter skill: allowed-tools JSON array → error, normalized CSV", () => {
  const content = '---\nname: foo\ndescription: bar\nallowed-tools: ["Read", "Grep"]\n---\nBody.\n';
  const r = validateFrontmatter(content, "skill");
  assert.equal(r.valid, false);
  assert.match(r.normalized, /^allowed-tools: Read, Grep$/m);
});

test("validateFrontmatter skill: missing allowed-tools → warning", () => {
  const content = "---\nname: foo\ndescription: bar\n---\nBody.\n";
  const r = validateFrontmatter(content, "skill");
  assert.equal(r.valid, true);
  assert.ok(r.warnings.some(w => w.includes("allowed-tools")));
});

// --- validateFrontmatter: command ---

test("validateFrontmatter command: valid → no errors", () => {
  const content = "---\ndescription: bar\nallowed-tools: Read, Grep\n---\nBody.\n";
  const r = validateFrontmatter(content, "command");
  assert.equal(r.valid, true);
});

test("validateFrontmatter command: missing description → error", () => {
  const content = "---\nallowed-tools: Read\n---\nBody.\n";
  const r = validateFrontmatter(content, "command");
  assert.equal(r.valid, false);
  assert.ok(r.errors.some(e => e.includes("description")));
});

// --- validateFrontmatter: rule ---

test("validateFrontmatter rule: with paths → no warnings", () => {
  const content = '---\npaths:\n  - "src/**/*.ts"\n---\nRules.\n';
  const r = validateFrontmatter(content, "rule");
  assert.equal(r.valid, true);
  assert.deepEqual(r.warnings, []);
});

test("validateFrontmatter rule: no paths → warning, valid=true", () => {
  const content = "---\n---\nRules.\n";
  const r = validateFrontmatter(content, "rule");
  assert.equal(r.valid, true);
  assert.ok(r.warnings.some(w => w.includes("paths")));
});

// --- null type → passthrough ---

test("validateFrontmatter null type → always valid, no changes", () => {
  const content = "---\nanything: goes\n---\nBody.\n";
  const r = validateFrontmatter(content, null);
  assert.equal(r.valid, true);
  assert.deepEqual(r.errors, []);
  assert.equal(r.normalized, content);
});

// --- body preservation ---

test("validateFrontmatter: body content unchanged after normalization", () => {
  const content = '---\nname: foo\ndescription: bar\ntools: ["Read"]\n---\n# Agent\n\nBody with **markdown**.\n';
  const r = validateFrontmatter(content, "agent");
  assert.match(r.normalized, /# Agent\n\nBody with \*\*markdown\*\*\./);
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
node --test tests/frontmatter-validator.test.mjs
```

Expected: multiple "ERR_MODULE_NOT_FOUND" or similar — module doesn't exist yet.

- [ ] **Step 3: Implement `lib/validate/frontmatter.mjs`**

```js
/**
 * Claude Code frontmatter schema validation and normalization for distributed
 * template assets (agents, skills, commands, rules).
 *
 * Pure module — no IO, no side effects. Importable from transforms, apply, and hooks.
 *
 * @module validate/frontmatter
 */

/**
 * @typedef {'agent'|'skill'|'command'|'rule'|null} AssetType
 */

/**
 * @typedef {Object} FrontmatterResult
 * @property {boolean} valid - false iff format errors exist
 * @property {string[]} errors - format violations (auto-fixed in `normalized`)
 * @property {string[]} warnings - missing optional impactful fields (NOT auto-fixed)
 * @property {string} normalized - content with errors corrected; body always preserved
 */

const FRONTMATTER_RE = /^---\n([\s\S]*?)\n---\n/;

/**
 * @param {string} content
 * @returns {{ frontmatter: string, fields: Map<string,string>, body: string }}
 */
function parse(content) {
  const m = content.match(FRONTMATTER_RE);
  if (!m) return { frontmatter: "", fields: new Map(), body: content };
  const frontmatter = m[0];
  const body = content.slice(frontmatter.length);
  /** @type {Map<string, string>} */
  const fields = new Map();
  for (const line of m[1].split("\n")) {
    const match = line.match(/^([A-Za-z0-9_-]+):\s?(.*)$/);
    if (match) fields.set(match[1], match[2]);
  }
  return { frontmatter, fields, body };
}

/**
 * Rebuild full file content from a modified field map, preserving original
 * field order. Fields present in original but absent from `modified` are
 * dropped. Fields in `modified` but absent from original are appended.
 * Body is always appended unchanged.
 *
 * @param {Map<string,string>} original - original field map (for ordering)
 * @param {Map<string,string>} modified - final field map
 * @param {string} body
 * @returns {string}
 */
function rebuild(original, modified, body) {
  const lines = ["---"];
  const emitted = new Set();
  for (const [k] of original) {
    if (modified.has(k)) {
      lines.push(`${k}: ${modified.get(k)}`);
      emitted.add(k);
    }
  }
  for (const [k, v] of modified) {
    if (!emitted.has(k)) lines.push(`${k}: ${v}`);
  }
  lines.push("---", "");
  return lines.join("\n") + body;
}

/**
 * Derive asset type from a path relative to the `templates/` directory.
 *
 * @param {string} relPath
 * @returns {AssetType}
 */
export function detectAssetType(relPath) {
  const p = relPath.replace(/\\/g, "/");
  if (/\/agents\/[^/]+\.md$/.test(p)) return "agent";
  if (/\/commands\/[^/]+\.md$/.test(p)) return "command";
  if (/\/rules\/[^/]+\.md$/.test(p)) return "rule";
  if (/\/skills\/.*SKILL\.md$/.test(p)) return "skill";
  return null;
}

/**
 * Normalize a `tools` or `allowed-tools` field value to clean CSV.
 *
 * Handles:
 *   - JSON/YAML arrays: `["Read", "Grep"]` or `[Read, Grep]` → `Read, Grep`
 *   - Quoted entries: `Read, "mcp__foo__bar"` → `Read, mcp__foo__bar`
 *   - Already clean CSV: returned unchanged
 *
 * @param {string} value
 * @returns {string}
 */
export function normalizeToolsValue(value) {
  const trimmed = value.trim();
  /** @type {string[]} */
  let items;
  if (trimmed.startsWith("[")) {
    try {
      items = JSON.parse(trimmed);
    } catch {
      items = trimmed
        .slice(1, -1)
        .split(",")
        .map((s) => s.trim().replace(/^["']|["']$/g, ""));
    }
  } else {
    items = trimmed.split(",").map((s) => {
      const t = s.trim();
      return (t.startsWith('"') && t.endsWith('"')) || (t.startsWith("'") && t.endsWith("'"))
        ? t.slice(1, -1)
        : t;
    });
  }
  return items.filter(Boolean).join(", ");
}

/**
 * Validate and normalize frontmatter for a given asset type.
 *
 * - `errors`: format violations → auto-fixed in `normalized`
 * - `warnings`: missing optional fields with behavioral impact → NOT auto-fixed
 * - `valid`: false iff `errors` is non-empty
 * - `normalized`: content with errors fixed; body always unchanged
 *
 * @param {string} content
 * @param {AssetType} type
 * @returns {FrontmatterResult}
 */
export function validateFrontmatter(content, type) {
  if (!type) return { valid: true, errors: [], warnings: [], normalized: content };

  const { frontmatter, fields, body } = parse(content);

  if (!frontmatter) {
    const errors = type === "rule" ? [] : ["missing frontmatter block"];
    return { valid: errors.length === 0, errors, warnings: [], normalized: content };
  }

  /** @type {string[]} */
  const errors = [];
  /** @type {string[]} */
  const warnings = [];
  const modified = new Map(fields);

  if (type === "agent") {
    if (!fields.has("name")) errors.push("missing required field: name");
    if (!fields.has("description")) errors.push("missing required field: description");

    if (fields.has("allowed-tools") && !fields.has("tools")) {
      errors.push('agent uses "allowed-tools" — must be "tools"');
      modified.set("tools", normalizeToolsValue(fields.get("allowed-tools") ?? ""));
      modified.delete("allowed-tools");
    } else if (fields.has("tools")) {
      const raw = fields.get("tools") ?? "";
      const norm = normalizeToolsValue(raw);
      if (norm !== raw.trim()) {
        errors.push(`tools: format non-compliant — normalized to "${norm}"`);
        modified.set("tools", norm);
      }
    } else {
      warnings.push("missing tools — agent has unrestricted tool access");
    }

    if (!fields.has("model")) {
      warnings.push("missing model — agent inherits model from its caller");
    }
  }

  if (type === "skill") {
    if (!fields.has("name")) errors.push("missing required field: name");
    if (!fields.has("description")) errors.push("missing required field: description");

    if (fields.has("tools") && !fields.has("allowed-tools")) {
      errors.push('skill uses "tools" — must be "allowed-tools"');
      modified.set("allowed-tools", normalizeToolsValue(fields.get("tools") ?? ""));
      modified.delete("tools");
    } else if (fields.has("allowed-tools")) {
      const raw = fields.get("allowed-tools") ?? "";
      const norm = normalizeToolsValue(raw);
      if (norm !== raw.trim()) {
        errors.push(`allowed-tools: format non-compliant — normalized to "${norm}"`);
        modified.set("allowed-tools", norm);
      }
    } else {
      warnings.push("missing allowed-tools — skill has unrestricted tool access");
    }
  }

  if (type === "command") {
    if (!fields.has("description")) errors.push("missing required field: description");

    if (fields.has("tools") && !fields.has("allowed-tools")) {
      errors.push('command uses "tools" — must be "allowed-tools"');
      modified.set("allowed-tools", normalizeToolsValue(fields.get("tools") ?? ""));
      modified.delete("tools");
    } else if (fields.has("allowed-tools")) {
      const raw = fields.get("allowed-tools") ?? "";
      const norm = normalizeToolsValue(raw);
      if (norm !== raw.trim()) {
        errors.push(`allowed-tools: format non-compliant — normalized to "${norm}"`);
        modified.set("allowed-tools", norm);
      }
    }
  }

  if (type === "rule") {
    if (!fields.has("paths")) {
      warnings.push("missing paths — rule applies globally to all project files");
    }
  }

  const normalized =
    errors.length > 0 ? rebuild(fields, modified, body) : content;

  return { valid: errors.length === 0, errors, warnings, normalized };
}
```

- [ ] **Step 4: Create `lib/validate/index.mjs`**

```js
/**
 * @module validate
 */
export { detectAssetType, normalizeToolsValue, validateFrontmatter } from "./frontmatter.mjs";
```

- [ ] **Step 5: Run tests and verify they pass**

```bash
node --test tests/frontmatter-validator.test.mjs
```

Expected: all tests pass (✓ green).

- [ ] **Step 6: Run full test suite**

```bash
npm test
```

Expected: typecheck + lint + all unit tests pass.

- [ ] **Step 7: Commit**

```bash
git add lib/validate/frontmatter.mjs lib/validate/index.mjs tests/frontmatter-validator.test.mjs
git commit -m "feat: add lib/validate/frontmatter — pure asset frontmatter validator"
```

---

## Task 2: ECC transform — normalize `tools` at sync time

**Files:**
- Modify: `lib/ecc/transform.mjs`
- Modify: `tests/ecc-transform.test.mjs`

**Interfaces:**
- Consumes: `normalizeToolsValue` from `lib/validate/frontmatter.mjs`
- Produces: `cleanAgentMarkdown` now outputs normalized `tools:` CSV in frontmatter

- [ ] **Step 1: Write failing test for tools normalization in ECC transform**

Add to `tests/ecc-transform.test.mjs` after the existing tests:

```js
test("cleanAgentMarkdown: tools JSON array normalized to CSV", () => {
  const input = [
    "---",
    "name: go-reviewer",
    "description: Expert Go reviewer.",
    'tools: ["Read", "Grep", "Glob"]',
    "model: sonnet",
    "---",
    "",
    "# Go Reviewer",
    "Body content.",
    "",
  ].join("\n");
  const out = cleanAgentMarkdown(input, { sourcePath: "agents/go-reviewer.md", commit: "abc" });
  assert.match(out, /^tools: Read, Grep, Glob$/m);
  assert.doesNotMatch(out, /\[/);
  assert.doesNotMatch(out, /"/);
});

test("cleanAgentMarkdown: mixed quoted MCP tools normalized", () => {
  const input = [
    "---",
    "name: backend",
    "description: Backend spec.",
    'tools: Read, Grep, "mcp__foo__bar"',
    "model: sonnet",
    "---",
    "",
    "Body.",
    "",
  ].join("\n");
  const out = cleanAgentMarkdown(input, { sourcePath: "agents/backend.md", commit: "abc" });
  assert.match(out, /^tools: Read, Grep, mcp__foo__bar$/m);
});
```

- [ ] **Step 2: Run failing tests to verify**

```bash
node --test tests/ecc-transform.test.mjs
```

Expected: the two new tests FAIL — `tools:` still has JSON array or quotes.

- [ ] **Step 3: Update `lib/ecc/transform.mjs`**

Add the import at the top (after existing imports, or as first import):

```js
import { normalizeToolsValue } from "../validate/frontmatter.mjs";
```

Update `cleanAgentMarkdown` to normalize the tools field. The current implementation keeps frontmatter verbatim. Replace it with:

```js
/**
 * Clean an ECC agent markdown file for redistribution: drop the shared
 * "Prompt Defense Baseline" block and the dangling "## Related" cross-refs,
 * normalize the `tools` frontmatter field to spec-compliant CSV, and stamp
 * provenance.
 * @param {string} content
 * @param {{ sourcePath: string, commit: string }} meta
 * @returns {string}
 */
export function cleanAgentMarkdown(content, meta) {
  const { frontmatter, body } = splitFrontmatter(content);
  const normalizedFm = frontmatter.replace(/^(tools:\s*)(.+)$/m, (_, key, val) => {
    const norm = normalizeToolsValue(val);
    return `${key}${norm}`;
  });
  const cleaned = removeSection(
    removeSection(body, /^##\s+Prompt Defense/),
    /^##\s+Related/
  );
  return `${normalizedFm}${provenanceComment(meta)}\n${cleaned.replace(/^\n+/, "")}`;
}
```

- [ ] **Step 4: Run tests and verify they pass**

```bash
node --test tests/ecc-transform.test.mjs
```

Expected: all tests pass including the two new ones.

- [ ] **Step 5: Run full test suite**

```bash
npm test
```

Expected: all pass.

- [ ] **Step 6: Commit**

```bash
git add lib/ecc/transform.mjs tests/ecc-transform.test.mjs
git commit -m "feat(ecc): normalize tools frontmatter field to spec-compliant CSV at sync time"
```

---

## Task 3: Normalization script + fix existing templates

**Files:**
- Create: `scripts/normalize-frontmatter.mjs`

**Interfaces:**
- Consumes: `detectAssetType`, `validateFrontmatter` from `lib/validate/frontmatter.mjs`
- Produces: fixed template files on disk (when `--fix-format` or `--interactive`)

- [ ] **Step 1: Implement `scripts/normalize-frontmatter.mjs`**

```js
#!/usr/bin/env node
/**
 * Dev tool: scan all markdown template files for frontmatter compliance.
 *
 * Usage:
 *   node scripts/normalize-frontmatter.mjs [--dry-run] [--fix-format] [--interactive] [--report=FILE] [dir]
 *
 *   --dry-run      (default) print changes without writing
 *   --fix-format   auto-fix format errors; print warnings report
 *   --interactive  fix format errors AND prompt for each warning file
 *   --report=FILE  write warnings to FILE (default: frontmatter-review.md)
 *   dir            target directory (default: templates/)
 */
import fs from "node:fs";
import path from "node:path";
import readline from "node:readline/promises";
import { fileURLToPath } from "node:url";
import { detectAssetType, validateFrontmatter } from "../lib/validate/frontmatter.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const TEMPLATES = path.join(ROOT, "templates");

const argv = process.argv.slice(2);
const dryRun = !argv.includes("--fix-format") && !argv.includes("--interactive");
const fixFormat = argv.includes("--fix-format") || argv.includes("--interactive");
const interactive = argv.includes("--interactive");
const reportArg = argv.find((a) => a.startsWith("--report="));
const reportFile = reportArg ? reportArg.slice("--report=".length) : null;
const targetDir = argv.find((a) => !a.startsWith("--")) ?? TEMPLATES;

/**
 * @param {string} dir
 * @returns {Generator<string>}
 */
function* walkMd(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) yield* walkMd(full);
    else if (entry.isFile() && entry.name.endsWith(".md")) yield full;
  }
}

/** @type {{ absPath: string, relPath: string, desc: string, normalized: string }[]} */
const fixed = [];

/** @type {Record<string, string[]>} */
const warnBuckets = {
  "agents without `tools` (unrestricted tool access)": [],
  "agents without `model` (inherits from caller)": [],
  "skills without `allowed-tools` (unrestricted tool access)": [],
  "rules without `paths` (applied globally)": [],
};

for (const absPath of walkMd(targetDir)) {
  const relPath = path.relative(TEMPLATES, absPath);
  const type = detectAssetType(relPath);
  if (!type) continue;

  const content = fs.readFileSync(absPath, "utf8");
  const { valid, errors, warnings, normalized } = validateFrontmatter(content, type);

  if (!valid) {
    fixed.push({ absPath, relPath, desc: errors.join("; "), normalized });
    if (fixFormat && !dryRun) {
      fs.writeFileSync(absPath, normalized);
    }
  }

  for (const w of warnings) {
    if (w.includes("tools") && type === "agent")
      warnBuckets["agents without `tools` (unrestricted tool access)"].push(relPath);
    if (w.includes("allowed-tools") && type === "skill")
      warnBuckets["skills without `allowed-tools` (unrestricted tool access)"].push(relPath);
    if (w.includes("model"))
      warnBuckets["agents without `model` (inherits from caller)"].push(relPath);
    if (w.includes("paths"))
      warnBuckets["rules without `paths` (applied globally)"].push(relPath);
  }
}

// --- Print auto-fix report ---
console.log("\n=== AUTO-FIXED (format errors) ===");
if (fixed.length === 0) {
  console.log("(none)");
} else {
  for (const { relPath, desc } of fixed) {
    const tag = dryRun ? "[dry-run]" : "[fixed]";
    console.log(`${tag} ${relPath}`);
    console.log(`        ${desc}`);
  }
}

// --- Print warnings report ---
console.log("\n=== REVIEW NEEDED (missing optional fields) ===");
let hasWarnings = false;
/** @type {string[]} */
const reportLines = [];
for (const [category, files] of Object.entries(warnBuckets)) {
  if (files.length === 0) continue;
  hasWarnings = true;
  console.log(`\n${category}:`);
  reportLines.push(`\n### ${category}`);
  for (const f of files) {
    console.log(`  ${f}`);
    reportLines.push(`- \`${f}\``);
  }
}
if (!hasWarnings) console.log("(none)");

// --- Write report file ---
if (reportFile && hasWarnings) {
  const header = `# Frontmatter Review — Missing Optional Fields\n\nGenerated by normalize-frontmatter.mjs. Resolve each entry by editing the file or intentionally leaving it open.\n`;
  fs.writeFileSync(reportFile, header + reportLines.join("\n") + "\n");
  console.log(`\nReport written to ${reportFile}`);
}

// --- Interactive mode ---
if (interactive && hasWarnings) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

  for (const [category, files] of Object.entries(warnBuckets)) {
    if (files.length === 0) continue;
    console.log(`\n--- ${category} ---`);
    for (const relPath of files) {
      const absPath = path.join(TEMPLATES, relPath);
      const answer = await rl.question(
        `  ${relPath}\n  Add missing field? [enter value or ENTER to skip]: `
      );
      if (!answer.trim()) {
        console.log("  → skipped");
        continue;
      }
      // Determine which field and value to add
      let field = "";
      if (category.includes("`tools`")) field = "tools";
      else if (category.includes("`allowed-tools`")) field = "allowed-tools";
      else if (category.includes("`model`")) field = "model";
      else if (category.includes("`paths`")) field = "paths";

      if (!field) continue;

      const content = fs.readFileSync(absPath, "utf8");
      const fmEnd = content.indexOf("\n---\n", 4) + 5;
      const newFm = content.slice(0, fmEnd - 5) + `\n${field}: ${answer.trim()}` + content.slice(fmEnd - 5);
      fs.writeFileSync(absPath, newFm);
      console.log(`  → ${field}: ${answer.trim()} added`);
    }
  }

  rl.close();
}

// --- Summary ---
const totalWarnings = Object.values(warnBuckets).flat().length;
console.log(`\nSummary: ${fixed.length} format error(s)${dryRun ? " [not written — dry-run]" : " fixed"}, ${totalWarnings} warning(s) to review`);
if (dryRun && fixed.length > 0) {
  console.log("Run with --fix-format to apply format fixes.");
}
```

- [ ] **Step 2: Run dry-run to preview all issues**

```bash
node scripts/normalize-frontmatter.mjs --dry-run
```

Read the full output. Verify the `=== AUTO-FIXED ===` section lists the 24 ECC agents with JSON array tools (and any ag-kit agents with quoted MCP tools). Verify the `=== REVIEW NEEDED ===` section lists agents/skills/rules with missing optional fields.

- [ ] **Step 3: Apply format fixes**

```bash
node scripts/normalize-frontmatter.mjs --fix-format
```

Expected output ends with: `N format error(s) fixed, M warning(s) to review`.

- [ ] **Step 4: Review and resolve warnings interactively**

```bash
node scripts/normalize-frontmatter.mjs --interactive
```

For each prompt:
- **agents without `tools`**: if the agent is a general-purpose agent (documentation-writer, product-manager, product-owner, etc.) that needs any tool — enter a specific set like `Read, Grep, Glob, Bash, Write, Edit` or press ENTER to leave unrestricted (intentional).
- **agents without `model`**: enter `sonnet` for most agents; press ENTER to leave as inheriting from caller (intentional for some orchestrator-dispatched agents).
- **skills without `allowed-tools`**: enter relevant tools or ENTER to leave unrestricted.
- **rules without `paths`**: ENTER to leave global (most rules should apply globally).

- [ ] **Step 5: Verify templates still parse correctly**

```bash
npm test
```

Expected: all tests pass (the validator unit tests confirm templates are now compliant).

- [ ] **Step 6: Spot-check a fixed ECC agent**

```bash
head -8 templates/ecc/agents/go-reviewer.md
```

Expected: `tools: Read, Grep, Glob, Bash` (clean CSV, no brackets or quotes).

- [ ] **Step 7: Spot-check a fixed ag-kit agent with MCP tools**

```bash
head -8 templates/ag-kit/agents/explorer-agent.md
```

Expected: `tools: Read, Grep, Glob, Bash, mcp__code-review-graph__semantic_search_nodes_tool, ...` (no quotes around MCP tools).

- [ ] **Step 8: Commit fixed templates and script**

```bash
git add templates/ scripts/normalize-frontmatter.mjs
git commit -m "fix: normalize frontmatter in all distributed templates to Claude Code spec"
```

---

## Task 4: Safety net in `lib/apply.mjs`

**Files:**
- Modify: `lib/apply.mjs`

**Interfaces:**
- Consumes: `detectAssetType`, `validateFrontmatter` from `lib/validate/frontmatter.mjs`
- Produces: any `.md` artifact written to a target project has spec-compliant frontmatter

- [ ] **Step 1: Write test for apply normalization**

Add a new test file `tests/apply-frontmatter.test.mjs`:

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { applyPlan } from "../lib/apply.mjs";

/** @param {object} overrides @returns {import('../lib/plan.mjs').HarnessPlan} */
function plan(artifacts, gitignore = []) {
  return { artifacts, gitignore, notes: [] };
}

test("apply: agent with JSON array tools → written with normalized CSV", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "aia-apply-fm-"));
  try {
    const content = '---\nname: foo\ndescription: bar\ntools: ["Read", "Grep"]\n---\nBody.\n';
    const result = applyPlan(
      plan([{ id: "a1", relPath: ".claude/agents/foo.md", content, defaultSelected: true, contextCost: 0 }]),
      dir,
      { dryRun: false }
    );
    assert.deepEqual(result.errors, []);
    const written = fs.readFileSync(path.join(dir, ".claude/agents/foo.md"), "utf8");
    assert.match(written, /^tools: Read, Grep$/m);
    assert.doesNotMatch(written, /\[/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("apply: clean agent frontmatter → written unchanged", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "aia-apply-fm-"));
  try {
    const content = "---\nname: foo\ndescription: bar\ntools: Read, Grep\nmodel: sonnet\n---\nBody.\n";
    applyPlan(
      plan([{ id: "a1", relPath: ".claude/agents/foo.md", content, defaultSelected: true, contextCost: 0 }]),
      dir,
      { dryRun: false }
    );
    const written = fs.readFileSync(path.join(dir, ".claude/agents/foo.md"), "utf8");
    assert.equal(written, content);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("apply: non-agent md (e.g. MANIFEST) → written unchanged", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "aia-apply-fm-"));
  try {
    const content = "# Manifest\n\nSome content.\n";
    applyPlan(
      plan([{ id: "m1", relPath: ".claude/MANIFEST.md", content, defaultSelected: true, contextCost: 0 }]),
      dir,
      { dryRun: false }
    );
    const written = fs.readFileSync(path.join(dir, ".claude/MANIFEST.md"), "utf8");
    assert.equal(written, content);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
node --test tests/apply-frontmatter.test.mjs
```

Expected: first test FAILS — apply writes the JSON array as-is.

- [ ] **Step 3: Update `lib/apply.mjs`**

Add import at the top (after existing imports):

```js
import { detectAssetType, validateFrontmatter } from "./validate/frontmatter.mjs";
```

In `applyPlan`, the content resolution block (around line 71) currently reads:

```js
let content = a.content;
if (content == null && a.copyFrom) content = readText(a.copyFrom);
if (content == null) {
  result.errors.push({ path: a.relPath, error: "no inline content and source file missing" });
  continue;
}
```

Extend it by adding normalization right after content is resolved (before the `fs.existsSync` check):

```js
let content = a.content;
if (content == null && a.copyFrom) content = readText(a.copyFrom);
if (content == null) {
  result.errors.push({ path: a.relPath, error: "no inline content and source file missing" });
  continue;
}

// Normalize frontmatter for distributed .md assets before writing.
// Errors are auto-fixed silently; warnings are a dev-time concern already
// resolved in templates by scripts/normalize-frontmatter.mjs.
if (a.relPath.endsWith(".md")) {
  // relPath in target project is like .claude/agents/foo.md — extract the
  // segment that detectAssetType understands (agents/, skills/, etc.)
  const segMatch = a.relPath.match(/\/(agents|skills|commands|rules)\//);
  if (segMatch) {
    const fakeRel = `x/${segMatch[1]}/${path.basename(a.relPath)}`;
    const type = detectAssetType(fakeRel);
    if (type) {
      const { valid, errors: fmErrors, normalized } = validateFrontmatter(content, type);
      if (!valid) {
        process.stderr.write(
          `[apply] frontmatter: ${a.relPath}: auto-fixed: ${fmErrors.join("; ")}\n`
        );
        content = normalized;
      }
    }
  }
}
```

- [ ] **Step 4: Run tests and verify they pass**

```bash
node --test tests/apply-frontmatter.test.mjs
```

Expected: all 3 tests pass.

- [ ] **Step 5: Run full test suite**

```bash
npm test
```

Expected: all pass.

- [ ] **Step 6: Commit**

```bash
git add lib/apply.mjs tests/apply-frontmatter.test.mjs
git commit -m "feat(apply): auto-normalize agent/skill/command frontmatter before writing to target"
```

---

## Task 5: PreToolUse hook + compliance tests + register in settings

**Files:**
- Create: `.claude/hooks/validate-template-frontmatter.mjs`
- Create: `tests/hook-validate-template-frontmatter.test.mjs`
- Modify: `.claude/settings.json`

**Interfaces:**
- Consumes: `detectAssetType`, `validateFrontmatter` from `lib/validate/frontmatter.mjs`
- Hook event: `PreToolUse`, matcher `Write|Edit`
- Returns PreToolUse schema: `{ hookSpecificOutput: { permissionDecision, updatedInput? }, systemMessage? }`

- [ ] **Step 1: Write failing hook compliance tests**

```js
// tests/hook-validate-template-frontmatter.test.mjs
/**
 * Schema compliance tests for .claude/hooks/validate-template-frontmatter.mjs
 *
 * The hook fires on PreToolUse for Write|Edit on templates/**\/*.md.
 * - Non-.md or non-templates paths → silent allow (exit 0, no stdout)
 * - Valid frontmatter → silent allow (exit 0, no stdout)
 * - Format errors → allow with updatedInput (normalized) + systemMessage
 * - Warnings only → allow with systemMessage advisory
 *
 * Run: node --test tests/hook-validate-template-frontmatter.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { runHook, runHookRaw } from "./hook-runner.mjs";
import { validatePreToolUseOutput } from "../lib/validate/hook-schema.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const HOOK = path.join(ROOT, ".claude", "hooks", "validate-template-frontmatter.mjs");

/** @param {import('./hook-runner.mjs').HookResult} r */
function assertSilentAllow({ stdout, exitCode }) {
  const v = validatePreToolUseOutput(stdout, exitCode);
  assert.equal(v.valid, true, `Schema invalid: ${v.errors.join("; ")}`);
  assert.equal(exitCode, 0);
  assert.equal(stdout.trim(), "", "expected empty stdout for silent allow");
}

/** @param {import('./hook-runner.mjs').HookResult} r @returns {any} */
function assertAllowWithPayload({ stdout, exitCode }) {
  const v = validatePreToolUseOutput(stdout, exitCode);
  assert.equal(v.valid, true, `Schema invalid: ${v.errors.join("; ")}`);
  assert.equal(exitCode, 0);
  assert.ok(stdout.trim().length > 0, "expected non-empty stdout");
  return JSON.parse(stdout);
}

const projectDir = ROOT;

// --- Non-template paths → noop ---

test("noop: non-.md file (Write on .mjs) → silent allow", () => {
  const event = {
    hook_event_name: "PreToolUse",
    tool_name: "Write",
    tool_input: { file_path: path.join(projectDir, "templates/hooks/secret-scan.mjs"), content: "// hook" },
  };
  assertSilentAllow(runHook(HOOK, event, { env: { CLAUDE_PROJECT_DIR: projectDir } }));
});

test("noop: file outside templates/ (Write on lib/) → silent allow", () => {
  const event = {
    hook_event_name: "PreToolUse",
    tool_name: "Write",
    tool_input: {
      file_path: path.join(projectDir, "lib/apply.mjs"),
      content: "// some code",
    },
  };
  assertSilentAllow(runHook(HOOK, event, { env: { CLAUDE_PROJECT_DIR: projectDir } }));
});

test("noop: unrecognised .md path (MANIFEST.md) → silent allow", () => {
  const event = {
    hook_event_name: "PreToolUse",
    tool_name: "Write",
    tool_input: {
      file_path: path.join(projectDir, "templates/ag-kit/MANIFEST.md"),
      content: "# Manifest\n",
    },
  };
  assertSilentAllow(runHook(HOOK, event, { env: { CLAUDE_PROJECT_DIR: projectDir } }));
});

test("noop: empty stdin → silent allow", () => {
  assertSilentAllow(runHookRaw(HOOK, "", { env: { CLAUDE_PROJECT_DIR: projectDir } }));
});

// --- Valid frontmatter → silent allow ---

test("valid agent frontmatter → silent allow", () => {
  const event = {
    hook_event_name: "PreToolUse",
    tool_name: "Write",
    tool_input: {
      file_path: path.join(projectDir, "templates/ecc/agents/go-reviewer.md"),
      content: "---\nname: go-reviewer\ndescription: Go expert.\ntools: Read, Grep\nmodel: sonnet\n---\nBody.\n",
    },
  };
  assertSilentAllow(runHook(HOOK, event, { env: { CLAUDE_PROJECT_DIR: projectDir } }));
});

// --- Format errors → allow + updatedInput with normalized content ---

test("agent with JSON array tools → allow, updatedInput has normalized CSV", () => {
  const badContent = '---\nname: go-reviewer\ndescription: Go expert.\ntools: ["Read", "Grep"]\nmodel: sonnet\n---\nBody.\n';
  const event = {
    hook_event_name: "PreToolUse",
    tool_name: "Write",
    tool_input: {
      file_path: path.join(projectDir, "templates/ecc/agents/go-reviewer.md"),
      content: badContent,
    },
  };
  const parsed = assertAllowWithPayload(runHook(HOOK, event, { env: { CLAUDE_PROJECT_DIR: projectDir } }));
  assert.equal(parsed.hookSpecificOutput?.permissionDecision, "allow");
  assert.ok(parsed.hookSpecificOutput?.updatedInput?.content, "expected updatedInput.content");
  assert.match(parsed.hookSpecificOutput.updatedInput.content, /^tools: Read, Grep$/m);
  assert.doesNotMatch(parsed.hookSpecificOutput.updatedInput.content, /\[/);
  assert.ok(typeof parsed.systemMessage === "string" && parsed.systemMessage.length > 0);
});

test("agent with quoted MCP tools → allow, updatedInput cleaned", () => {
  const badContent = '---\nname: foo\ndescription: bar.\ntools: Read, "mcp__foo__bar"\nmodel: sonnet\n---\nBody.\n';
  const event = {
    hook_event_name: "PreToolUse",
    tool_name: "Write",
    tool_input: {
      file_path: path.join(projectDir, "templates/ag-kit/agents/foo.md"),
      content: badContent,
    },
  };
  const parsed = assertAllowWithPayload(runHook(HOOK, event, { env: { CLAUDE_PROJECT_DIR: projectDir } }));
  assert.equal(parsed.hookSpecificOutput?.permissionDecision, "allow");
  assert.match(parsed.hookSpecificOutput.updatedInput.content, /^tools: Read, mcp__foo__bar$/m);
});

// Edit tool: new_string with format error

test("Edit tool: new_string with JSON array → allow, updatedInput normalizes new_string", () => {
  const event = {
    hook_event_name: "PreToolUse",
    tool_name: "Edit",
    tool_input: {
      file_path: path.join(projectDir, "templates/ecc/agents/go-reviewer.md"),
      old_string: 'tools: ["Read"]',
      new_string: 'tools: ["Read", "Grep", "Glob"]',
    },
  };
  const parsed = assertAllowWithPayload(runHook(HOOK, event, { env: { CLAUDE_PROJECT_DIR: projectDir } }));
  assert.equal(parsed.hookSpecificOutput?.permissionDecision, "allow");
  assert.match(parsed.hookSpecificOutput.updatedInput.new_string, /^tools: Read, Grep, Glob$/m);
});

// --- Warnings only → allow + systemMessage advisory, no updatedInput ---

test("agent missing tools → allow + systemMessage advisory", () => {
  const event = {
    hook_event_name: "PreToolUse",
    tool_name: "Write",
    tool_input: {
      file_path: path.join(projectDir, "templates/ag-kit/agents/foo.md"),
      content: "---\nname: foo\ndescription: bar.\nmodel: sonnet\n---\nBody.\n",
    },
  };
  const parsed = assertAllowWithPayload(runHook(HOOK, event, { env: { CLAUDE_PROJECT_DIR: projectDir } }));
  assert.equal(parsed.hookSpecificOutput?.permissionDecision, "allow");
  assert.equal(parsed.hookSpecificOutput?.updatedInput, undefined, "no updatedInput for warnings-only");
  assert.ok(typeof parsed.systemMessage === "string");
  assert.match(parsed.systemMessage, /tools/);
});
```

- [ ] **Step 2: Run failing tests to verify**

```bash
node --test tests/hook-validate-template-frontmatter.test.mjs
```

Expected: all fail with "ERR_MODULE_NOT_FOUND" — hook file doesn't exist yet.

- [ ] **Step 3: Implement `.claude/hooks/validate-template-frontmatter.mjs`**

```js
#!/usr/bin/env node
/**
 * PreToolUse hook — validates and auto-normalizes YAML frontmatter when
 * writing or editing template markdown files in templates/**\/*.md.
 *
 * Write tool: validates `tool_input.content`; returns updatedInput if fixed.
 * Edit  tool: validates `tool_input.new_string` as a fragment; returns
 *             updatedInput.new_string if fixed. (Fragment-only check: does not
 *             reconstruct the full file. Full normalization happens via
 *             scripts/normalize-frontmatter.mjs and lib/apply.mjs.)
 *
 * Exit 0 always — never blocks the write; format errors are auto-fixed via
 * updatedInput; warnings are surfaced as systemMessage advisories.
 *
 * @hook PreToolUse
 */
import path from "node:path";
import { fileURLToPath } from "node:url";
import { detectAssetType, validateFrontmatter } from "../../lib/validate/frontmatter.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

/** @param {any} obj @returns {void} */
function exit(obj) {
  if (obj && Object.keys(obj).length > 0) process.stdout.write(JSON.stringify(obj) + "\n");
  process.exit(0);
}

let event;
try {
  const raw = await new Promise((resolve) => {
    let buf = "";
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (d) => (buf += d));
    process.stdin.on("end", () => resolve(buf));
  });
  if (!raw.trim()) exit({});
  event = JSON.parse(raw);
} catch {
  exit({});
}

const toolName = event?.tool_name ?? "";
const toolInput = event?.tool_input ?? {};
const filePath = toolInput.file_path ?? "";

// Only intercept Write and Edit on .md files inside templates/
if (toolName !== "Write" && toolName !== "Edit") exit({});
if (!filePath.endsWith(".md")) exit({});

const projectDir = process.env.CLAUDE_PROJECT_DIR ?? ROOT;
const templatesDir = path.join(projectDir, "templates");

let relPath;
try {
  const rel = path.relative(templatesDir, filePath);
  if (rel.startsWith("..")) exit({}); // outside templates/
  relPath = rel;
} catch {
  exit({});
}

const type = detectAssetType(relPath);
if (!type) exit({});

// Determine the content fragment to validate
const isWrite = toolName === "Write";
const fragment = isWrite ? (toolInput.content ?? "") : (toolInput.new_string ?? "");

const { valid, errors, warnings, normalized } = validateFrontmatter(fragment, type);

if (valid && warnings.length === 0) exit({});

/** @type {any} */
const output = {
  hookSpecificOutput: { permissionDecision: "allow" },
};

if (!valid) {
  // Auto-fix: return normalized content via updatedInput
  const updatedInput = { ...toolInput };
  if (isWrite) {
    updatedInput.content = normalized;
  } else {
    updatedInput.new_string = normalized;
  }
  output.hookSpecificOutput.updatedInput = updatedInput;
  output.systemMessage = `[frontmatter] auto-fixed ${errors.length} error(s) in ${path.basename(filePath)}: ${errors.join("; ")}`;
}

if (warnings.length > 0) {
  const advisory = warnings.map((w) => `  • ${w}`).join("\n");
  output.systemMessage = (output.systemMessage ? output.systemMessage + "\n" : "")
    + `[frontmatter] advisory for ${path.basename(filePath)}:\n${advisory}`;
}

exit(output);
```

- [ ] **Step 4: Run hook compliance tests**

```bash
node --test tests/hook-validate-template-frontmatter.test.mjs
```

Expected: all tests pass.

- [ ] **Step 5: Run full test suite**

```bash
npm test
```

Expected: all pass.

- [ ] **Step 6: Register hook in `.claude/settings.json`**

Open `.claude/settings.json`. The current `"hooks"` object has `"PostToolUse"` and `"Stop"` keys. Add a `"PreToolUse"` key:

```json
{
  "hooks": {
    "PreToolUse": [
      {
        "matcher": "Write|Edit",
        "hooks": [
          {
            "type": "command",
            "command": "\"$CLAUDE_PROJECT_DIR/.claude/hooks/node-run.sh\" \"$CLAUDE_PROJECT_DIR/.claude/hooks/validate-template-frontmatter.mjs\"",
            "timeout": 10
          }
        ]
      }
    ],
    "PostToolUse": [
      ...existing entries...
    ],
    "Stop": [
      ...existing entries...
    ]
  }
}
```

The full updated hooks section must preserve existing PostToolUse and Stop entries exactly.

- [ ] **Step 7: Smoke-test hook registration**

Write a small test agent file with bad frontmatter and verify the hook fires. In a terminal where Claude Code would use this settings.json:

```bash
# Verify settings parses as valid JSON
node -e "JSON.parse(require('fs').readFileSync('.claude/settings.json','utf8')); console.log('valid JSON')"
```

Expected: `valid JSON`

- [ ] **Step 8: Run full test suite one final time**

```bash
npm test
```

Expected: all pass.

- [ ] **Step 9: Commit**

```bash
git add .claude/hooks/validate-template-frontmatter.mjs tests/hook-validate-template-frontmatter.test.mjs .claude/settings.json
git commit -m "feat: add PreToolUse hook to validate template frontmatter and auto-fix format errors"
```

---

## Self-Review

**Spec coverage:**
- ✅ `lib/validate/frontmatter.mjs` — Task 1
- ✅ `lib/validate/index.mjs` — Task 1
- ✅ ECC transform normalization — Task 2
- ✅ Normalize script dev tool — Task 3 (including `--dry-run`, `--fix-format`, `--interactive`, `--report`)
- ✅ One-time template fix + commit — Task 3 steps 2–8
- ✅ `lib/apply.mjs` safety net — Task 4
- ✅ PreToolUse hook — Task 5
- ✅ Hook compliance tests — Task 5
- ✅ `.claude/settings.json` registration — Task 5

**Spec note:** The spec mentioned `lib/agkit/transform.mjs` as a modify target. On closer inspection, `mapAgentTools()` already produces clean CSV (builds a `string[]` then joins with `, `) — no format issue in its output path. Quoted MCP tools in existing templates are a historical artifact fixed by the Task 3 normalize run. Agkit transform requires no change.

**Type consistency:**
- `AssetType` = `'agent'|'skill'|'command'|'rule'|null` — used consistently in Tasks 1, 2, 4, 5
- `validateFrontmatter` signature identical in Task 1 definition and Task 4/5 consumption
- `detectAssetType` returns `AssetType` — used consistently in Task 3 (script) and Task 5 (hook)
- `FrontmatterResult.normalized` — used in Task 4 (`content = normalized`) and Task 5 (`updatedInput.content = normalized`)

**No placeholders:** all code blocks are complete and runnable.
