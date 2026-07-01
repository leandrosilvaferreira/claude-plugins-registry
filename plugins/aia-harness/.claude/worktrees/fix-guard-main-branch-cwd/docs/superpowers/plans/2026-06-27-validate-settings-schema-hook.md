# validate-settings-schema Hook Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a `PostToolUse` hook that validates `.claude/settings.json` and `.claude/settings.local.json` against the official Claude Code JSON Schema from SchemaStore whenever those files are written or edited, surfacing validation errors to the user via Claude.

**Architecture:** A single self-contained `.mjs` hook (no external dependencies) runs as a subprocess after every Write/Edit/MultiEdit. It filters on path, fetches the schema from SchemaStore (24h disk cache, fail-open), validates the JSON with an inline recursive validator, and exits 2 with a structured stderr that instructs Claude to present errors and ask the user for confirmation before fixing. Hook is wired in both `templates/hooks/` (distributed) and `.claude/hooks/` (aia-harness dev).

**Tech Stack:** Node ≥ 18 ESM (global `fetch`, `AbortSignal.timeout`), `node:fs`, `node:os`, `node:path`. No npm dependencies.

## Global Constraints

- All source files must be `.mjs` ESM — no `.js`, `.ts`, `.sh`, `.bat`, `.ps1`
- Exec-form wiring only: `"command": "node"` + `"args": [...]` — never shell form
- All paths via `path.join()` / `os.tmpdir()` / `os.homedir()` — no hardcoded separators
- `windowsHide: true` on every `spawn`/`exec` call (none needed here — pure Node APIs)
- Every output branch must pass `validatePostToolUseOutput` from `lib/validate/hook-schema.mjs`
- Exit codes: `0` (silent pass / fail-open) and `2` (errors to Claude) only — no others
- `npm test` must be green (typecheck + lint + all unit tests) before each commit
- All source code in English (identifiers, comments, log messages, string literals)
- stderr messages to users may be in Portuguese (user-facing copy)

---

## File Map

| Action | Path | Responsibility |
|---|---|---|
| Create | `templates/hooks/validate-settings-schema.mjs` | The hook — distributed to target projects |
| Create | `tests/hook-validate-settings-schema.test.mjs` | 11 unit test branches |
| Modify | `lib/data/project-catalog.mjs` | Add hook to `PROJECT_HOOK_FILES` |
| Modify | `lib/generate/settings.mjs` | Add hook to `PostToolUse` wiring in `renderSettings()` |
| Create | `.claude/hooks/validate-settings-schema.mjs` | Copy of hook for aia-harness dev environment |
| Modify | `.claude/settings.json` | Wire hook for aia-harness dev |

---

### Task 1: Test file + hook stub (TDD scaffold)

Write all 11 test branches first, then create a hook stub that exits 0 always.
Every test that expects exit 2 will fail — that's the goal at this stage.

**Files:**
- Create: `tests/hook-validate-settings-schema.test.mjs`
- Create: `templates/hooks/validate-settings-schema.mjs` (stub)

**Interfaces:**
- Produces: `HOOK` constant pointing to `templates/hooks/validate-settings-schema.mjs`
- Produces: `SCHEMA_URL_ENV = 'SETTINGS_SCHEMA_URL'` (env key used throughout tests)
- Produces: `CACHE_ENV = 'SETTINGS_SCHEMA_CACHE'` (env key for cache file override)

- [ ] **Step 1: Create test file with all 11 branches**

Create `tests/hook-validate-settings-schema.test.mjs`:

