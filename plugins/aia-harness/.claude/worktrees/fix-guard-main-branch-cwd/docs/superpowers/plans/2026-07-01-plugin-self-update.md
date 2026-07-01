# Plugin self-update on session start Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** On every Claude Code session start, check at most once per 24h whether a newer `aia-harness` version is published in the marketplace registry, and — if so — silently update the installed copy on disk and tell the user.

**Architecture:** A `SessionStart` hook (`hooks/scripts/check-plugin-update.mjs`) shells out to the sanctioned `claude plugin list/marketplace update/update` CLI subcommands (never a hand-rolled network fetch), throttled by a 24h cache file. A small pure module (`hooks/scripts/update-check-logic.mjs`) holds the throttle/version-compare logic so it's unit-testable without spawning anything. The hook replaces this plugin's own existing, broken `SessionStart` slot (currently pointing at a nonexistent `.sh` file).

**Tech Stack:** Node.js ESM (`.mjs`), `node:child_process` (`execFileSync`), `node:fs`, `node:os`, `node:path`, `node:test` + `node:assert/strict` for tests. No new npm dependencies.

**Spec:** `docs/superpowers/specs/2026-07-01-plugin-self-update-design.md`

## Global Constraints

- Every hook is `.mjs`, wired via **exec form** (`command`+`args`, never a single shell-form string) — see `.claude/rules/hooks-cross-platform.md`.
- Every `execFileSync`/`spawnSync`/`spawn`/`exec`/`fork` call **must** pass `windowsHide: true`.
- Use `os.homedir()` / `path.join()` for all paths — never hardcode `$HOME`, separators, or the marketplace cache location.
- **Fail-open, always:** any failure in an external call (subprocess, file read/parse) results in exit `0` with **no stdout output** — never exit `2`, never throw, never block session start, never surface an error to the user.
- Throttle window is exactly `24 * 60 * 60 * 1000` ms; the cache file lives at the path plugin.json passes via `${CLAUDE_PLUGIN_DATA}`.
- No new npm dependencies — the version comparator is hand-rolled (three numeric segments).
- The hook's only stdout output, when emitted, must validate against `validateSessionStartOutput` from `lib/validate/hook-schema.mjs`.
- Out of scope (do not add): a `UserPromptExpansion` per-command trigger, an `/aia-harness:init` suggestion, or any attempt at same-session hot-reload — the spec rules all three out explicitly.
- `npm test` (typecheck + lint + unit) must be green when the plan is done.

---

### Task 1: Pure throttle and version-compare logic

**Files:**

- Create: `hooks/scripts/update-check-logic.mjs`
- Test: `tests/hook-check-plugin-update.test.mjs` (created here; Task 2 and Task 3 append to it)

**Interfaces:**

- Produces: `isCheckDue(lastCheckedAt: string|undefined|null, now: number, ttlMs: number): boolean` — true when a check is due.
- Produces: `compareVersions(a: string, b: string): number` — negative if `a<b`, zero if equal, positive if `a>b`, comparing `MAJOR.MINOR.PATCH`-style strings numerically segment by segment (missing segments treated as `0`).

- [ ] **Step 1: Write the failing tests**

Create `tests/hook-check-plugin-update.test.mjs`:

