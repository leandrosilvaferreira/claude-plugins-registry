# Test Coverage Gaps — Implementation Plan

**Date:** 2026-06-27  
**Branch:** main  
**Goal:** Close three integrity-test gaps identified in the test audit: catalog path-existence, templates orphan check, and CLI integration tests.

## Global Constraints

- All test files: `tests/*.test.mjs`, `node:test` + `node:assert/strict`, same style as existing tests
- No new dependencies (no npm install needed)
- Pure ESM `.mjs`, no TypeScript, no build step
- Import from `lib/` via relative paths (same pattern as existing tests)
- Tests must pass: `npm test` (typecheck + lint + unit) exits 0
- Prettier enforced: run `npm run lint -- --fix` on generated files
- No magic strings: derive paths from `__dirname` / `fileURLToPath(import.meta.url)`
- `ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")` — use this pattern for repo root
- Tests are read-only (no writes to disk unless using `os.tmpdir()`)
- Fixtures under `tests/fixtures/` are available for read-only scan-type tests

## Task 1: Catalog Path-Existence Integrity Test

**File to create:** `tests/catalog-paths-integrity.test.mjs`

**Purpose:** For every catalog entry that references a file or directory under `templates/`, assert the path actually exists on disk. Prevents silent `if (!exists(from)) continue` skips hiding broken catalog entries.

**What to check:**

### 1a. ECC catalog
Import `allEccAssets` from `../lib/data/ecc-catalog.mjs`.  
`eccRoot = path.join(ROOT, "templates", "ecc")`

- For each agent name in `allEccAssets().agents`: `templates/ecc/agents/<name>.md` must exist (file)
- For each skill name in `allEccAssets().skills`: `templates/ecc/skills/<name>/` must exist (directory)
- For each rule dir in `allEccAssets().rules`: `templates/ecc/rules/<dir>/` must exist (directory)

Use one `test()` block per type (agents, skills, rules), looping inside and asserting each.

### 1b. ag-kit catalog
Import `allAgkitAssets` from `../lib/data/agkit-catalog.mjs`.  
`agkitRoot = path.join(ROOT, "templates", "ag-kit")`

- For each agent name: `templates/ag-kit/agents/<name>.md` must exist (file)
- For each skill name: `templates/ag-kit/skills/<name>/` must exist (directory)
- For each command name: `templates/ag-kit/commands/<name>.md` must exist (file)
- For each script name: `templates/ag-kit/scripts/<name>.py` must exist (file)

One `test()` block per type.

### 1c. Project hooks
Import `PROJECT_HOOK_FILES`, `PROJECT_HOOK_BY_STACK` from `../lib/data/project-catalog.mjs`.  
`hooksDir = path.join(ROOT, "templates", "hooks")`

- Every file in `PROJECT_HOOK_FILES`: `templates/hooks/<file>` must exist
- Every `def.file` in every `PROJECT_HOOK_BY_STACK[stack]` array: `templates/hooks/<file>` must exist (deduplicate)
- The two hook-artifacts.mjs direct copies: `set-files-changed.mjs` and `verify-on-stop.mjs` — assert they exist in `templates/hooks/`

All in one `test()` block, loop over the combined set.

### 1d. Project skills and rules
Import `PROJECT_COMMON`, `PROJECT_BY_STACK` from `../lib/data/project-catalog.mjs`.  
`skillsDir = path.join(ROOT, "templates", "skills")`  
`rulesDir = path.join(ROOT, "templates", "rules")`

- Every name in `PROJECT_COMMON.skills`: `templates/skills/<name>/` must exist (directory)
- Every name in `PROJECT_BY_STACK[*].skills` (all stacks): same check
- Every path in `PROJECT_COMMON.rules`: `templates/rules/<path>` must exist (file)
- Every path in `PROJECT_BY_STACK[*].rules` (all stacks): same check

Two `test()` blocks: one for skills, one for rules.

### 1e. Tools catalog
Import `TOOLS` from `../lib/data/tools-catalog.mjs`.  
`toolsRoot = path.join(ROOT, "templates", "tools")`

For every tool in `TOOLS` where `tool.strategy === "vendor"`:  
`templates/tools/<tool.id>/` must exist (directory).

One `test()` block.

### 1f. GitHub PM catalog
Import the artifact list from `../lib/data/github-pm-catalog.mjs`. Look at what it exports — likely a function or constant that returns artifacts with `copyFrom` absolute paths.  
Assert that each `copyFrom` path exists (use `fs.existsSync`).

One `test()` block.

---

## Task 2: Templates Orphan Check

**File to create:** `tests/templates-orphan.test.mjs`

**Purpose:** Walk `templates/hooks/`, `templates/skills/`, and `templates/rules/` and assert every file/directory is referenced by at least one catalog. Catches "added to templates/ but forgot to register in catalog" mistakes.

### 2a. templates/hooks/ — no orphans
Collect the full set of registered hook filenames:
```js
const registeredHooks = new Set([
  ...PROJECT_HOOK_FILES,
  ...Object.values(PROJECT_HOOK_BY_STACK).flat().map(d => d.file),
  "set-files-changed.mjs",   // hook-artifacts.mjs line 108
  "verify-on-stop.mjs",      // hook-artifacts.mjs line 95 (non-strict path)
]);
```

Walk `templates/hooks/` (non-recursive, top-level only) and collect every `.mjs` filename.  
Assert: every filename is in `registeredHooks`.