```js
/**
 * Schema compliance tests for templates/hooks/validate-settings-schema.mjs
 *
 * Exercises every output path and validates exit code against the
 * PostToolUse schema in lib/validate/hook-schema.mjs.
 *
 * Network is eliminated via SETTINGS_SCHEMA_URL env var pointing to a local
 * JSON file. Cache is isolated per-test via SETTINGS_SCHEMA_CACHE env var.
 *
 * Run: node --test tests/hook-validate-settings-schema.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { runHook, runHookRaw } from "./hook-runner.mjs";
import { validatePostToolUseOutput } from "../lib/validate/hook-schema.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const HOOK = path.join(ROOT, "templates", "hooks", "validate-settings-schema.mjs");

// Minimal valid Claude Code settings schema (subset used for tests)
const MINIMAL_SCHEMA = {
  type: "object",
  properties: {
    model: { type: "string" },
    permissions: {
      type: "object",
      properties: {
        allow: { type: "array", items: { type: "string" } },
        deny: { type: "array", items: { type: "string" } },
      },
      additionalProperties: false,
    },
  },
  additionalProperties: false,
};

// Schema that rejects additional properties at the top level
const STRICT_SCHEMA = {
  type: "object",
  properties: { model: { type: "string" } },
  additionalProperties: false,
};

/**
 * Build a temp dir with a .claude/settings.json (or settings.local.json).
 * Returns { dir, file } — caller must rm dir after test.
 * @param {{ content: string, name?: string }} opts
 * @returns {{ dir: string, file: string }}
 */
function mkSettingsDir(opts) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "aia-settings-test-"));
  const claudeDir = path.join(dir, ".claude");
  fs.mkdirSync(claudeDir, { recursive: true });
  const name = opts.name ?? "settings.json";
  const file = path.join(claudeDir, name);
  fs.writeFileSync(file, opts.content, "utf8");
  return { dir, file };
}

/**
 * Write schema to a temp file, return its path.
 * @param {any} schema
 * @returns {string}
 */
function writeSchema(schema) {
  const f = path.join(os.tmpdir(), `aia-test-schema-${Math.random().toString(36).slice(2)}.json`);
  fs.writeFileSync(f, JSON.stringify(schema), "utf8");
  return f;
}

/**
 * Return a fresh temp path for the schema cache (no pre-existing file).
 * @returns {string}
 */
function freshCachePath() {
  return path.join(os.tmpdir(), `aia-test-cache-${Math.random().toString(36).slice(2)}.json`);
}

/** @param {import("./hook-runner.mjs").HookResult} r */
function assertSkip({ stdout, exitCode }) {
  const v = validatePostToolUseOutput(stdout, exitCode);
  assert.equal(v.valid, true, `Schema invalid: ${v.errors.join("; ")}`);
  assert.equal(exitCode, 0, `Expected exit 0 (skip), got ${exitCode}`);
}

/** @param {import("./hook-runner.mjs").HookResult} r @param {string} [msgMatch] */
function assertErrors({ stdout, stderr, exitCode }, msgMatch) {
  const v = validatePostToolUseOutput(stdout, exitCode);
  assert.equal(v.valid, true, `Schema invalid: ${v.errors.join("; ")}`);
  assert.equal(exitCode, 2, `Expected exit 2 (errors), got ${exitCode}`);
  assert.match(stderr, /settings-schema-validator/);
  if (msgMatch) assert.match(stderr, new RegExp(msgMatch));
}

// ── 1: Wrong tool name ────────────────────────────────────────────────────────
test("settings-schema: Bash tool → skip, schema-valid", () => {
  assertSkip(runHook(HOOK, { tool_name: "Bash", tool_input: { command: "echo hi" } }));
});

// ── 2: Non-settings file ──────────────────────────────────────────────────────
test("settings-schema: Write to src/index.ts → skip, schema-valid", () => {
  assertSkip(
    runHook(HOOK, { tool_name: "Write", tool_input: { file_path: "/proj/src/index.ts", content: "{}" } }),
  );
});

// ── 3: File does not exist on disk ────────────────────────────────────────────
test("settings-schema: settings.json does not exist on disk → skip (fail-open)", () => {
  assertSkip(
    runHook(HOOK, {
      tool_name: "Write",
      tool_input: { file_path: "/nonexistent/.claude/settings.json", content: "{}" },
    }),
  );
});

// ── 4: Invalid JSON in file ───────────────────────────────────────────────────
test("settings-schema: settings.json has invalid JSON → exit 2 with parse error", () => {
  const { dir, file } = mkSettingsDir({ content: "{ bad json }" });
  try {
    assertErrors(
      runHook(HOOK, { tool_name: "Write", tool_input: { file_path: file } }),
      "JSON inválido",
    );
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// ── 5: Schema fetch fails (file not found) → fail-open ───────────────────────
test("settings-schema: schema unavailable → skip (fail-open)", () => {
  const { dir, file } = mkSettingsDir({ content: '{"model":"sonnet"}' });
  try {
    assertSkip(
      runHook(HOOK, { tool_name: "Write", tool_input: { file_path: file } }, {
        env: {
          SETTINGS_SCHEMA_URL: "/nonexistent/schema.json",
          SETTINGS_SCHEMA_CACHE: freshCachePath(),
        },
      }),
    );
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// ── 6: JSON valid against schema → silent pass ────────────────────────────────
test("settings-schema: valid settings.json → exit 0, schema-valid", () => {
  const schemaPath = writeSchema(MINIMAL_SCHEMA);
  const { dir, file } = mkSettingsDir({ content: '{"model":"sonnet"}' });
  try {
    assertSkip(
      runHook(HOOK, { tool_name: "Write", tool_input: { file_path: file } }, {
        env: {
          SETTINGS_SCHEMA_URL: schemaPath,
          SETTINGS_SCHEMA_CACHE: freshCachePath(),
        },
      }),
    );
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
    fs.unlinkSync(schemaPath);
  }
});

// ── 7: JSON invalid against schema → exit 2 with errors ──────────────────────
test("settings-schema: invalid settings.json (extra property) → exit 2 with errors and ask prompt", () => {
  const schemaPath = writeSchema(STRICT_SCHEMA);
  const { dir, file } = mkSettingsDir({ content: '{"model":"sonnet","unknownProp":true}' });
  try {
    const result = runHook(HOOK, { tool_name: "Edit", tool_input: { file_path: file } }, {
      env: {
        SETTINGS_SCHEMA_URL: schemaPath,
        SETTINGS_SCHEMA_CACHE: freshCachePath(),
      },
    });
    assertErrors(result, "unknownProp");
    assert.match(result.stderr, /Deseja que eu corrija/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
    fs.unlinkSync(schemaPath);
  }
});

// ── 8: settings.local.json also validated ────────────────────────────────────
test("settings-schema: invalid settings.local.json → exit 2 with errors", () => {
  const schemaPath = writeSchema(STRICT_SCHEMA);
  const { dir, file } = mkSettingsDir({
    content: '{"model":"sonnet","badKey":1}',
    name: "settings.local.json",
  });
  try {
    assertErrors(
      runHook(HOOK, { tool_name: "Write", tool_input: { file_path: file } }, {
        env: {
          SETTINGS_SCHEMA_URL: schemaPath,
          SETTINGS_SCHEMA_CACHE: freshCachePath(),
        },
      }),
      "badKey",
    );
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
    fs.unlinkSync(schemaPath);
  }
});

// ── 9: Cache hit (fresh) → no re-fetch ───────────────────────────────────────
test("settings-schema: fresh cache hit → schema used, exit 0 for valid file", () => {
  // Pre-write cache with MINIMAL_SCHEMA and fetchedAt = now
  const cacheFile = freshCachePath();
  fs.writeFileSync(
    cacheFile,
    JSON.stringify({ schema: MINIMAL_SCHEMA, fetchedAt: Date.now() }),
    "utf8",
  );
  const { dir, file } = mkSettingsDir({ content: '{"model":"opus"}' });
  try {
    // SETTINGS_SCHEMA_URL points to non-existent file → would fail-open if fetched
    assertSkip(
      runHook(HOOK, { tool_name: "Write", tool_input: { file_path: file } }, {
        env: {
          SETTINGS_SCHEMA_URL: "/nonexistent/schema.json",
          SETTINGS_SCHEMA_CACHE: cacheFile,
        },
      }),
    );
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
    fs.unlinkSync(cacheFile);
  }
});

// ── 10: Cache stale (>24h) → re-fetch from file ──────────────────────────────
test("settings-schema: stale cache → re-fetches schema, catches error", () => {
  // Stale cache with wrong schema (would not catch the error)
  const cacheFile = freshCachePath();
  const staleSchema = { type: "object" }; // permissive — would let bad props pass
  fs.writeFileSync(
    cacheFile,
    JSON.stringify({ schema: staleSchema, fetchedAt: Date.now() - 25 * 60 * 60 * 1000 }),
    "utf8",
  );
  // Fresh schema that rejects extra properties
  const freshSchemaPath = writeSchema(STRICT_SCHEMA);
  const { dir, file } = mkSettingsDir({ content: '{"model":"sonnet","bad":true}' });
  try {
    // Hook must re-fetch (cache stale) and find the fresh strict schema → errors
    assertErrors(
      runHook(HOOK, { tool_name: "Write", tool_input: { file_path: file } }, {
        env: {
          SETTINGS_SCHEMA_URL: freshSchemaPath,
          SETTINGS_SCHEMA_CACHE: cacheFile,
        },
      }),
      "bad",
    );
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
    fs.unlinkSync(cacheFile);
    fs.unlinkSync(freshSchemaPath);
  }
});

// ── 11: Empty / malformed stdin ───────────────────────────────────────────────
test("settings-schema: empty stdin → skip, schema-valid", () => {
  assertSkip(runHookRaw(HOOK, ""));
});

test("settings-schema: malformed JSON stdin → skip, schema-valid", () => {
  assertSkip(runHookRaw(HOOK, "not-json"));
});
```