```js
/**
 * Tests for hooks/scripts/check-plugin-update.mjs and its pure logic module.
 *
 * Run: node --test tests/hook-check-plugin-update.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { isCheckDue, compareVersions } from "../hooks/scripts/update-check-logic.mjs";

// ── isCheckDue ────────────────────────────────────────────────────────────
test("isCheckDue: never checked (undefined) → true", () => {
  assert.equal(isCheckDue(undefined, Date.now(), 1000), true);
});

test("isCheckDue: never checked (null) → true", () => {
  assert.equal(isCheckDue(null, Date.now(), 1000), true);
});

test("isCheckDue: within TTL → false", () => {
  const now = 1_000_000_000_000;
  const lastCheckedAt = new Date(now - 1000).toISOString();
  assert.equal(isCheckDue(lastCheckedAt, now, 24 * 60 * 60 * 1000), false);
});

test("isCheckDue: exactly at TTL boundary → true", () => {
  const now = 1_000_000_000_000;
  const ttlMs = 24 * 60 * 60 * 1000;
  const lastCheckedAt = new Date(now - ttlMs).toISOString();
  assert.equal(isCheckDue(lastCheckedAt, now, ttlMs), true);
});

test("isCheckDue: past TTL → true", () => {
  const now = 1_000_000_000_000;
  const ttlMs = 24 * 60 * 60 * 1000;
  const lastCheckedAt = new Date(now - ttlMs - 1).toISOString();
  assert.equal(isCheckDue(lastCheckedAt, now, ttlMs), true);
});

test("isCheckDue: malformed timestamp → true", () => {
  assert.equal(isCheckDue("not-a-date", Date.now(), 1000), true);
});

// ── compareVersions ─────────────────────────────────────────────────────────
test("compareVersions: equal versions → 0", () => {
  assert.equal(compareVersions("0.3.1", "0.3.1"), 0);
});

test("compareVersions: a older (patch) → negative", () => {
  assert.ok(compareVersions("0.3.0", "0.3.1") < 0);
});

test("compareVersions: a newer (minor) → positive", () => {
  assert.ok(compareVersions("0.4.0", "0.3.9") > 0);
});

test("compareVersions: a newer (major) → positive", () => {
  assert.ok(compareVersions("1.0.0", "0.99.99") > 0);
});

test("compareVersions: missing segments treated as zero", () => {
  assert.equal(compareVersions("0.3", "0.3.0"), 0);
});

test("compareVersions: shorter newer than longer", () => {
  assert.ok(compareVersions("1", "0.99.99") > 0);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `node --test tests/hook-check-plugin-update.test.mjs`
Expected: FAIL — cannot find module `../hooks/scripts/update-check-logic.mjs` (it doesn't exist yet).

- [ ] **Step 3: Implement the pure logic module**

Create `hooks/scripts/update-check-logic.mjs`:

```js
/**
 * Pure decision logic for the plugin self-update SessionStart hook
 * (hooks/scripts/check-plugin-update.mjs). No IO — safe to unit-test
 * directly without spawning a subprocess.
 */

/**
 * Whether an update check is due, given when it last ran.
 * @param {string|undefined|null} lastCheckedAt  ISO 8601 timestamp, or nullish if never checked
 * @param {number} now  Date.now()
 * @param {number} ttlMs  Minimum interval between checks, in milliseconds
 * @returns {boolean}
 */
export function isCheckDue(lastCheckedAt, now, ttlMs) {
  if (!lastCheckedAt) return true;
  const last = Date.parse(lastCheckedAt);
  if (Number.isNaN(last)) return true;
  return now - last >= ttlMs;
}

/**
 * Compare two "MAJOR.MINOR.PATCH"-style version strings numerically,
 * segment by segment. Missing segments are treated as 0 (so "0.3" == "0.3.0").
 * @param {string} a
 * @param {string} b
 * @returns {number} negative if a<b, zero if equal, positive if a>b
 */