Error message must name the orphan file clearly:  
`"templates/hooks/<name> is not registered in PROJECT_HOOK_FILES, PROJECT_HOOK_BY_STACK, or hook-artifacts.mjs"`

### 2b. templates/skills/ — no orphans
Collect the full set of registered skill directory names:
```js
const registeredSkills = new Set([
  ...PROJECT_COMMON.skills,
  ...Object.values(PROJECT_BY_STACK).flatMap(s => s.skills),
  "github-pm",  // registered in github-pm-catalog.mjs → GITHUB_PM_ARTIFACTS[0].copyFrom
]);
```

Walk `templates/skills/` (top-level directories only).  
Assert: every directory name is in `registeredSkills`.

### 2c. templates/rules/ — no orphans
Collect the full set of registered rule paths (relative to `templates/rules/`):
```js
const registeredRules = new Set([
  ...PROJECT_COMMON.rules,                                       // "01-ddd.md", …
  ...Object.values(PROJECT_BY_STACK).flatMap(s => s.rules),     // "go/coding-standards.md", …
]);
```

Walk `templates/rules/` — collect:
- Top-level `.md` files → filename only (e.g., `"01-ddd.md"`)
- Subdir `.md` files → `"<subdir>/<file>.md"` (one level deep, no deeper)

Assert: every path is in `registeredRules`.

---

## Task 3: CLI Integration Test

**File to create:** `tests/cli-integration.test.mjs`

**Purpose:** Smoke-test the actual `bin/harness.mjs` CLI entry point end-to-end: scan → plan → apply on a real fixture. Catches regressions in CLI option parsing, JSON output format, and file-writing pipeline that unit tests of individual modules cannot catch.

**Pattern for running CLI:** use `spawnSync` (or `execFileSync`) against `process.execPath` (the current node binary) to avoid PATH issues. Pass `--json` where applicable.

```js
import { spawnSync } from "node:child_process";
// harness = path.join(ROOT, "bin", "harness.mjs")
// run: spawnSync(process.execPath, [harness, "scan", fixturePath, "--json"], { encoding: "utf8" })
```

### 3a. `scan --json` returns valid ProjectProfile shape

Use `tests/fixtures/js-ts-app` as the fixture.

```js
test("scan --json emits valid ProjectProfile JSON", () => {
  const result = spawnSync(process.execPath, [harness, "scan", fixture, "--json"], { encoding: "utf8" });
  assert.strictEqual(result.status, 0, result.stderr);
  const profile = JSON.parse(result.stdout);
  assert.ok(typeof profile.primaryLanguage === "string" || profile.primaryLanguage === null);
  assert.ok(Array.isArray(profile.frameworks));
  assert.ok(typeof profile.root === "string");
});
```

### 3b. `plan --json` returns valid HarnessPlan shape

Same fixture.

```js
test("plan --json emits valid HarnessPlan JSON", () => {
  const result = spawnSync(process.execPath, [harness, "plan", fixture, "--json"], { encoding: "utf8" });
  assert.strictEqual(result.status, 0, result.stderr);
  const plan = JSON.parse(result.stdout);
  assert.ok(Array.isArray(plan.artifacts), "plan.artifacts must be array");
  assert.ok(plan.artifacts.length > 0, "plan must have at least one artifact");
  const ids = plan.artifacts.map(a => a.id);
  assert.ok(ids.includes("claude-md-root"), "must include claude-md-root");
  assert.ok(ids.includes("settings"), "must include settings");
  for (const a of plan.artifacts) {
    assert.ok(typeof a.id === "string", `artifact missing id`);
    assert.ok(typeof a.relPath === "string", `artifact ${a.id} missing relPath`);
    assert.ok(typeof a.category === "string", `artifact ${a.id} missing category`);
  }
});
```

### 3c. `apply --yes` writes key files to a temp dir

```js
test("apply --yes writes CLAUDE.md and settings.json into target", () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "harness-cli-test-"));
  try {
    // scan + plan from fixture, apply to tmp
    const result = spawnSync(
      process.execPath,
      [harness, "apply", fixture, "--yes", "--target", tmp],
      { encoding: "utf8" }
    );
    // Note: if --target flag doesn't exist, apply to tmp by running scan on tmp
    // Check: CLAUDE.md and .claude/settings.json exist in tmp
    assert.ok(fs.existsSync(path.join(tmp, "CLAUDE.md")), "CLAUDE.md must be written");
    assert.ok(fs.existsSync(path.join(tmp, ".claude", "settings.json")), "settings.json must be written");
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});
```

**Important:** Before implementing 3c, check the actual `bin/harness.mjs` interface. The apply command may write to the fixture's location or may take the dir as both source and target. Look at existing tests (plan-apply.test.mjs) to understand how `applyPlan` is used — the CLI may behave differently from the library. Adjust accordingly. If the CLI doesn't support writing to a separate target (it may apply in-place to the scanned dir), use a copy of the fixture in a temp dir instead.

---

## Implementation Notes

- Check `tests/project-catalog.test.mjs` lines 71-128 for the existing pattern of path-existence checks (hooks only) — match that style.
- Check `tests/plan-apply.test.mjs` for the `ROOT`, `FIX`, fixture pattern — reuse it.
- All three new test files go in `tests/` at the top level (not in subdirs).
- After creating each file, run `npm test` to verify all 808+ tests still pass with the new additions.
- Commit each file separately with descriptive messages.