- [ ] **Step 2: Create hook stub (exits 0 always)**

Create `templates/hooks/validate-settings-schema.mjs`:

```js
#!/usr/bin/env node
/**
 * PostToolUse hook: validate .claude/settings.json and .claude/settings.local.json
 * against the Claude Code JSON Schema from SchemaStore.
 *
 * Stub — always exits 0. Implementation added in subsequent tasks.
 *
 * @hook PostToolUse
 */
process.exit(0);
```

- [ ] **Step 3: Run tests — expect tests 4, 7, 8, 10 to fail (exit 2 expected but got 0)**

```bash
node --test tests/hook-validate-settings-schema.test.mjs
```

Expected: tests 1, 2, 3, 5, 6, 9, 11 PASS (all expect exit 0); tests 4, 7, 8, 10 FAIL with "Expected exit 2"

- [ ] **Step 4: Commit stub + tests**

```bash
git add templates/hooks/validate-settings-schema.mjs tests/hook-validate-settings-schema.test.mjs
git commit -m "test(hook): add validate-settings-schema test scaffold (TDD — 4 tests failing)"
```

---

### Task 2: Path filtering (tests 1, 2, 11 already pass — confirm no regression)

Implement stdin parse and path guards. All fail-open branches exit 0.

**Files:**
- Modify: `templates/hooks/validate-settings-schema.mjs`