export function compareVersions(a, b) {
  const pa = String(a).split(".").map(Number);
  const pb = String(b).split(".").map(Number);
  const len = Math.max(pa.length, pb.length);
  for (let i = 0; i < len; i++) {
    const na = pa[i] || 0;
    const nb = pb[i] || 0;
    if (na !== nb) return na - nb;
  }
  return 0;
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `node --test tests/hook-check-plugin-update.test.mjs`
Expected: PASS — all 11 tests pass, 0 failures.

- [ ] **Step 5: Lint and typecheck**

Run: `npm run lint && npm run typecheck`
Expected: both clean (no errors).

- [ ] **Step 6: Commit**

```bash
git add hooks/scripts/update-check-logic.mjs tests/hook-check-plugin-update.test.mjs
git commit -m "feat(hooks): add pure throttle/version-compare logic for plugin self-update"
```

---

### Task 2: Fail-open orchestration hook, test double, and full branch coverage

**Files:**

- Create: `hooks/scripts/check-plugin-update.mjs`
- Create: `tests/fixtures/fake-claude-plugin-cli.mjs`
- Modify: `tests/hook-runner.mjs` (add optional `args` passthrough to `runHook`/`runHookRaw`)
- Modify: `tests/hook-check-plugin-update.test.mjs` (append hook-level tests)

**Interfaces:**

- Consumes: `isCheckDue`, `compareVersions` from `hooks/scripts/update-check-logic.mjs` (Task 1).
- Produces: `hooks/scripts/check-plugin-update.mjs`, a `SessionStart` hook reading these env vars (all optional, all test-only overrides of production defaults):
  - `AIA_UPDATE_CHECK_CLAUDE_BIN` — command to run instead of `claude` (default: `"claude"`, resolved via `PATH`).
  - `AIA_UPDATE_CHECK_CACHE_FILE` — cache file path (default: `process.argv[2]`, which is `${CLAUDE_PLUGIN_DATA}/update-check.json` in production — see Task 3).
  - `AIA_UPDATE_CHECK_MARKETPLACE_HOME` — replaces `os.homedir()` when locating the cached marketplace clone.
- Produces: `tests/fixtures/fake-claude-plugin-cli.mjs`, a directly-executable (`chmod +x`) stand-in for the `claude` binary's `plugin list/marketplace update/update` subcommands, controlled by:
  - `AIA_TEST_INSTALLED_VERSION` (default `"0.1.0"`) — version reported by `plugin list --json`.
  - `AIA_TEST_MARKETPLACE` (default `"test-marketplace"`) — marketplace suffix in the reported `id`.
  - `AIA_TEST_OMIT_SELF` (`"1"` to omit) — omits the `aia-harness@...` entry from `plugin list --json`.
  - `AIA_TEST_FAIL_ON` — comma-separated subset of `"list"`, `"marketplace-update"`, `"update"` to simulate failing.
- Consumes/extends: `runHook(hookPath, event, opts)` / `runHookRaw(hookPath, rawInput, opts)` from `tests/hook-runner.mjs` — adds an optional `opts.args: string[]` appended to the spawned argv after `hookPath` (backward compatible; existing callers omit it).

- [ ] **Step 1: Create the fake `claude` CLI test double**

Create `tests/fixtures/fake-claude-plugin-cli.mjs`:

```js
#!/usr/bin/env node
// Fake `claude` CLI double for hooks/scripts/check-plugin-update.mjs tests.
// Behavior is controlled by env vars so one fixture covers every scenario:
//   AIA_TEST_INSTALLED_VERSION — version reported by `plugin list --json`
//   AIA_TEST_MARKETPLACE       — marketplace suffix reported in the id
//   AIA_TEST_OMIT_SELF         — "1" omits the aia-harness entry from the list
//   AIA_TEST_FAIL_ON           — comma-separated subcommands to fail:
//                                "list" | "marketplace-update" | "update"
const args = process.argv.slice(2);
const failOn = new Set((process.env.AIA_TEST_FAIL_ON ?? "").split(",").filter(Boolean));
const marketplace = process.env.AIA_TEST_MARKETPLACE ?? "test-marketplace";
const installedVersion = process.env.AIA_TEST_INSTALLED_VERSION ?? "0.1.0";
const omitSelf = process.env.AIA_TEST_OMIT_SELF === "1";

if (args[0] === "plugin" && args[1] === "list" && args.includes("--json")) {
  if (failOn.has("list")) {
    process.stderr.write("simulated failure: plugin list\n");
    process.exit(1);
  }
  const entries = omitSelf ? [] : [{ id: `aia-harness@${marketplace}`, version: installedVersion }];
  process.stdout.write(JSON.stringify(entries));
  process.exit(0);
} else if (args[0] === "plugin" && args[1] === "marketplace" && args[2] === "update") {
  if (failOn.has("marketplace-update")) {
    process.stderr.write("simulated failure: marketplace update\n");
    process.exit(1);
  }
  process.exit(0);
} else if (args[0] === "plugin" && args[1] === "update") {
  if (failOn.has("update")) {
    process.stderr.write("simulated failure: plugin update\n");
    process.exit(1);
  }
  process.exit(0);
} else {
  process.exit(1);
}
```

Make it directly executable, matching the existing `tests/fixtures/stub-rtk.mjs` convention:

Run: `chmod +x tests/fixtures/fake-claude-plugin-cli.mjs`

- [ ] **Step 2: Extend `hook-runner.mjs` with an optional `args` passthrough**

In `tests/hook-runner.mjs`, replace the `runHook` function:

```js
export function runHook(hookPath, event, opts = {}) {
  const result = spawnSync(process.execPath, [hookPath], {
    input: JSON.stringify(event),
    encoding: "utf8",
    env: { ...process.env, ...opts.env },
  });
  return {
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
    exitCode: result.status ?? 0,
  };
}
```

with:

```js
export function runHook(hookPath, event, opts = {}) {
  const result = spawnSync(process.execPath, [hookPath, ...(opts.args ?? [])], {
    input: JSON.stringify(event),
    encoding: "utf8",
    env: { ...process.env, ...opts.env },
  });
  return {
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
    exitCode: result.status ?? 0,
  };
}
```

And update its JSDoc `@param` line from:

```js
 * @param {{ env?: Record<string,string> }} [opts]
```

to:

```js
 * @param {{ env?: Record<string,string>, args?: string[] }} [opts]
```

(Two occurrences in the file — one above `runHook`, one above `runHookRaw`. Leave `runHookRaw`'s body as-is for this step; Task 2 does not need `runHookRaw`'s argv, only `runHook`'s.)

- [ ] **Step 3: Write the failing hook-level tests**

Append to `tests/hook-check-plugin-update.test.mjs` (add these imports at the top, alongside the existing ones):

```js
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { runHook } from "./hook-runner.mjs";
import { validateSessionStartOutput } from "../lib/validate/hook-schema.mjs";
```

Then append at the bottom of the file:

```js
// ── hook: fail-open + auto-update behavior ─────────────────────────────────
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const HOOK = path.join(ROOT, "hooks", "scripts", "check-plugin-update.mjs");
const FAKE_CLAUDE = path.join(ROOT, "tests", "fixtures", "fake-claude-plugin-cli.mjs");

function freshCacheFile() {
  return path.join(os.tmpdir(), `aia-update-check-cache-${Math.random().toString(36).slice(2)}.json`);
}

/**
 * Build a temp $HOME-like dir with the marketplace's cached plugin.json
 * pre-seeded at the exact path check-plugin-update.mjs reads.
 * @param {string} marketplace
 * @param {string} version
 * @returns {string} the temp home dir — caller must rm it after the test
 */
function mkMarketplaceHome(marketplace, version) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "aia-marketplace-home-"));
  const manifestDir = path.join(
    home,
    ".claude",
    "plugins",
    "marketplaces",
    marketplace,
    "plugins",
    "aia-harness",
    ".claude-plugin",
  );
  fs.mkdirSync(manifestDir, { recursive: true });
  fs.writeFileSync(path.join(manifestDir, "plugin.json"), JSON.stringify({ version }), "utf8");
  return home;
}

/** @param {Record<string,string>} overrides */
function baseEnv(overrides = {}) {
  return {
    AIA_UPDATE_CHECK_CLAUDE_BIN: FAKE_CLAUDE,
    AIA_TEST_INSTALLED_VERSION: "0.3.1",
    AIA_TEST_MARKETPLACE: "test-marketplace",
    ...overrides,
  };
}

/** @param {import("./hook-runner.mjs").HookResult} r */
function assertSilentSuccess({ stdout, exitCode }) {
  const v = validateSessionStartOutput(stdout, exitCode);
  assert.equal(v.valid, true, `Schema invalid: ${v.errors.join("; ")}`);
  assert.equal(exitCode, 0);
  assert.equal(stdout.trim(), "", "must emit no stdout");
}

test("check-plugin-update: no cache path at all → silent exit 0", () => {
  const r = runHook(HOOK, {}, {
    env: baseEnv({ AIA_UPDATE_CHECK_CACHE_FILE: "" }),
  });
  assertSilentSuccess(r);
});

test("check-plugin-update: check not due (fresh cache) → silent exit 0, claude never invoked", () => {
  const cacheFile = freshCacheFile();
  fs.writeFileSync(cacheFile, JSON.stringify({ lastCheckedAt: new Date().toISOString() }), "utf8");
  try {
    // AIA_UPDATE_CHECK_CLAUDE_BIN points at a nonexistent path — if the hook
    // tried to invoke it, execFileSync would throw and this test would catch it.
    const r = runHook(HOOK, {}, {
      env: baseEnv({ AIA_UPDATE_CHECK_CACHE_FILE: cacheFile, AIA_UPDATE_CHECK_CLAUDE_BIN: "/nonexistent/claude" }),
    });
    assertSilentSuccess(r);
  } finally {
    fs.rmSync(cacheFile, { force: true });
  }
});

test("check-plugin-update: first run, already up to date → silent exit 0, cache written", () => {
  const cacheFile = freshCacheFile();
  const home = mkMarketplaceHome("test-marketplace", "0.3.1");
  try {
    const r = runHook(HOOK, {}, {
      env: baseEnv({ AIA_UPDATE_CHECK_CACHE_FILE: cacheFile, AIA_UPDATE_CHECK_MARKETPLACE_HOME: home }),
    });
    assertSilentSuccess(r);
    const cache = JSON.parse(fs.readFileSync(cacheFile, "utf8"));
    assert.equal(cache.lastKnownVersion, "0.3.1");
    assert.equal(typeof cache.lastCheckedAt, "string");
  } finally {
    fs.rmSync(cacheFile, { force: true });
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test("check-plugin-update: newer version available → auto-updates, emits additionalContext", () => {
  const cacheFile = freshCacheFile();
  const home = mkMarketplaceHome("test-marketplace", "0.3.2");
  try {
    const r = runHook(HOOK, {}, {
      env: baseEnv({ AIA_UPDATE_CHECK_CACHE_FILE: cacheFile, AIA_UPDATE_CHECK_MARKETPLACE_HOME: home }),
    });
    const v = validateSessionStartOutput(r.stdout, r.exitCode);
    assert.equal(v.valid, true, `Schema invalid: ${v.errors.join("; ")}`);
    assert.equal(r.exitCode, 0);
    const out = JSON.parse(r.stdout);
    assert.equal(out.hookSpecificOutput.hookEventName, "SessionStart");
    assert.match(out.hookSpecificOutput.additionalContext, /0\.3\.1/);
    assert.match(out.hookSpecificOutput.additionalContext, /0\.3\.2/);
    assert.match(out.hookSpecificOutput.additionalContext, /reload-plugins/);
    const cache = JSON.parse(fs.readFileSync(cacheFile, "utf8"));
    assert.equal(cache.lastKnownVersion, "0.3.2");
  } finally {
    fs.rmSync(cacheFile, { force: true });
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test("check-plugin-update: installed newer than marketplace (local dev) → no downgrade, silent", () => {
  const cacheFile = freshCacheFile();
  const home = mkMarketplaceHome("test-marketplace", "0.3.0");
  try {
    const r = runHook(HOOK, {}, {
      env: baseEnv({ AIA_UPDATE_CHECK_CACHE_FILE: cacheFile, AIA_UPDATE_CHECK_MARKETPLACE_HOME: home }),
    });
    assertSilentSuccess(r);
  } finally {
    fs.rmSync(cacheFile, { force: true });
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test("check-plugin-update: `plugin list` fails → fail-open, silent exit 0", () => {
  const cacheFile = freshCacheFile();
  try {
    const r = runHook(HOOK, {}, {
      env: baseEnv({ AIA_UPDATE_CHECK_CACHE_FILE: cacheFile, AIA_TEST_FAIL_ON: "list" }),
    });
    assertSilentSuccess(r);
  } finally {
    fs.rmSync(cacheFile, { force: true });
  }
});

test("check-plugin-update: `plugin marketplace update` fails → fail-open, silent exit 0", () => {
  const cacheFile = freshCacheFile();
  try {
    const r = runHook(HOOK, {}, {
      env: baseEnv({ AIA_UPDATE_CHECK_CACHE_FILE: cacheFile, AIA_TEST_FAIL_ON: "marketplace-update" }),
    });
    assertSilentSuccess(r);
  } finally {
    fs.rmSync(cacheFile, { force: true });
  }
});

test("check-plugin-update: marketplace manifest missing → fail-open, silent exit 0", () => {
  const cacheFile = freshCacheFile();
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "aia-marketplace-home-empty-"));
  try {
    const r = runHook(HOOK, {}, {
      env: baseEnv({ AIA_UPDATE_CHECK_CACHE_FILE: cacheFile, AIA_UPDATE_CHECK_MARKETPLACE_HOME: home }),
    });
    assertSilentSuccess(r);
  } finally {
    fs.rmSync(cacheFile, { force: true });
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test("check-plugin-update: `plugin update` (apply) fails → fail-open, no false success claim", () => {
  const cacheFile = freshCacheFile();
  const home = mkMarketplaceHome("test-marketplace", "0.3.2");
  try {
    const r = runHook(HOOK, {}, {
      env: baseEnv({
        AIA_UPDATE_CHECK_CACHE_FILE: cacheFile,
        AIA_UPDATE_CHECK_MARKETPLACE_HOME: home,
        AIA_TEST_FAIL_ON: "update",
      }),
    });
    assertSilentSuccess(r);
  } finally {
    fs.rmSync(cacheFile, { force: true });
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test("check-plugin-update: own entry absent from `plugin list` → fail-open, silent exit 0", () => {
  const cacheFile = freshCacheFile();
  try {
    const r = runHook(HOOK, {}, {
      env: baseEnv({ AIA_UPDATE_CHECK_CACHE_FILE: cacheFile, AIA_TEST_OMIT_SELF: "1" }),
    });
    assertSilentSuccess(r);
  } finally {
    fs.rmSync(cacheFile, { force: true });
  }
});

test("check-plugin-update: cache path via argv[2] (production wiring) → works end to end", () => {
  const cacheFile = freshCacheFile();
  const home = mkMarketplaceHome("test-marketplace", "0.3.2");
  try {
    const r = runHook(HOOK, {}, {
      args: [cacheFile],
      env: baseEnv({ AIA_UPDATE_CHECK_MARKETPLACE_HOME: home, AIA_UPDATE_CHECK_CACHE_FILE: "" }),
    });
    const v = validateSessionStartOutput(r.stdout, r.exitCode);
    assert.equal(v.valid, true, `Schema invalid: ${v.errors.join("; ")}`);
    const out = JSON.parse(r.stdout);
    assert.match(out.hookSpecificOutput.additionalContext, /0\.3\.2/);
  } finally {
    fs.rmSync(cacheFile, { force: true });
    fs.rmSync(home, { recursive: true, force: true });
  }
});
```

- [ ] **Step 4: Run to verify it fails**

Run: `node --test tests/hook-check-plugin-update.test.mjs`
Expected: FAIL — cannot find module `hooks/scripts/check-plugin-update.mjs` (it doesn't exist yet). The Task 1 tests still pass; the new hook-level tests fail.

- [ ] **Step 5: Implement the orchestration hook**

Create `hooks/scripts/check-plugin-update.mjs`:

```js
#!/usr/bin/env node
/**
 * SessionStart hook: checks at most once per 24h whether a newer aia-harness
 * version is published in the plugin's marketplace registry and, if so,
 * silently updates the installed copy on disk via the `claude` CLI.
 *
 * Fail-open on all infrastructure (offline, claude CLI unresolvable, a
 * missing or malformed cache/manifest file). Never blocks session start,
 * never surfaces an error — worst case it silently skips the check.
 *
 * External dependencies are env-overridable for testing:
 *   AIA_UPDATE_CHECK_CLAUDE_BIN        — command to run instead of the real
 *                                        `claude` binary on PATH.
 *   AIA_UPDATE_CHECK_CACHE_FILE        — cache file path. Falls back to
 *                                        argv[2] (the ${CLAUDE_PLUGIN_DATA}
 *                                        path plugin.json passes for real).
 *   AIA_UPDATE_CHECK_MARKETPLACE_HOME  — replaces os.homedir() when locating
 *                                        the cached marketplace clone.
 *
 * @hook SessionStart
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { isCheckDue, compareVersions } from "./update-check-logic.mjs";

const PLUGIN_NAME = "aia-harness";
const TTL_MS = 24 * 60 * 60 * 1000;
const CLAUDE_BIN = process.env.AIA_UPDATE_CHECK_CLAUDE_BIN || "claude";
const MARKETPLACE_HOME = process.env.AIA_UPDATE_CHECK_MARKETPLACE_HOME || os.homedir();

/**
 * @param {string[]} args
 * @returns {string} stdout
 */
function runClaude(args) {
  return execFileSync(CLAUDE_BIN, args, { encoding: "utf8", timeout: 20000, windowsHide: true });
}

/**
 * @param {string} cacheFile
 * @returns {{lastCheckedAt?: string, lastKnownVersion?: string}}
 */
function readCache(cacheFile) {
  try {
    const parsed = JSON.parse(fs.readFileSync(cacheFile, "utf8"));
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

/**
 * @param {string} cacheFile
 * @param {{lastCheckedAt: string, lastKnownVersion?: string}} data
 */
function writeCache(cacheFile, data) {
  try {
    fs.mkdirSync(path.dirname(cacheFile), { recursive: true });
    fs.writeFileSync(cacheFile, JSON.stringify(data, null, 2));
  } catch {
    /* non-fatal: worst case the throttle window resets */
  }
}

function main() {
  const cacheFile = process.env.AIA_UPDATE_CHECK_CACHE_FILE || process.argv[2];
  if (!cacheFile) {
    process.exit(0);
    return;
  }

  const cache = readCache(cacheFile);

  if (!isCheckDue(cache.lastCheckedAt, Date.now(), TTL_MS)) {
    process.exit(0);
    return;
  }

  try {
    const listOut = runClaude(["plugin", "list", "--json"]);
    const list = JSON.parse(listOut);
    const installed = Array.isArray(list)
      ? list.find((p) => p && typeof p.id === "string" && p.id.startsWith(`${PLUGIN_NAME}@`))
      : undefined;

    if (!installed) {
      writeCache(cacheFile, { lastCheckedAt: new Date().toISOString() });
      process.exit(0);
      return;
    }

    const marketplace = installed.id.slice(`${PLUGIN_NAME}@`.length);
    const installedVersion = String(installed.version);

    runClaude(["plugin", "marketplace", "update", marketplace]);

    const manifestPath = path.join(
      MARKETPLACE_HOME,
      ".claude",
      "plugins",
      "marketplaces",
      marketplace,
      "plugins",
      PLUGIN_NAME,
      ".claude-plugin",
      "plugin.json",
    );
    const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
    const latestVersion =
      manifest && typeof manifest.version === "string" ? manifest.version : undefined;

    let updated = false;
    if (latestVersion && compareVersions(latestVersion, installedVersion) > 0) {
      runClaude(["plugin", "update", `${PLUGIN_NAME}@${marketplace}`]);
      updated = true;
    }

    writeCache(cacheFile, {
      lastCheckedAt: new Date().toISOString(),
      lastKnownVersion: latestVersion ?? installedVersion,
    });

    if (updated) {
      process.stdout.write(
        JSON.stringify({
          hookSpecificOutput: {
            hookEventName: "SessionStart",
            additionalContext:
              `aia-harness was auto-updated in the background from ${installedVersion} to ${latestVersion}. ` +
              `Tell the user, and suggest running /reload-plugins (or starting a new session) to pick it up.`,
          },
        }),
      );
    }
    process.exit(0);
  } catch {
    writeCache(cacheFile, {
      lastCheckedAt: new Date().toISOString(),
      lastKnownVersion: cache.lastKnownVersion,
    });
    process.exit(0);
  }
}

main();
```

- [ ] **Step 6: Run to verify it passes**

Run: `node --test tests/hook-check-plugin-update.test.mjs`
Expected: PASS — all 22 tests pass (11 from Task 1 + 11 hook-level), 0 failures.

- [ ] **Step 7: Lint and typecheck**

Run: `npm run lint && npm run typecheck`
Expected: both clean (no errors).

- [ ] **Step 8: Commit**

```bash
git add hooks/scripts/check-plugin-update.mjs tests/fixtures/fake-claude-plugin-cli.mjs tests/hook-runner.mjs tests/hook-check-plugin-update.test.mjs
git commit -m "feat(hooks): add fail-open plugin self-update SessionStart hook"
```

---

### Task 3: Wire the hook into `plugin.json`, replacing the broken slot

**Files:**

- Modify: `.claude-plugin/plugin.json`
- Modify: `tests/hook-check-plugin-update.test.mjs` (append one regression test)

**Interfaces:**

- Consumes: `hooks/scripts/check-plugin-update.mjs` (Task 2) by path reference only.

- [ ] **Step 1: Write the failing regression test**

No new imports needed — `fs`, `path`, and the `ROOT` constant are already in
`tests/hook-check-plugin-update.test.mjs` from Task 2's Step 3. Append this
test at the bottom of the file:

```js
// ── plugin.json wiring ──────────────────────────────────────────────────────
test("plugin.json: SessionStart hook wired to check-plugin-update.mjs, no stale .sh reference", () => {
  const pluginJsonPath = path.join(ROOT, ".claude-plugin", "plugin.json");
  const manifest = JSON.parse(fs.readFileSync(pluginJsonPath, "utf8"));
  const entry = manifest.hooks?.SessionStart?.[0]?.hooks?.[0];
  assert.ok(entry, "expected a SessionStart hook entry");
  assert.equal(entry.type, "command");
  assert.equal(entry.command, "node");
  assert.deepEqual(entry.args, [
    "${CLAUDE_PLUGIN_ROOT}/hooks/scripts/check-plugin-update.mjs",
    "${CLAUDE_PLUGIN_DATA}",
  ]);
  assert.equal(typeof entry.timeout, "number");
  assert.ok(!JSON.stringify(manifest).includes(".sh"), "no leftover .sh hook reference");
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `node --test tests/hook-check-plugin-update.test.mjs`
Expected: FAIL on the new test — `plugin.json`'s current `SessionStart` entry still has `command: "\"${CLAUDE_PLUGIN_ROOT}/hooks/scripts/suggest-harness.sh\""` (shell-form, `.sh`), not `command: "node"` with the expected `args`. All other tests still pass.

- [ ] **Step 3: Replace the broken hook entry**

In `.claude-plugin/plugin.json`, replace:

```json
  "hooks": {
    "SessionStart": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "\"${CLAUDE_PLUGIN_ROOT}/hooks/scripts/suggest-harness.sh\"",
            "timeout": 10
          }
        ]
      }
    ]
  }
```

with:

```json
  "hooks": {
    "SessionStart": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "node",
            "args": [
              "${CLAUDE_PLUGIN_ROOT}/hooks/scripts/check-plugin-update.mjs",
              "${CLAUDE_PLUGIN_DATA}"
            ],
            "timeout": 20
          }
        ]
      }
    ]
  }
```

- [ ] **Step 4: Run to verify it passes**

Run: `node --test tests/hook-check-plugin-update.test.mjs`
Expected: PASS — all 23 tests pass, 0 failures.

- [ ] **Step 5: Full verification sweep**

Run: `npm test`
Expected: PASS — typecheck, lint, and the full `tests/*.test.mjs` unit suite (including this feature's 23 new tests) all green. Per this project's mandatory rule, any failure anywhere in the repo — not only in files this plan touched — must be fixed before this task is considered done.

- [ ] **Step 6: Commit**

```bash
git add .claude-plugin/plugin.json tests/hook-check-plugin-update.test.mjs
git commit -m "fix(plugin): wire SessionStart to check-plugin-update.mjs, replacing broken suggest-harness.sh slot"
```