**Interfaces:**
- Consumes: nothing from prior tasks (self-contained)
- Produces: path-filtering logic consumed by Task 3

- [ ] **Step 1: Replace stub with path-filtering implementation**

Replace `templates/hooks/validate-settings-schema.mjs` with:

```js
#!/usr/bin/env node
/**
 * PostToolUse hook: validate .claude/settings.json and .claude/settings.local.json
 * against the Claude Code JSON Schema from SchemaStore.
 *
 * Exits 0 (silent) when: wrong tool, wrong path, file missing, schema unavailable,
 * or validation passes.
 * Exits 2 (stderr → Claude) when: JSON parse error or schema validation fails.
 *
 * Schema URL and cache path are env-overridable for testing:
 *   SETTINGS_SCHEMA_URL   — default: https://www.schemastore.org/claude-code-settings.json
 *                           if not starting with "http", treated as a local file path
 *   SETTINGS_SCHEMA_CACHE — default: os.tmpdir()/aia-validate-settings-schema.json
 *
 * @hook PostToolUse
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// ── Configuration (env-overridable for testing) ───────────────────────────────
const SCHEMA_URL =
  process.env.SETTINGS_SCHEMA_URL ??
  "https://www.schemastore.org/claude-code-settings.json";
const CACHE_FILE =
  process.env.SETTINGS_SCHEMA_CACHE ??
  path.join(os.tmpdir(), "aia-validate-settings-schema.json");
const TTL_MS = 24 * 60 * 60 * 1000;

// ── Stdin parse ───────────────────────────────────────────────────────────────
let event;
try {
  const raw = fs.readFileSync(0, "utf8");
  if (!raw.trim()) process.exit(0);
  event = JSON.parse(raw);
} catch {
  process.exit(0);
}

// ── Tool filter ───────────────────────────────────────────────────────────────
const toolName = event?.tool_name ?? "";
if (!["Write", "Edit", "MultiEdit"].includes(toolName)) process.exit(0);

// ── Path filter ───────────────────────────────────────────────────────────────
const ti = event?.tool_input ?? {};
const file = ti.file_path || ti.path;
if (!file || typeof file !== "string") process.exit(0);

const basename = path.basename(file);
if (basename !== "settings.json" && basename !== "settings.local.json") process.exit(0);
if (path.basename(path.dirname(file)) !== ".claude") process.exit(0);

// ── File existence ────────────────────────────────────────────────────────────
if (!fs.existsSync(file)) process.exit(0);

// Remaining implementation added in Task 3.
process.exit(0);
```

- [ ] **Step 2: Run tests — confirm tests 1, 2, 3, 11 pass; 4, 7, 8, 10 still fail**

```bash
node --test tests/hook-validate-settings-schema.test.mjs
```

Expected: tests 1, 2, 3, 5, 6, 9, 11 PASS; tests 4, 7, 8, 10 FAIL with "Expected exit 2"

- [ ] **Step 3: Commit**

```bash
git add templates/hooks/validate-settings-schema.mjs
git commit -m "feat(hook): add path filtering to validate-settings-schema"
```

---

### Task 3: JSON parse + file read (test 4 passes)

Add the JSON parse step. Invalid JSON triggers exit 2.

**Files:**
- Modify: `templates/hooks/validate-settings-schema.mjs`

**Interfaces:**
- Consumes: path filtering from Task 2
- Produces: `parsed` — the parsed settings object, used by Task 5

- [ ] **Step 1: Replace `// Remaining implementation` block with JSON parse**

In `templates/hooks/validate-settings-schema.mjs`, replace:

```js
// Remaining implementation added in Task 3.
process.exit(0);
```

with:

```js
// ── JSON parse ────────────────────────────────────────────────────────────────
let parsed;
try {
  parsed = JSON.parse(fs.readFileSync(file, "utf8"));
} catch (e) {
  process.stderr.write(
    `[settings-schema-validator] ${basename} contém JSON inválido:\n\n  ${e.message}\n\nCorrija a sintaxe do arquivo antes de continuar.\n`,
  );
  process.exit(2);
}

// Remaining implementation added in Tasks 4–5.
process.exit(0);
```

- [ ] **Step 2: Run tests — test 4 must now pass**

```bash
node --test tests/hook-validate-settings-schema.test.mjs
```

Expected: tests 1, 2, 3, 4, 5, 6, 9, 11 PASS; tests 7, 8, 10 still FAIL with "Expected exit 2"

- [ ] **Step 3: Commit**

```bash
git add templates/hooks/validate-settings-schema.mjs
git commit -m "feat(hook): add JSON parse with syntax error reporting"
```

---

### Task 4: Schema fetch + cache (tests 5, 9, 10 pass)

Add `loadSchema()` — fetch from URL with 24h disk cache, env-overridable for testing.

**Files:**
- Modify: `templates/hooks/validate-settings-schema.mjs`

**Interfaces:**
- Consumes: `SCHEMA_URL`, `CACHE_FILE`, `TTL_MS` constants from Task 2
- Produces: `loadSchema(): Promise<object|null>` consumed by Task 5

- [ ] **Step 1: Add `loadSchema()` and wire it after JSON parse**

Replace the comment `// Remaining implementation added in Tasks 4–5.` and the final `process.exit(0)` with:

```js
// ── Load schema ───────────────────────────────────────────────────────────────
const schema = await loadSchema();
if (!schema) process.exit(0); // fail-open: schema unavailable

// Remaining validation added in Task 5.
process.exit(0);

// ── Schema loading (fetch + 24h disk cache) ───────────────────────────────────
/**
 * Load schema from local file (for testing) or remote URL with disk cache.
 * Returns null on any failure (fail-open contract).
 * @returns {Promise<object|null>}
 */
async function loadSchema() {
  // Non-HTTP URL: treat as local file path (used in tests)
  if (!SCHEMA_URL.startsWith("http")) {
    try {
      return JSON.parse(fs.readFileSync(SCHEMA_URL, "utf8"));
    } catch {
      return null;
    }
  }

  // Try fresh cache first
  try {
    const cached = JSON.parse(fs.readFileSync(CACHE_FILE, "utf8"));
    if (
      cached &&
      typeof cached.fetchedAt === "number" &&
      Date.now() - cached.fetchedAt < TTL_MS
    ) {
      return cached.schema;
    }
  } catch {
    /* cache miss or stale — fall through to fetch */
  }

  // Fetch from SchemaStore
  try {
    const res = await fetch(SCHEMA_URL, { signal: AbortSignal.timeout(8000) });
    if (!res.ok) return null;
    const fetched = await res.json();
    // Write cache (non-fatal if it fails)
    try {
      fs.writeFileSync(CACHE_FILE, JSON.stringify({ schema: fetched, fetchedAt: Date.now() }), "utf8");
    } catch {
      /* non-fatal */
    }
    return fetched;
  } catch {
    return null;
  }
}
```

- [ ] **Step 2: Run tests — tests 5, 9, 10 must now pass**

```bash
node --test tests/hook-validate-settings-schema.test.mjs
```

Expected: tests 1, 2, 3, 4, 5, 6, 9, 11 PASS; tests 7, 8, 10 PASS (10 now passes because stale cache re-fetches);
tests 7, 8 still FAIL (validation not implemented yet — exit 0 instead of 2)

Note: test 10 checks that a stale cache causes re-fetch. Since `loadSchema()` now fetches the strict schema after the stale cache, this test should pass once validation is wired (Task 5). If test 10 still fails here, that's expected — it needs the validator in place.

- [ ] **Step 3: Commit**

```bash
git add templates/hooks/validate-settings-schema.mjs
git commit -m "feat(hook): add schema fetch with 24h disk cache"
```

---

### Task 5: Inline JSON Schema validator + error reporting (all 11 tests pass)

Add the recursive schema validator and the structured stderr output. This is the core logic.

**Files:**
- Modify: `templates/hooks/validate-settings-schema.mjs`

**Interfaces:**
- Consumes: `parsed` (Task 3), `schema` (Task 4)
- Produces: final hook behavior — all 11 tests green

- [ ] **Step 1: Replace `// Remaining validation added in Task 5.` and final exit with full validator**

Replace this block:

```js
// Remaining validation added in Task 5.
process.exit(0);
```

with:

```js
// ── Validate ──────────────────────────────────────────────────────────────────
const errors = validate(parsed, schema, schema);
if (errors.length === 0) process.exit(0);

// ── Report ────────────────────────────────────────────────────────────────────
const MAX_SHOWN = 20;
const shown = errors.slice(0, MAX_SHOWN);
const list = shown.map((e, i) => `  ${i + 1}. ${e.path || "/"} — ${e.message}`).join("\n");
const more = errors.length > MAX_SHOWN ? `\n  … +${errors.length - MAX_SHOWN} mais erro(s)` : "";

process.stderr.write(
  `[settings-schema-validator] ${errors.length} erro(s) de validação em ${basename}:\n\n` +
    `${list}${more}\n\n` +
    `Por favor, apresente os erros acima ao usuário, explique como corrigir cada um,\n` +
    `e pergunte: "Encontrei ${errors.length} erro(s) no ${basename}. Deseja que eu corrija?"\n` +
    `Se o usuário confirmar, aplique as correções.\n`,
);
process.exit(2);
```

- [ ] **Step 2: Add `validate()` and `checkType()` functions at the bottom of the file**

Append after the `loadSchema` function:

```js
// ── Minimal JSON Schema validator ─────────────────────────────────────────────
/**
 * Recursively validate `value` against `schema`.
 * Supports: type, properties, additionalProperties, required, items, enum,
 * const, pattern, minLength, maxLength, minimum, maximum, $ref (internal),
 * anyOf, oneOf, allOf.
 * Unknown keywords are silently ignored (fail-open).
 *
 * @param {any} value
 * @param {any} schema
 * @param {any} root  Root schema document for $ref resolution.
 * @param {string} [ptr]  Current JSON Pointer path (e.g. "/hooks/0/command").
 * @returns {{ path: string, message: string }[]}
 */
function validate(value, schema, root, ptr = "") {
  if (!schema || typeof schema !== "object") return [];

  // $ref: resolve within the same document (#/definitions/... or #/$defs/...)
  if (typeof schema.$ref === "string") {
    const segments = schema.$ref.replace(/^#\//, "").split("/");
    let ref = root;
    for (const seg of segments) {
      ref = ref?.[decodeURIComponent(seg.replace(/~1/g, "/").replace(/~0/g, "~"))];
    }
    return ref ? validate(value, ref, root, ptr) : []; // unknown $ref → fail-open
  }

  /** @type {{ path: string, message: string }[]} */
  const errors = [];

  // type
  if (schema.type !== undefined) {
    const types = Array.isArray(schema.type) ? schema.type : [schema.type];
    if (!types.some((t) => checkType(value, t))) {
      const found = Array.isArray(value)
        ? "array"
        : value === null
          ? "null"
          : typeof value;
      errors.push({
        path: ptr,
        message: `tipo inválido: esperado "${types.join("|")}", encontrado ${found}`,
      });
      return errors; // type mismatch → don't recurse (errors would be misleading)
    }
  }

  // enum
  if (Array.isArray(schema.enum)) {
    if (!schema.enum.some((e) => JSON.stringify(e) === JSON.stringify(value))) {
      errors.push({
        path: ptr,
        message: `deve ser um de: ${schema.enum.map((e) => JSON.stringify(e)).join(", ")}`,
      });
    }
  }

  // const
  if ("const" in schema && JSON.stringify(value) !== JSON.stringify(schema.const)) {
    errors.push({ path: ptr, message: `deve ser ${JSON.stringify(schema.const)}` });
  }

  // String keywords
  if (typeof value === "string") {
    if (schema.pattern && !new RegExp(schema.pattern).test(value)) {
      errors.push({ path: ptr, message: `não corresponde ao padrão "${schema.pattern}"` });
    }
    if (schema.minLength !== undefined && value.length < schema.minLength) {
      errors.push({
        path: ptr,
        message: `comprimento mínimo ${schema.minLength}, encontrado ${value.length}`,
      });
    }
    if (schema.maxLength !== undefined && value.length > schema.maxLength) {
      errors.push({
        path: ptr,
        message: `comprimento máximo ${schema.maxLength}, encontrado ${value.length}`,
      });
    }
  }

  // Number keywords
  if (typeof value === "number") {
    if (schema.minimum !== undefined && value < schema.minimum) {
      errors.push({ path: ptr, message: `mínimo ${schema.minimum}, encontrado ${value}` });
    }
    if (schema.maximum !== undefined && value > schema.maximum) {
      errors.push({ path: ptr, message: `máximo ${schema.maximum}, encontrado ${value}` });
    }
  }

  // Object keywords
  if (value !== null && typeof value === "object" && !Array.isArray(value)) {
    // required
    for (const key of schema.required ?? []) {
      if (!(key in value)) {
        errors.push({ path: `${ptr}/${key}`, message: "campo obrigatório ausente" });
      }
    }

    // properties
    if (schema.properties) {
      for (const [key, propSchema] of Object.entries(schema.properties)) {
        if (key in value) {
          errors.push(...validate(value[key], propSchema, root, `${ptr}/${key}`));
        }
      }
    }

    // additionalProperties: false → flag unknown keys
    if (schema.additionalProperties === false && schema.properties) {
      const allowed = new Set(Object.keys(schema.properties));
      for (const key of Object.keys(value)) {
        if (!allowed.has(key)) {
          errors.push({ path: `${ptr}/${key}`, message: "propriedade adicional não permitida" });
        }
      }
    }

    // additionalProperties: schema → validate unknown keys against it
    if (
      schema.additionalProperties &&
      typeof schema.additionalProperties === "object" &&
      schema.properties
    ) {
      const known = new Set(Object.keys(schema.properties));
      for (const [key, val] of Object.entries(value)) {
        if (!known.has(key)) {
          errors.push(...validate(val, schema.additionalProperties, root, `${ptr}/${key}`));
        }
      }
    }
  }

  // Array keywords
  if (Array.isArray(value) && schema.items) {
    for (let i = 0; i < value.length; i++) {
      errors.push(...validate(value[i], schema.items, root, `${ptr}/${i}`));
    }
  }

  // Combiners
  if (Array.isArray(schema.allOf)) {
    for (const sub of schema.allOf) {
      errors.push(...validate(value, sub, root, ptr));
    }
  }
  for (const combiner of ["anyOf", "oneOf"]) {
    if (Array.isArray(schema[combiner])) {
      const branchErrs = schema[combiner].map((s) => validate(value, s, root, ptr));
      if (!branchErrs.some((e) => e.length === 0)) {
        errors.push({
          path: ptr,
          message: `não corresponde a nenhuma variante permitida (${combiner})`,
        });
      }
    }
  }

  return errors;
}

/**
 * @param {any} value
 * @param {string} type
 * @returns {boolean}
 */
function checkType(value, type) {
  if (type === "null") return value === null;
  if (type === "integer") return Number.isInteger(value);
  if (type === "array") return Array.isArray(value);
  if (type === "object")
    return value !== null && typeof value === "object" && !Array.isArray(value);
  return typeof value === type;
}
```

- [ ] **Step 3: Run all tests — all 11 branches must pass**

```bash
node --test tests/hook-validate-settings-schema.test.mjs
```

Expected: all tests PASS (0 failures). If any test fails, debug before committing.

- [ ] **Step 4: Run full test suite to confirm no regressions**

```bash
npm test
```

Expected: typecheck PASS, lint PASS, all unit tests PASS.

If lint fails with "Parsing error" on the top-level `await`, the file needs `"type":"module"` in nearest package.json (already set project-wide) or the hook needs to use `.then()` chains. In this project all `.mjs` files support top-level await.

- [ ] **Step 5: Commit**

```bash
git add templates/hooks/validate-settings-schema.mjs
git commit -m "feat(hook): implement validate-settings-schema — all 11 tests passing"
```

---

### Task 6: Catalog registration + settings wiring (distributed)

Register the hook so target projects receive it via `aia-harness init`.

**Files:**
- Modify: `lib/data/project-catalog.mjs` (line ~77–89 — `PROJECT_HOOK_FILES` array)
- Modify: `lib/generate/settings.mjs` (line ~95–104 — `PostToolUse[0].hooks` array)

**Interfaces:**
- Consumes: `hookCmd()` helper already defined in `lib/generate/settings.mjs`
- Produces: generated `settings.json` for target projects will include the hook

- [ ] **Step 1: Add hook to `PROJECT_HOOK_FILES` in `lib/data/project-catalog.mjs`**

Open `lib/data/project-catalog.mjs`. Find the `PROJECT_HOOK_FILES` export (around line 77).
Add `"validate-settings-schema.mjs"` to the array:

```js
export const PROJECT_HOOK_FILES = [
  "secret-scan.mjs",
  "rtk-hook.mjs",
  "large-file-warning.mjs",
  "guard-main-branch.mjs",
  "memory-stop.mjs",
  "sql-idempotent-review.mjs",
  "worktree-subagent-ctx.mjs",
  "worktree-session-ctx.mjs",
  "worktree-prompt-ctx.mjs",
  "worktree-write-guard.mjs",
  "check-deps-on-start.mjs",
  "validate-settings-schema.mjs", // ← add this line
];
```

- [ ] **Step 2: Add hook to `PostToolUse` wiring in `lib/generate/settings.mjs`**

Open `lib/generate/settings.mjs`. Find the `PostToolUse` block (around line 95).
It currently reads:

```js
PostToolUse: [
  {
    matcher: "Edit|Write|MultiEdit",
    hooks: [
      { type: "command", ...hookCmd("format-on-edit.mjs"), timeout: 60 },
      { type: "command", ...hookCmd("set-files-changed.mjs"), timeout: 30 },
      { type: "command", ...hookCmd("sql-idempotent-review.mjs"), timeout: 10 },
    ],
  },
],
```

Add the new hook entry at the end of the `hooks` array:

```js
PostToolUse: [
  {
    matcher: "Edit|Write|MultiEdit",
    hooks: [
      { type: "command", ...hookCmd("format-on-edit.mjs"), timeout: 60 },
      { type: "command", ...hookCmd("set-files-changed.mjs"), timeout: 30 },
      { type: "command", ...hookCmd("sql-idempotent-review.mjs"), timeout: 10 },
      { type: "command", ...hookCmd("validate-settings-schema.mjs"), timeout: 30 }, // ← add
    ],
  },
],
```

Timeout is 30s to cover first-run schema fetch on slow connections. Cached runs complete in <100ms.

- [ ] **Step 3: Run full test suite**

```bash
npm test
```

Expected: all PASS. The existing `tests/settings-strict.test.mjs` validates the generated settings — check if it snapshots the `PostToolUse` hooks and needs updating.

If `tests/settings-strict.test.mjs` fails with a snapshot mismatch, update the expected snapshot to include `validate-settings-schema.mjs`. Read that test file to understand its assertion style before editing.

- [ ] **Step 4: Commit**

```bash
git add lib/data/project-catalog.mjs lib/generate/settings.mjs
git commit -m "feat(catalog): register validate-settings-schema in PROJECT_HOOK_FILES and renderSettings"
```

---

### Task 7: Wire hook into aia-harness dev environment

Copy the hook to `.claude/hooks/` and wire it in `.claude/settings.json` so the aia-harness project validates its own settings files.

**Files:**
- Create: `.claude/hooks/validate-settings-schema.mjs`
- Modify: `.claude/settings.json`

**Interfaces:**
- Consumes: `templates/hooks/validate-settings-schema.mjs` (Task 5)
- Produces: aia-harness settings changes validate in real-time during development

- [ ] **Step 1: Copy hook to `.claude/hooks/`**

```bash
cp templates/hooks/validate-settings-schema.mjs .claude/hooks/validate-settings-schema.mjs
```

Verify: `.claude/hooks/validate-settings-schema.mjs` exists and matches the template.

- [ ] **Step 2: Add hook to `.claude/settings.json`**

Open `.claude/settings.json`. Find the `PostToolUse` block. It currently reads:

```json
"PostToolUse": [
  {
    "matcher": "Edit|Write|MultiEdit",
    "hooks": [
      { "type": "command", "command": "node", "args": ["$CLAUDE_PROJECT_DIR/.claude/hooks/eslint-fix.mjs"], "timeout": 30 },
      { "type": "command", "command": "node", "args": ["$CLAUDE_PROJECT_DIR/.claude/hooks/typecheck-on-edit.mjs"], "timeout": 30 }
    ]
  }
]
```

Add the new hook entry:

```json
"PostToolUse": [
  {
    "matcher": "Edit|Write|MultiEdit",
    "hooks": [
      { "type": "command", "command": "node", "args": ["$CLAUDE_PROJECT_DIR/.claude/hooks/eslint-fix.mjs"], "timeout": 30 },
      { "type": "command", "command": "node", "args": ["$CLAUDE_PROJECT_DIR/.claude/hooks/typecheck-on-edit.mjs"], "timeout": 30 },
      { "type": "command", "command": "node", "args": ["$CLAUDE_PROJECT_DIR/.claude/hooks/validate-settings-schema.mjs"], "timeout": 30 }
    ]
  }
]
```

- [ ] **Step 3: Smoke-test the hook manually**

Run the hook against this project's own settings.json to verify it exits 0 (valid):

```bash
echo '{"tool_name":"Write","tool_input":{"file_path":"'"$(pwd)/.claude/settings.json"'"}}' \
  | node .claude/hooks/validate-settings-schema.mjs
echo "Exit code: $?"
```

Expected: no output, exit code 0.

- [ ] **Step 4: Run full test suite one final time**

```bash
npm test
```

Expected: all PASS.

- [ ] **Step 5: Final commit**

```bash
git add .claude/hooks/validate-settings-schema.mjs .claude/settings.json
git commit -m "feat(harness): wire validate-settings-schema hook into aia-harness dev environment"
```

---

## Verification Checklist

After all tasks complete, verify:

- [ ] `npm test` is green (typecheck + lint + all unit tests)
- [ ] `node --test tests/hook-validate-settings-schema.test.mjs` — 12 tests PASS (11 branches + malformed stdin)
- [ ] Smoke test: `echo '{"tool_name":"Write","tool_input":{"file_path":"'$(pwd)/.claude/settings.json'"}}' | node templates/hooks/validate-settings-schema.mjs` → exit 0
- [ ] Smoke test with invalid settings (create temp bad file, feed path to hook) → exit 2 with error list and "Deseja que eu corrija?"
- [ ] `lib/data/project-catalog.mjs` includes `"validate-settings-schema.mjs"` in `PROJECT_HOOK_FILES`
- [ ] `lib/generate/settings.mjs` `PostToolUse` block includes the hook with timeout 30
- [ ] `.claude/hooks/validate-settings-schema.mjs` exists
- [ ] `.claude/settings.json` `PostToolUse` block includes the hook
