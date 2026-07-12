# Hooks Session-Scratchpad Migration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop first-party hooks from writing session-transient state to raw `os.tmpdir()` paths keyed by a project-directory hash — replace it with a shared `sessionScratchDir()` helper that resolves Claude Code's own pre-authorized, per-session scratchpad directory, fixing both the mid-session permission-prompt interruptions and a real cross-session/cross-worktree data-collision bug.

**Architecture:** Two combined mechanisms, mirroring how this exact problem was solved for real in a sibling project's production hardening pass. (1) **Primary fix:** one new library module (`templates/hooks/session-scratch.mjs`) exports `sessionScratchDir(sessionId, roots?)`, which searches for Claude Code's own `claude-*/**/​<sessionId>/scratchpad` directory (macOS-verified; falls back gracefully elsewhere) and returns a namespaced subdirectory inside it — created on demand. Six existing hooks and one hook generator migrate their flag/cache-file path construction from `path.join(os.tmpdir(), "aia-harness-...-" + sha1(projectDir))` to `path.join(sessionScratchDir(sessionId), "<name>")`. Because the scratch dir is already unique per session, per-row `sessionId` tagging inside shared files becomes redundant and is dropped where present. (2) **Safety net:** generated `settings.json` gains explicit `permissions.allow` entries for `/tmp/**`/`/private/tmp/**` and `/tmp`/`/private/tmp` in `permissions.additionalDirectories`, covering the resolver's fallback path (unrecognized platform/Claude Code version) so even that degraded case never interrupts the session.

**Tech Stack:** Node.js ESM (`.mjs`), `node:test` + `node:assert/strict`, no new dependencies.

## Global Constraints

- Every hook file stays `.mjs`, invoked via Node exec form — no shell scripts, no new runtimes (`.claude/rules/hooks-cross-platform.md`).
- Every `spawn`/`exec`/`execFile`/`fork` call (none are newly introduced by this plan) must keep `windowsHide: true`.
- No hardcoded `/private/tmp` literal — `/tmp` (which resolves through the macOS symlink to the same place) plus `os.tmpdir()` are the only search roots; the resolver must degrade gracefully (no throw) on any platform/version where the real scratchpad layout isn't found.
- Operational-directory vs stable-session-key resolution must keep following `.claude/rules/hooks-cwd-resolution.md`'s Purpose A / Purpose B split — this plan changes HOW Purpose-B state is stored (session-scratch instead of project-hash), not which hooks use Purpose A vs Purpose B.
- Every touched hook keeps exiting only `0` or `2`, keeps its exact existing `hookSpecificOutput`/`decision` schema shape — this plan changes *where hooks read/write internal state*, never their external event-schema contract. Every output branch must still pass its existing validator from `lib/validate/hook-schema.mjs` (`.claude/rules/hook-output-schema.md`).
- Every hook under `templates/hooks/` that is created or modified must have (or gain) a compliance test in `tests/hook-<name>.test.mjs` covering every output branch, asserted via the matching validator **and** `assertCleanStdoutJson` (`CLAUDE.md` "Hook output schema compliance — mandatory").
- `npm test` (typecheck + lint + unit) must be clean at the end of every task, and certainly at the end of the plan.
- New/changed distributable files under `templates/hooks/` must stay registered in the matching catalog (`lib/data/project-catalog.mjs`'s `PROJECT_HOOK_FILES`) per `CLAUDE.md`'s "Asset catalog — mandatory maintenance" rule.

---

## File Structure

**New:**
- `templates/hooks/session-scratch.mjs` — shared resolver, imported by other hooks via relative path (`./session-scratch.mjs`), copied into every target's `.claude/hooks/` via `PROJECT_HOOK_FILES`.
- `tests/session-scratch.test.mjs` — unit tests for the resolver (direct import, not a hook-compliance test — this module has no stdin/stdout contract).
- `tests/hook-set-files-changed.test.mjs` — currently missing entirely; added because this plan modifies that hook.

**Modified (distributed source):**
- `templates/hooks/set-files-changed.mjs`, `memory-stop.mjs`, `large-file-warning.mjs`, `sql-idempotent-review.mjs`, `worktree-prompt-ctx.mjs`, `validate-settings-schema.mjs`
- `lib/generate/verify.mjs` (generates the strict `verify-on-stop.mjs` as a string)
- `lib/data/project-catalog.mjs` (register the new file in `PROJECT_HOOK_FILES`)
- `lib/generate/settings.mjs` (defense-in-depth safety net for the fallback path — see Task 9)

**Modified (tests):**
- `tests/hook-memory-stop.test.mjs`, `tests/hook-large-file-warning.test.mjs`, `tests/hook-sql-idempotent-review.test.mjs`, `tests/hook-worktree-prompt-ctx.test.mjs`
- `tests/verify.test.mjs`, `tests/verify-hook.test.mjs`
- `tests/hook-validate-settings-schema.test.mjs` — verified below to need **no** changes to existing tests (every test that reaches the cache path already overrides `SETTINGS_SCHEMA_CACHE`); gains one new test.
- `tests/hook-verify-on-stop.test.mjs` — verified below to need **no** changes (tests the passive, non-tmp-using variant).

**Modified (rules):**
- `.claude/rules/hooks-cross-platform.md`, `.claude/rules/hooks-cwd-resolution.md`

**Modified (dogfood — this repo's own live `.claude/hooks/`):**
- `.claude/hooks/session-scratch.mjs` (new copy), `.claude/hooks/large-file-warning.mjs`, `.claude/hooks/validate-settings-schema.mjs`. **Not** `.claude/hooks/verify-on-stop.mjs` — confirmed below to be a different, hand-tailored non-blocking variant that never touches `os.tmpdir()`; out of scope, do not touch it.

---

### Task 1: `session-scratch.mjs` — the shared resolver

**Files:**
- Create: `templates/hooks/session-scratch.mjs`
- Create: `tests/session-scratch.test.mjs`
- Modify: `lib/data/project-catalog.mjs:100-114` (the `PROJECT_HOOK_FILES` array)

**Interfaces:**
- Produces: `export function sessionScratchDir(sessionId?: string, roots?: string[]): string` — every later task imports this from `./session-scratch.mjs` (hooks) or `../templates/hooks/session-scratch.mjs` (tests). Returns an absolute path to an **existing** directory (creates it if needed). `roots` is a test-only override; production callers never pass it.

**Context:** This is the foundational piece every other task depends on. It must ship first.

Why this exists: several hooks currently write session-transient flag/cache files via `path.join(os.tmpdir(), "aia-harness-...-" + sha1(CLAUDE_PROJECT_DIR).slice(0,12))`. Two problems: (1) raw `os.tmpdir()` writes fall outside Claude Code's pre-authorized per-session scratchpad and can trigger permission prompts mid-session; (2) hashing on `CLAUDE_PROJECT_DIR` — deliberately pinned per `.claude/rules/hooks-cwd-resolution.md` Purpose B, so it survives a *single* session entering/leaving a worktree — means **parallel** sessions of the *same* project (root + worktree A + worktree B, exactly the workflow `claude-code-worktrees` supports) collide on the identical file. `sessionScratchDir()` fixes both: it resolves Claude Code's own per-session scratch directory (pre-authorized, and inherently unique per session — no hash needed at all).

Platform note verified empirically on this machine: `os.tmpdir()` resolves to a per-user `/var/folders/.../T` path on macOS, which is **not** where Claude Code's scratchpad lives (`/private/tmp/claude-<uid>/...`). `/tmp` is a symlink to `/private/tmp` on macOS, so searching `/tmp` (not a hardcoded `/private/tmp` literal) finds it via Node's normal symlink-following `fs` calls. On Linux, `/tmp` and `os.tmpdir()` are typically the same path (harmless redundant scan). On Windows, neither `/tmp` nor `os.tmpdir()`'s scan is guaranteed to find a matching layout — the resolver falls back to a still-session-id-keyed (never project-hash-keyed) directory, so the cross-session collision bug is fixed everywhere even where prompt-avoidance can't be confirmed on this machine.

- [ ] **Step 1: Write the module**

Create `templates/hooks/session-scratch.mjs`:

```js
/**
 * Resolves Claude Code's own per-session scratchpad directory — the one
 * location a hook can write to without triggering a permission prompt, and
 * whose path is inherently unique per session (so parallel sessions/worktrees
 * of the same project never share state through it). See
 * .claude/rules/hooks-cwd-resolution.md for why per-project hashing (the
 * pattern this module replaces) collides across parallel sessions.
 *
 * Not a hook itself — a shared helper other hooks `import` by relative path.
 * Ships alongside them in .claude/hooks/ via PROJECT_HOOK_FILES.
 *
 * @module hooks/session-scratch
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const NAMESPACE = "aia-harness";

/**
 * Candidate roots to search for Claude Code's own `claude-*` scratch
 * directory. os.tmpdir() covers Linux/Windows (where it IS the real temp
 * root); "/tmp" covers macOS, where os.tmpdir() returns a per-user
 * /var/folders/... path that is NOT where Claude Code puts its scratchpad —
 * confirmed empirically: on macOS the real root lives under /private/tmp,
 * and "/tmp" is a symlink to it, so Node's fs calls resolve it transparently
 * without hardcoding the /private/tmp literal.
 * @returns {string[]}
 */
function defaultRoots() {
  return [os.tmpdir(), "/tmp"];
}

/**
 * @param {string} [sessionId]  From event.session_id. Falls back to a fixed
 *   key when absent/empty so callers always get a valid, existing directory.
 * @param {string[]} [roots]  Candidate search roots — override only in tests.
 * @returns {string} absolute path to this harness's scratch dir for the
 *   session — created if it doesn't exist yet.
 */
export function sessionScratchDir(sessionId, roots = defaultRoots()) {
  const raw = typeof sessionId === "string" && sessionId.trim() ? sessionId.trim() : "nosession";
  const sid = raw.replace(/[^a-zA-Z0-9_-]/g, "_");
  const found = findClaudeScratchRoot(sid, roots);
  const dir = found ?? fallbackRoot(sid);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

/**
 * Searches each candidate root for a `claude-*` directory holding
 * `<anything>/<sessionId>/scratchpad` — Claude Code's own per-session scratch
 * root. Returns null wherever no matching layout is found (older Claude
 * Code, unrecognized platform), leaving the caller to use the fallback.
 * @param {string} sid
 * @param {string[]} roots
 * @returns {string|null} the harness's namespaced subdir inside the real
 *   scratchpad, or null if nothing matched.
 */
function findClaudeScratchRoot(sid, roots) {
  const seen = new Set();
  for (const base of roots) {
    if (!base || seen.has(base)) continue;
    seen.add(base);

    /** @type {fs.Dirent[]} */
    let entries;
    try {
      entries = fs.readdirSync(base, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (!entry.isDirectory() || !entry.name.startsWith("claude-")) continue;
      const claudeDir = path.join(base, entry.name);
      /** @type {fs.Dirent[]} */
      let projectSlugs;
      try {
        projectSlugs = fs.readdirSync(claudeDir, { withFileTypes: true });
      } catch {
        continue;
      }
      for (const slugEntry of projectSlugs) {
        if (!slugEntry.isDirectory()) continue;
        const scratchpad = path.join(claudeDir, slugEntry.name, sid, "scratchpad");
        if (isDirectory(scratchpad)) return path.join(scratchpad, NAMESPACE);
      }
    }
  }
  return null;
}

/** @param {string} p @returns {boolean} */
function isDirectory(p) {
  try {
    return fs.statSync(p).isDirectory();
  } catch {
    return false;
  }
}

/**
 * Used only when the real scratchpad can't be located (unrecognized Claude
 * Code version/platform). Still keyed by session id alone — never by a
 * project-dir hash — so this fallback still avoids cross-session/cross-
 * worktree collisions even though it may not be permission-prompt-free.
 * @param {string} sid  Already sanitized by the caller.
 * @returns {string}
 */
function fallbackRoot(sid) {
  return path.join(os.tmpdir(), `${NAMESPACE}-session`, sid);
}
```

- [ ] **Step 2: Write the tests**

Create `tests/session-scratch.test.mjs`:

```js
/**
 * Unit tests for templates/hooks/session-scratch.mjs — the shared helper
 * hooks use to resolve Claude Code's per-session scratchpad directory
 * instead of a raw os.tmpdir()/project-hash path.
 *
 * Not a hook compliance test (no stdin/stdout/exit-code contract) — this
 * module is a plain library other hooks import, so it's tested via direct
 * function calls, like lib/generate/verify.mjs's own tests.
 *
 * Run: node --test tests/session-scratch.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { sessionScratchDir } from "../templates/hooks/session-scratch.mjs";

/** Create an isolated fake tmp root for a test. Caller cleans up. */
function mkFakeRoot() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "aia-scratch-test-"));
}

test("sessionScratchDir: returns an existing directory", () => {
  const root = mkFakeRoot();
  try {
    const dir = sessionScratchDir("s1", [root]);
    assert.equal(fs.existsSync(dir), true);
    assert.equal(fs.statSync(dir).isDirectory(), true);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("sessionScratchDir: two different session ids get two different directories", () => {
  const root = mkFakeRoot();
  try {
    const a = sessionScratchDir("session-A", [root]);
    const b = sessionScratchDir("session-B", [root]);
    assert.notEqual(a, b);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("sessionScratchDir: the same session id is stable across calls", () => {
  const root = mkFakeRoot();
  try {
    const a = sessionScratchDir("session-X", [root]);
    const b = sessionScratchDir("session-X", [root]);
    assert.equal(a, b);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("sessionScratchDir: missing/empty session id falls back to a fixed 'nosession' key, not a crash", () => {
  const root = mkFakeRoot();
  try {
    const a = sessionScratchDir(undefined, [root]);
    const b = sessionScratchDir("", [root]);
    assert.equal(fs.existsSync(a), true);
    assert.equal(a, b, "undefined and empty string both resolve to the same 'nosession' key");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("sessionScratchDir: finds a real claude-*/**/<sid>/scratchpad layout under a candidate root", () => {
  const root = mkFakeRoot();
  const sid = "real-session-123";
  const scratchpad = path.join(root, "claude-9999", "-some-project-slug", sid, "scratchpad");
  fs.mkdirSync(scratchpad, { recursive: true });
  try {
    const dir = sessionScratchDir(sid, [root]);
    // Must land INSIDE the discovered scratchpad (namespaced), not the fallback.
    assert.ok(
      dir.startsWith(scratchpad + path.sep) || dir === scratchpad,
      `expected ${dir} to be inside ${scratchpad}`,
    );
    assert.ok(
      !dir.includes("aia-harness-session"),
      "must not use the fallback when a real scratchpad exists",
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("sessionScratchDir: ignores an unrelated claude-* directory that has no matching session", () => {
  const root = mkFakeRoot();
  // A claude-* dir exists, but no <sid>/scratchpad inside it for THIS session.
  fs.mkdirSync(path.join(root, "claude-unrelated-tool"), { recursive: true });
  try {
    const dir = sessionScratchDir("no-match-session", [root]);
    assert.ok(dir.includes("aia-harness-session"), "expected the fallback path when nothing matches");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("sessionScratchDir: no candidate roots resolve (none exist) → falls back cleanly, no throw", () => {
  const nonexistentRoot = path.join(os.tmpdir(), "aia-scratch-does-not-exist-" + Date.now());
  const dir = sessionScratchDir("s-fallback", [nonexistentRoot]);
  try {
    assert.equal(fs.existsSync(dir), true);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("sessionScratchDir: session id is sanitized consistently (no path traversal / separators)", () => {
  const root = mkFakeRoot();
  const dir = sessionScratchDir("../../weird/id", [root]);
  try {
    assert.ok(!dir.includes(".." + path.sep + ".."), "session id must be sanitized, not used raw");
    assert.equal(fs.existsSync(dir), true);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("sessionScratchDir: default call (no roots argument) does not throw in a real environment", () => {
  // Exercises the real os.tmpdir()/"/tmp" default candidates — whatever this
  // machine's actual layout is, the call must still return a usable, existing
  // directory (either the real scratchpad or the fallback).
  const dir = sessionScratchDir("default-roots-smoke-test");
  assert.equal(fs.existsSync(dir), true);
  fs.rmSync(dir, { recursive: true, force: true });
});
```

- [ ] **Step 3: Run the new tests**

Run: `node --test tests/session-scratch.test.mjs`
Expected: all 9 tests PASS.

- [ ] **Step 4: Register the file in `PROJECT_HOOK_FILES`**

In `lib/data/project-catalog.mjs`, the array currently reads (lines ~100-114):

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
  "worktree-create.mjs",
  "worktree-remove.mjs",
  "check-deps-on-start.mjs",
  "validate-settings-schema.mjs",
];
```

Change to (new entry first, with a comment — it is not itself wired as a hook in settings.json, just a shared module several hooks in this same list `import`):

```js
export const PROJECT_HOOK_FILES = [
  // Shared helper (not a hook itself — imported by the hooks below via
  // relative path). Must ship first so the others can rely on it.
  "session-scratch.mjs",
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
  "worktree-create.mjs",
  "worktree-remove.mjs",
  "check-deps-on-start.mjs",
  "validate-settings-schema.mjs",
];
```

- [ ] **Step 5: Run the full suite to confirm nothing else broke**

Run: `npm test`
Expected: PASS (this addition is inert until later tasks wire hooks to import it — but plan-apply tests that snapshot `PROJECT_HOOK_FILES`'s file count/contents may need to notice the new entry; if any test fails asserting an exact file list or count, that is expected fallout from this step — update the failing assertion to include `"session-scratch.mjs"` rather than treating it as unrelated).

- [ ] **Step 6: Commit**

```bash
git add templates/hooks/session-scratch.mjs tests/session-scratch.test.mjs lib/data/project-catalog.mjs
git commit -m "feat(hooks): add session-scratch.mjs shared scratchpad resolver"
```

---

### Task 2: Migrate `set-files-changed.mjs` (+ add its missing compliance test)

**Files:**
- Modify: `templates/hooks/set-files-changed.mjs`
- Create: `tests/hook-set-files-changed.test.mjs` (currently does not exist at all — a pre-existing gap; mandatory to add since this task modifies the hook)

**Interfaces:**
- Consumes: `sessionScratchDir(sessionId)` from Task 1.
- Produces: writes `<sessionScratchDir>/files-changed` (newline-separated edited file paths) — Tasks 3, 4, and 8 read this exact file, via the exact same `sessionScratchDir(sessionId)` + `"files-changed"` filename. Keep this filename string identical in all four places.

**Context:** `set-files-changed.mjs` is the **writer** of the "files changed this session" flag. `memory-stop.mjs`, `large-file-warning.mjs`'s block mode, and the generated `verify-on-stop.mjs` are its **readers**. Today all four independently compute `path.join(os.tmpdir(), "aia-harness-changed-" + sha1(CLAUDE_PROJECT_DIR).slice(0,12))` — since `CLAUDE_PROJECT_DIR` is the same across parallel sessions of one project, two parallel sessions currently append to the literal same file, corrupting each other's "what changed" record. This task's writer-side fix is only half the picture; Tasks 3, 4, 8 must use the identical resolution.

- [ ] **Step 1: Read current file for reference**

Current `templates/hooks/set-files-changed.mjs` (44 lines) writes:
```js
const projectDir = process.env.CLAUDE_PROJECT_DIR ?? process.cwd();
const h = createHash("sha1").update(projectDir).digest("hex").slice(0, 12);
const flag = path.join(os.tmpdir(), `aia-harness-changed-${h}`);
```

- [ ] **Step 2: Replace the file's full content**

```js
#!/usr/bin/env node
/**
 * PostToolUse hook (strict mode): record files Claude edits this session so the
 * strict Stop hook (verify-on-stop.mjs) only runs lint/typecheck when code
 * actually changed. Appends the edited path to this session's scratch dir
 * (see session-scratch.mjs) — never a shared per-project file, so parallel
 * sessions/worktrees of the same project never mix each other's edited paths
 * (see .claude/rules/hooks-cwd-resolution.md). Never blocks: any failure exits 0.
 */
import fs from "node:fs";
import path from "node:path";
import { sessionScratchDir } from "./session-scratch.mjs";

/** @returns {string} */
function readStdin() {
  try {
    return fs.readFileSync(0, "utf8");
  } catch {
    return "";
  }
}

/** @type {any} */
let event = {};
try {
  event = JSON.parse(readStdin() || "{}");
} catch {
  process.exit(0);
}

const file = event?.tool_input?.file_path ?? event?.tool_input?.path;
if (!file || typeof file !== "string") process.exit(0);

const sessionId = typeof event.session_id === "string" ? event.session_id : "nosession";
const flag = path.join(sessionScratchDir(sessionId), "files-changed");

try {
  fs.appendFileSync(flag, file + "\n");
} catch {
  // Tracking is best-effort; never block the edit.
}

process.exit(0);
```

- [ ] **Step 3: Write the compliance test**

Create `tests/hook-set-files-changed.test.mjs`:

```js
/**
 * Schema compliance tests for templates/hooks/set-files-changed.mjs
 *
 * PostToolUse hook: never emits stdout, always exits 0 (best-effort tracking,
 * fail-open). Exercises every branch and validates against the PostToolUse
 * schema in lib/validate/hook-schema.mjs.
 *
 * Run: node --test tests/hook-set-files-changed.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { runHook, runHookRaw, assertCleanStdoutJson } from "./hook-runner.mjs";
import { validatePostToolUseOutput } from "../lib/validate/hook-schema.mjs";
import { sessionScratchDir } from "../templates/hooks/session-scratch.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const HOOK = path.join(ROOT, "templates", "hooks", "set-files-changed.mjs");

/** @param {import("./hook-runner.mjs").HookResult} r */
function assertSilent({ stdout, exitCode }) {
  const v = validatePostToolUseOutput(stdout, exitCode);
  assert.equal(v.valid, true, `Schema invalid: ${v.errors.join("; ")}`);
  assert.equal(exitCode, 0);
  assert.equal(stdout.trim(), "", "set-files-changed never writes stdout");
  assertCleanStdoutJson(stdout);
}

/** Path of the flag file this hook writes for a given session id. */
function flagPath(/** @type {string} */ sessionId) {
  return path.join(sessionScratchDir(sessionId), "files-changed");
}

test("set-files-changed: empty stdin → silent, exit 0", () => {
  assertSilent(runHookRaw(HOOK, ""));
});

test("set-files-changed: invalid JSON stdin → silent, exit 0", () => {
  assertSilent(runHookRaw(HOOK, "not-json"));
});

test("set-files-changed: missing tool_input → silent, exit 0, no file written", () => {
  assertSilent(runHook(HOOK, { session_id: "sA" }));
});

test("set-files-changed: tool_input.file_path present → appends to the session flag file", () => {
  const sid = "set-files-changed-test-1";
  const fp = flagPath(sid);
  try {
    fs.rmSync(fp, { force: true });
  } catch {
    /* ok */
  }
  try {
    assertSilent(
      runHook(HOOK, {
        session_id: sid,
        tool_input: { file_path: "/project/src/app.ts" },
      }),
    );
    assert.equal(fs.readFileSync(fp, "utf8"), "/project/src/app.ts\n");
  } finally {
    fs.rmSync(fp, { force: true });
  }
});

test("set-files-changed: tool_input.path (fallback field) is also accepted", () => {
  const sid = "set-files-changed-test-2";
  const fp = flagPath(sid);
  try {
    assertSilent(runHook(HOOK, { session_id: sid, tool_input: { path: "/project/src/b.ts" } }));
    assert.equal(fs.readFileSync(fp, "utf8"), "/project/src/b.ts\n");
  } finally {
    fs.rmSync(fp, { force: true });
  }
});

test("set-files-changed: two edits in the same session append, don't overwrite", () => {
  const sid = "set-files-changed-test-3";
  const fp = flagPath(sid);
  try {
    assertSilent(runHook(HOOK, { session_id: sid, tool_input: { file_path: "/a.ts" } }));
    assertSilent(runHook(HOOK, { session_id: sid, tool_input: { file_path: "/b.ts" } }));
    assert.equal(fs.readFileSync(fp, "utf8"), "/a.ts\n/b.ts\n");
  } finally {
    fs.rmSync(fp, { force: true });
  }
});

test("set-files-changed: missing session_id falls back to a fixed key, does not crash", () => {
  const fp = flagPath("nosession");
  try {
    assertSilent(runHook(HOOK, { tool_input: { file_path: "/c.ts" } }));
    assert.ok(fs.readFileSync(fp, "utf8").includes("/c.ts"));
  } finally {
    fs.rmSync(fp, { force: true });
  }
});

test("set-files-changed: two different session ids never mix — parallel-session isolation", () => {
  const sidA = "set-files-changed-parallel-A";
  const sidB = "set-files-changed-parallel-B";
  const fpA = flagPath(sidA);
  const fpB = flagPath(sidB);
  try {
    assertSilent(runHook(HOOK, { session_id: sidA, tool_input: { file_path: "/from-A.ts" } }));
    assertSilent(runHook(HOOK, { session_id: sidB, tool_input: { file_path: "/from-B.ts" } }));
    assert.equal(fs.readFileSync(fpA, "utf8"), "/from-A.ts\n");
    assert.equal(fs.readFileSync(fpB, "utf8"), "/from-B.ts\n");
  } finally {
    fs.rmSync(fpA, { force: true });
    fs.rmSync(fpB, { force: true });
  }
});
```

- [ ] **Step 4: Run the tests**

Run: `node --test tests/hook-set-files-changed.test.mjs`
Expected: all 8 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add templates/hooks/set-files-changed.mjs tests/hook-set-files-changed.test.mjs
git commit -m "fix(hooks): set-files-changed.mjs uses session scratch dir, not project-hash tmpdir"
```

---

### Task 3: Migrate `memory-stop.mjs`

**Files:**
- Modify: `templates/hooks/memory-stop.mjs`
- Modify: `tests/hook-memory-stop.test.mjs`

**Interfaces:**
- Consumes: `sessionScratchDir(sessionId)` (Task 1); reads the SAME `"files-changed"` file Task 2's hook writes.

**Context:** `memory-stop.mjs` is a **reader** of the flag file `set-files-changed.mjs` writes. It also independently uses `CLAUDE_PROJECT_DIR` (unrelated to the flag) to locate `.claude/memory/MEMORY.md` — that usage stays unchanged, only the flag-file path construction changes.

- [ ] **Step 1: Replace the import block and flag construction**

In `templates/hooks/memory-stop.mjs`, replace:

```js
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
```

with:

```js
import fs from "node:fs";
import path from "node:path";
import { sessionScratchDir } from "./session-scratch.mjs";
```

Then replace:

```js
const projectDir = process.env.CLAUDE_PROJECT_DIR ?? process.cwd();

// Read the session flag file populated by set-files-changed.mjs (one path per line).
const h = createHash("sha1").update(projectDir).digest("hex").slice(0, 12);
const flag = path.join(os.tmpdir(), `aia-harness-changed-${h}`);
```

with:

```js
const projectDir = process.env.CLAUDE_PROJECT_DIR ?? process.cwd();
const sessionId = typeof event?.session_id === "string" ? event.session_id : "nosession";

// Read the session flag file populated by set-files-changed.mjs (one path per line).
const flag = path.join(sessionScratchDir(sessionId), "files-changed");
```

(`projectDir` stays — it is still used below for `path.join(projectDir, ".claude", "memory", "MEMORY.md")`. Only the hash-based `flag` construction is replaced.)

- [ ] **Step 2: Replace the test file's full content**

```js
/**
 * Schema compliance tests for templates/hooks/memory-stop.mjs
 *
 * Exercises EVERY output path and validates stdout + exit code against the
 * Stop hook schema defined in lib/validate/hook-schema.mjs.
 *
 * Run: node --test tests/hook-memory-stop.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { runHook, runHookRaw, assertCleanStdoutJson } from "./hook-runner.mjs";
import { validateStopOutput } from "../lib/validate/hook-schema.mjs";
import { sessionScratchDir } from "../templates/hooks/session-scratch.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const HOOK = path.join(ROOT, "templates", "hooks", "memory-stop.mjs");

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Compute the flag file path that memory-stop reads (same as set-files-changed).
 * @param {string} sessionId
 * @returns {string}
 */
function flagPath(sessionId) {
  return path.join(sessionScratchDir(sessionId), "files-changed");
}

/**
 * Write lines to the session flag file.
 * @param {string} sessionId
 * @param {string[]} files
 */
function writeFlag(sessionId, files) {
  fs.writeFileSync(flagPath(sessionId), files.join("\n") + "\n");
}

/**
 * @param {import("./hook-runner.mjs").HookResult} result
 */
function assertSilentApprove({ stdout, exitCode }) {
  const r = validateStopOutput(stdout, exitCode);
  assert.equal(r.valid, true, `Schema invalid: ${r.errors.join("; ")}`);
  assert.equal(exitCode, 0);
  assert.equal(stdout.trim(), "", "expected empty stdout (silent approve)");
  assertCleanStdoutJson(stdout);
}

/**
 * @param {import("./hook-runner.mjs").HookResult} result
 * @returns {any} parsed systemMessage object
 */
function assertSystemMessage({ stdout, exitCode }) {
  const r = validateStopOutput(stdout, exitCode);
  assert.equal(r.valid, true, `Schema invalid: ${r.errors.join("; ")}`);
  assert.equal(exitCode, 0);
  assertCleanStdoutJson(stdout);
  const parsed = JSON.parse(stdout);
  assert.ok(
    typeof parsed.systemMessage === "string" && parsed.systemMessage.length > 0,
    "expected non-empty systemMessage",
  );
  return parsed;
}

/** Create and return a temp project dir. Caller cleans up. */
function mkTmpProject() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "aia-ms-"));
}

/** Derive a unique-enough session id from a temp project dir's own name. */
function sidFor(dir) {
  return path.basename(dir);
}

// ---------------------------------------------------------------------------
// Path 1: stop_hook_active guard
// ---------------------------------------------------------------------------

test("memory-stop: stop_hook_active → silent approve (anti-loop)", () => {
  const dir = mkTmpProject();
  try {
    assertSilentApprove(
      runHook(
        HOOK,
        { stop_hook_active: true, session_id: sidFor(dir) },
        { env: { CLAUDE_PROJECT_DIR: dir } },
      ),
    );
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// Path 2: invalid / empty stdin → fail-open
// ---------------------------------------------------------------------------

test("memory-stop: invalid JSON stdin → fail-open, silent approve", () => {
  const dir = mkTmpProject();
  try {
    assertSilentApprove(runHookRaw(HOOK, "not-json", { env: { CLAUDE_PROJECT_DIR: dir } }));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("memory-stop: empty stdin → fail-open, silent approve", () => {
  const dir = mkTmpProject();
  try {
    assertSilentApprove(runHookRaw(HOOK, "", { env: { CLAUDE_PROJECT_DIR: dir } }));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// Path 3: no flag file → nothing edited, silent approve
// ---------------------------------------------------------------------------

test("memory-stop: no flag file → silent approve (nothing edited)", () => {
  const dir = mkTmpProject();
  const sid = sidFor(dir);
  try {
    fs.unlinkSync(flagPath(sid));
  } catch {
    /* ok */
  }
  try {
    assertSilentApprove(runHook(HOOK, { session_id: sid }, { env: { CLAUDE_PROJECT_DIR: dir } }));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// Path 4: flag file exists but only non-source files → silent approve
// ---------------------------------------------------------------------------

test("memory-stop: only docs/images/locks edited → silent approve", () => {
  const dir = mkTmpProject();
  const sid = sidFor(dir);
  writeFlag(sid, [
    "/project/README.md",
    "/project/docs/guide.md",
    "/project/logo.png",
    "/project/package-lock.json",
    "/project/.gitignore",
    "/project/yarn.lock",
    "/project/foo.md",
    "/project/bar.md",
    "/project/baz.md",
    "/project/qux.md",
    "/project/quux.md",
    "/project/corge.md",
    "/project/grault.md",
    "/project/garply.md",
    "/project/waldo.md",
    "/project/fred.md",
  ]);
  try {
    assertSilentApprove(runHook(HOOK, { session_id: sid }, { env: { CLAUDE_PROJECT_DIR: dir } }));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
    try {
      fs.unlinkSync(flagPath(sid));
    } catch {
      /* ok */
    }
  }
});

// ---------------------------------------------------------------------------
// Path 5: source files edited but below complexity threshold → silent approve
// ---------------------------------------------------------------------------

test("memory-stop: 1 source file, 3 total ops → below threshold, silent approve", () => {
  const dir = mkTmpProject();
  const sid = sidFor(dir);
  writeFlag(sid, ["/project/src/index.ts", "/project/src/index.ts", "/project/src/index.ts"]);
  try {
    assertSilentApprove(runHook(HOOK, { session_id: sid }, { env: { CLAUDE_PROJECT_DIR: dir } }));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
    try {
      fs.unlinkSync(flagPath(sid));
    } catch {
      /* ok */
    }
  }
});

test("memory-stop: 2 source files, 10 total ops → below threshold, silent approve", () => {
  const dir = mkTmpProject();
  const sid = sidFor(dir);
  const files = ["/project/src/a.ts", "/project/src/b.ts"];
  writeFlag(
    sid,
    Array.from({ length: 10 }, (_, i) => files[i % 2]),
  );
  try {
    assertSilentApprove(runHook(HOOK, { session_id: sid }, { env: { CLAUDE_PROJECT_DIR: dir } }));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
    try {
      fs.unlinkSync(flagPath(sid));
    } catch {
      /* ok */
    }
  }
});

// ---------------------------------------------------------------------------
// Path 6: enough total ops (≥ 15) with source files → systemMessage
// ---------------------------------------------------------------------------

test("memory-stop: 1 source file, 15 total ops → systemMessage, exit 0", () => {
  const dir = mkTmpProject();
  const sid = sidFor(dir);
  writeFlag(
    sid,
    Array.from({ length: 15 }, () => "/project/src/index.ts"),
  );
  try {
    assertSystemMessage(runHook(HOOK, { session_id: sid }, { env: { CLAUDE_PROJECT_DIR: dir } }));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
    try {
      fs.unlinkSync(flagPath(sid));
    } catch {
      /* ok */
    }
  }
});

// ---------------------------------------------------------------------------
// Path 7: enough unique source files (≥ 3) → systemMessage regardless of total ops
// ---------------------------------------------------------------------------

test("memory-stop: 3 unique source files, 5 ops → systemMessage, exit 0", () => {
  const dir = mkTmpProject();
  const sid = sidFor(dir);
  writeFlag(sid, [
    "/project/src/a.ts",
    "/project/src/b.ts",
    "/project/src/c.go",
    "/project/README.md",
    "/project/package.json",
  ]);
  try {
    assertSystemMessage(runHook(HOOK, { session_id: sid }, { env: { CLAUDE_PROJECT_DIR: dir } }));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
    try {
      fs.unlinkSync(flagPath(sid));
    } catch {
      /* ok */
    }
  }
});

// ---------------------------------------------------------------------------
// Path 8: saturated MEMORY.md (≥ 130 lines) → systemMessage includes sanitation note
// ---------------------------------------------------------------------------

test("memory-stop: saturated MEMORY.md → systemMessage with sanitation note", () => {
  const dir = mkTmpProject();
  const sid = sidFor(dir);
  const memoryDir = path.join(dir, ".claude", "memory");
  fs.mkdirSync(memoryDir, { recursive: true });
  const indexLines = Array.from(
    { length: 135 },
    (_, i) => `- [Memory ${i}](memory-${i}.md) — entry ${i}`,
  );
  fs.writeFileSync(path.join(memoryDir, "MEMORY.md"), indexLines.join("\n") + "\n");

  writeFlag(sid, ["/project/src/a.ts", "/project/src/b.ts", "/project/src/c.ts"]);
  try {
    const parsed = assertSystemMessage(
      runHook(HOOK, { session_id: sid }, { env: { CLAUDE_PROJECT_DIR: dir } }),
    );
    assert.ok(
      parsed.systemMessage.includes("sanitation"),
      "expected sanitation note in systemMessage when MEMORY.md is saturated",
    );
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
    try {
      fs.unlinkSync(flagPath(sid));
    } catch {
      /* ok */
    }
  }
});

// ---------------------------------------------------------------------------
// Path 9: MEMORY.md under threshold → no sanitation note
// ---------------------------------------------------------------------------

test("memory-stop: MEMORY.md under threshold → no sanitation note in systemMessage", () => {
  const dir = mkTmpProject();
  const sid = sidFor(dir);
  const memoryDir = path.join(dir, ".claude", "memory");
  fs.mkdirSync(memoryDir, { recursive: true });
  const indexLines = Array.from(
    { length: 10 },
    (_, i) => `- [Memory ${i}](memory-${i}.md) — entry ${i}`,
  );
  fs.writeFileSync(path.join(memoryDir, "MEMORY.md"), indexLines.join("\n") + "\n");

  writeFlag(sid, ["/project/src/a.ts", "/project/src/b.ts", "/project/src/c.ts"]);
  try {
    const parsed = assertSystemMessage(
      runHook(HOOK, { session_id: sid }, { env: { CLAUDE_PROJECT_DIR: dir } }),
    );
    assert.ok(
      !parsed.systemMessage.includes("sanitation"),
      "expected no sanitation note when MEMORY.md is under threshold",
    );
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
    try {
      fs.unlinkSync(flagPath(sid));
    } catch {
      /* ok */
    }
  }
});

// ---------------------------------------------------------------------------
// Path 10: lock/generated files excluded even with source ext
// ---------------------------------------------------------------------------

test("memory-stop: lock files excluded even if they look like source", () => {
  const dir = mkTmpProject();
  const sid = sidFor(dir);
  writeFlag(
    sid,
    Array.from({ length: 20 }, () => "/project/go.sum"),
  );
  try {
    assertSilentApprove(runHook(HOOK, { session_id: sid }, { env: { CLAUDE_PROJECT_DIR: dir } }));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
    try {
      fs.unlinkSync(flagPath(sid));
    } catch {
      /* ok */
    }
  }
});

// ---------------------------------------------------------------------------
// Path 11: parallel-session isolation — a different session's flag never leaks in
// ---------------------------------------------------------------------------

test("memory-stop: a different session's flag file never leaks into this session's check", () => {
  const dir = mkTmpProject();
  const sid = sidFor(dir);
  const otherSid = `${sid}-other`;
  writeFlag(
    otherSid,
    Array.from({ length: 20 }, () => "/project/src/other-session.ts"),
  );
  try {
    assertSilentApprove(runHook(HOOK, { session_id: sid }, { env: { CLAUDE_PROJECT_DIR: dir } }));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
    try {
      fs.unlinkSync(flagPath(sid));
    } catch {
      /* ok */
    }
    try {
      fs.unlinkSync(flagPath(otherSid));
    } catch {
      /* ok */
    }
  }
});
```

- [ ] **Step 3: Run the tests**

Run: `node --test tests/hook-memory-stop.test.mjs`
Expected: all 12 tests PASS.

- [ ] **Step 4: Commit**

```bash
git add templates/hooks/memory-stop.mjs tests/hook-memory-stop.test.mjs
git commit -m "fix(hooks): memory-stop.mjs reads the session-scratch flag file, not project-hash tmpdir"
```

---

### Task 4: Migrate `large-file-warning.mjs`

**Files:**
- Modify: `templates/hooks/large-file-warning.mjs`
- Modify: `tests/hook-large-file-warning.test.mjs`

**Interfaces:**
- Consumes: `sessionScratchDir(sessionId)` (Task 1). `blockOnStop()`'s `flag` reads the SAME `"files-changed"` file as Tasks 2/3/8 (must use the identical filename string).
- Produces: `advisory()`'s de-dup file at `<sessionScratchDir>/largefile-notified`.

**Context:** Two independent flag mechanisms in one file. `advisory()` (PostToolUse) already reads `event.session_id` and tags each row `${sessionId}\t${abs}` inside a project-hash-keyed shared file — once the file itself becomes session-scoped, the row no longer needs the `sessionId` prefix (it's redundant: the file is already unique per session). `blockOnStop()` (Stop) reads the same `"files-changed"` file `set-files-changed.mjs` writes, currently via the buggy project-hash path — this is the block-mode analog of Task 2/3's fix.

- [ ] **Step 1: Replace the import block**

Replace:

```js
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
```

with:

```js
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { sessionScratchDir } from "./session-scratch.mjs";
```

- [ ] **Step 2: Drop the now-unused `projHash` top-level constant**

Replace:

```js
const projectDir = process.env.CLAUDE_PROJECT_DIR ?? process.cwd();
const projHash = createHash("sha1").update(projectDir).digest("hex").slice(0, 12);
const execDir = (typeof event.cwd === "string" && event.cwd && event.cwd) || projectDir;
```

with:

```js
const projectDir = process.env.CLAUDE_PROJECT_DIR ?? process.cwd();
const execDir = (typeof event.cwd === "string" && event.cwd && event.cwd) || projectDir;
```

- [ ] **Step 3: Update `advisory()`'s de-dup flag**

Replace:

```js
  // De-dup: notify at most once per (session, file).
  const sessionId = typeof event.session_id === "string" ? event.session_id : "nosession";
  const notifiedFlag = path.join(os.tmpdir(), `aia-harness-largefile-notified-${projHash}`);
  const key = `${sessionId}\t${abs}`;
  try {
    if (fs.readFileSync(notifiedFlag, "utf8").split(/\r?\n/).includes(key)) return;
  } catch {
    // No flag yet — first notice this session.
  }
  try {
    fs.appendFileSync(notifiedFlag, key + "\n");
  } catch {
    // Best-effort; a missed de-dup only repeats the (harmless) advice.
  }
```

with:

```js
  // De-dup: notify at most once per (session, file). The scratch dir is
  // itself session-scoped, so the file no longer needs a session prefix —
  // see templates/hooks/session-scratch.mjs.
  const sessionId = typeof event.session_id === "string" ? event.session_id : "nosession";
  const notifiedFlag = path.join(sessionScratchDir(sessionId), "largefile-notified");
  try {
    if (fs.readFileSync(notifiedFlag, "utf8").split(/\r?\n/).includes(abs)) return;
  } catch {
    // No flag yet — first notice this session.
  }
  try {
    fs.appendFileSync(notifiedFlag, abs + "\n");
  } catch {
    // Best-effort; a missed de-dup only repeats the (harmless) advice.
  }
```

- [ ] **Step 4: Update `blockOnStop()`'s flag read**

Replace:

```js
  /** @type {string[]} */
  let candidates = [];
  const flag = path.join(os.tmpdir(), `aia-harness-changed-${projHash}`);
```

with:

```js
  /** @type {string[]} */
  let candidates = [];
  const sessionId = typeof event.session_id === "string" ? event.session_id : "nosession";
  const flag = path.join(sessionScratchDir(sessionId), "files-changed");
```

- [ ] **Step 5: Update the docstring's flag description**

Near the top of the file, the comment block currently doesn't mention `os.tmpdir()` explicitly (it describes behavior, not storage), so no change is required there — confirm by re-reading the top docstring after Steps 1-4; if it mentions "OS temp dir" anywhere, update it to say "this session's scratch dir (session-scratch.mjs)".

- [ ] **Step 6: Update test helpers and every call site**

In `tests/hook-large-file-warning.test.mjs`, replace the import block:

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { runHook, runHookRaw, mkGitRepo, assertCleanStdoutJson } from "./hook-runner.mjs";
import { validateStopOutput, validatePostToolUseOutput } from "../lib/validate/hook-schema.mjs";
```

with:

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { runHook, runHookRaw, mkGitRepo, assertCleanStdoutJson } from "./hook-runner.mjs";
import { validateStopOutput, validatePostToolUseOutput } from "../lib/validate/hook-schema.mjs";
import { sessionScratchDir } from "../templates/hooks/session-scratch.mjs";
```

Replace the `flagDir`/`writeFlag`/`notifiedFlag` helpers:

```js
const flagDir = (/** @type {string} */ d) =>
  createHash("sha1").update(d).digest("hex").slice(0, 12);

/**
 * Write the session flag file that set-files-changed.mjs would create.
 * @param {string} projectDir
 * @param {string[]} files
 */
function writeFlag(projectDir, files) {
  const flag = path.join(os.tmpdir(), `aia-harness-changed-${flagDir(projectDir)}`);
  fs.writeFileSync(flag, files.join("\n") + "\n");
  return flag;
}

/** Path of the advisory de-dup flag for a project dir. */
const notifiedFlag = (/** @type {string} */ projectDir) =>
  path.join(os.tmpdir(), `aia-harness-largefile-notified-${flagDir(projectDir)}`);
```

with:

```js
/**
 * Write the session flag file that set-files-changed.mjs would create.
 * @param {string} sessionId
 * @param {string[]} files
 */
function writeFlag(sessionId, files) {
  const flag = path.join(sessionScratchDir(sessionId), "files-changed");
  fs.writeFileSync(flag, files.join("\n") + "\n");
  return flag;
}

/** Path of the advisory de-dup flag for a session id. */
const notifiedFlag = (/** @type {string} */ sessionId) =>
  path.join(sessionScratchDir(sessionId), "largefile-notified");
```

The `editEvent` helper already carries a `session_id` (defaulting to `"s1"`) — no change needed there:

```js
const editEvent = (/** @type {string} */ file, /** @type {string} */ session = "s1") => ({
  hook_event_name: "PostToolUse",
  session_id: session,
  tool_input: { file_path: file },
});
```

**Now apply this substitution rule to every remaining call site in the file** — every call listed below follows one of three shapes; apply the matching replacement to each by test name:

**Shape A — BLOCK-mode tests that call `writeFlag(dir, [...])` with no explicit session id.** Add `const sid = path.basename(dir);` right after the `dir` is created, change `writeFlag(dir, ...)` → `writeFlag(sid, ...)`, and add `session_id: sid` to the event object passed to `runHook`. Applies to these tests (by their exact current title): `"block: source file under 350 lines → silent"`, the `for` loop generating `"block: oversized ${label} → silent (filtered)"` (4 cases), `"block: oversized file in node_modules → silent (filtered)"`, the `for` loop generating `"block: ${lang} file over 350 lines → blocks, schema-valid"` (4 cases), `"block: explicit hook_event_name=Stop with oversized file → blocks"`, `"block: multiple oversized files → blocks with both listed"`, `"block: stop_hook_active with oversized file → silent (anti-loop)"`, `"block: oversized file in templates/ → silent (filtered as vendored)"`.

Worked example for `"block: source file under 350 lines → silent"` (before):
```js
test("block: source file under 350 lines → silent", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "aia-lfw-"));
  const file = path.join(dir, "small.ts");
  writeLines(file, 100);
  const flag = writeFlag(dir, [file]);
  try {
    assertSilentStop(runHook(HOOK, {}, { env: { CLAUDE_PROJECT_DIR: dir } }));
  } finally {
    fs.rmSync(flag, { force: true });
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
```
(after):
```js
test("block: source file under 350 lines → silent", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "aia-lfw-"));
  const sid = path.basename(dir);
  const file = path.join(dir, "small.ts");
  writeLines(file, 100);
  const flag = writeFlag(sid, [file]);
  try {
    assertSilentStop(runHook(HOOK, { session_id: sid }, { env: { CLAUDE_PROJECT_DIR: dir } }));
  } finally {
    fs.rmSync(flag, { force: true });
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
```
Apply the identical `dir` → `sid` substitution (declare `sid`, pass it to `writeFlag`, add `session_id: sid` to the event literal — merging it into any existing event object like `{ hook_event_name: "Stop" }` → `{ hook_event_name: "Stop", session_id: sid }`) to every other test named above.

**Shape B — BLOCK-mode tests with NO flag file at all (fall back to `git status`) — unaffected.** `"block: oversized file in git status (no flag file) → blocks"`, `"block: small file in git status (no flag file) → silent"`, and `"block: event.cwd worktree with oversized file in git status (CLAUDE_PROJECT_DIR is a different clean dir) → blocks"` never call `writeFlag`/`notifiedFlag` — leave these three tests completely unchanged.

**Shape C — ADVISORY-mode tests that call `notifiedFlag(dir)` in cleanup, with `editEvent(file, session)` already supplying a session id.** Change `notifiedFlag(dir)` → `notifiedFlag(sessionIdUsed)`, where `sessionIdUsed` is whatever string was actually passed as `editEvent`'s second argument (or `"s1"`, `editEvent`'s default, when the call omits it). Applies to: `"advisory: oversized just-edited source → additionalContext, schema-valid"` (uses default `"s1"`), the `for` loop generating `"advisory: oversized ${label} → silent (filtered)"` (2 cases, default `"s1"`), `"advisory: oversized file in templates/ → silent (filtered as vendored)"` (default `"s1"`), `"advisory: oversized file in node_modules → silent (filtered)"` (default `"s1"`), `"advisory: missing tool_input.file_path → silent"` (explicit `session_id: "s1"` in a hand-built event — keep the event as-is, just fix the cleanup call), `"advisory: just-edited file under 350 lines → silent"` (default `"s1"`), `"advisory: de-dup — second edit of same file in same session → silent"` (explicit `"sX"`), `"advisory: a new session re-notifies the same file"` (uses BOTH `"sA"` and `"sB"` — this one needs `notifiedFlag("sA")` AND `notifiedFlag("sB")` both cleaned up, since it exercises two different sessions on purpose).

Worked example for `"advisory: oversized just-edited source → additionalContext, schema-valid"` (before):
```js
test("advisory: oversized just-edited source → additionalContext, schema-valid", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "aia-lfw-"));
  const file = path.join(dir, "service.ts");
  writeLines(file, 400);
  try {
    const ctx = assertAdvise(runHook(HOOK, editEvent(file), { env: { CLAUDE_PROJECT_DIR: dir } }));
    assert.ok(ctx.includes("service.ts"), "should name the file");
    assert.ok(/approval/i.test(ctx), "should require user approval (no autonomous refactor)");
  } finally {
    fs.rmSync(notifiedFlag(dir), { force: true });
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
```
(after — `editEvent(file)` defaults its session to `"s1"`, so cleanup targets `notifiedFlag("s1")`):
```js
test("advisory: oversized just-edited source → additionalContext, schema-valid", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "aia-lfw-"));
  const file = path.join(dir, "service.ts");
  writeLines(file, 400);
  try {
    const ctx = assertAdvise(runHook(HOOK, editEvent(file), { env: { CLAUDE_PROJECT_DIR: dir } }));
    assert.ok(ctx.includes("service.ts"), "should name the file");
    assert.ok(/approval/i.test(ctx), "should require user approval (no autonomous refactor)");
  } finally {
    fs.rmSync(notifiedFlag("s1"), { force: true });
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
```
And for the two-session test `"advisory: a new session re-notifies the same file"` (before):
```js
test("advisory: a new session re-notifies the same file", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "aia-lfw-"));
  const file = path.join(dir, "service.ts");
  writeLines(file, 400);
  try {
    assertAdvise(runHook(HOOK, editEvent(file, "sA"), { env: { CLAUDE_PROJECT_DIR: dir } }));
    assertAdvise(runHook(HOOK, editEvent(file, "sB"), { env: { CLAUDE_PROJECT_DIR: dir } }));
  } finally {
    fs.rmSync(notifiedFlag(dir), { force: true });
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
```
(after):
```js
test("advisory: a new session re-notifies the same file", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "aia-lfw-"));
  const file = path.join(dir, "service.ts");
  writeLines(file, 400);
  try {
    assertAdvise(runHook(HOOK, editEvent(file, "sA"), { env: { CLAUDE_PROJECT_DIR: dir } }));
    assertAdvise(runHook(HOOK, editEvent(file, "sB"), { env: { CLAUDE_PROJECT_DIR: dir } }));
  } finally {
    fs.rmSync(notifiedFlag("sA"), { force: true });
    fs.rmSync(notifiedFlag("sB"), { force: true });
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
```

**Shape D — the two "relative file_path resolves against event.cwd" and CRLF tests, which use two DIFFERENT dirs (`worktree`/`tmpDir` for content, `cleanProjectDir` for `CLAUDE_PROJECT_DIR`).** For `"advisory: relative file_path resolves against event.cwd, not CLAUDE_PROJECT_DIR"`: the event already hand-builds `session_id: "s1"` — keep it, just change the cleanup from `notifiedFlag(cleanProjectDir)` to `notifiedFlag("s1")`. For `"block: event.cwd worktree with oversized file in git status..."`: this is Shape B (no flag file), already excluded above. For the CRLF test `"block: CRLF line endings in flag file → parses correctly (Stop mode)"`: replace

```js
test("block: CRLF line endings in flag file → parses correctly (Stop mode)", () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "lfw-crlf-test-"));
  try {
    const srcFile = path.join(tmpDir, "big.ts");
    fs.writeFileSync(srcFile, "const x = 1;\n".repeat(400));

    const flagFile = path.join(os.tmpdir(), `aia-harness-changed-${flagDir(tmpDir)}`);
    fs.writeFileSync(flagFile, `${srcFile}\r\n`);

    try {
      const r = runHook(HOOK, { hook_event_name: "Stop" }, { env: { CLAUDE_PROJECT_DIR: tmpDir } });
```

with:

```js
test("block: CRLF line endings in flag file → parses correctly (Stop mode)", () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "lfw-crlf-test-"));
  const sid = path.basename(tmpDir);
  try {
    const srcFile = path.join(tmpDir, "big.ts");
    fs.writeFileSync(srcFile, "const x = 1;\n".repeat(400));

    const flagFile = path.join(sessionScratchDir(sid), "files-changed");
    fs.writeFileSync(flagFile, `${srcFile}\r\n`);

    try {
      const r = runHook(
        HOOK,
        { hook_event_name: "Stop", session_id: sid },
        { env: { CLAUDE_PROJECT_DIR: tmpDir } },
      );
```

(the rest of that test body is unchanged).

- [ ] **Step 7: Add a parallel-session isolation regression test**

Append to the end of the file (before the final closing, as a new top-level test):

```js
// ===========================================================================
// Parallel-session isolation (the bug this migration fixes)
// ===========================================================================

test("block: a different session's oversized-file flag never leaks into this session's check", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "aia-lfw-"));
  const sid = path.basename(dir);
  const otherSid = `${sid}-other`;
  const file = path.join(dir, "service.ts");
  writeLines(file, 400);
  // Another "parallel session" on the SAME project dir flags a DIFFERENT file.
  const otherFlag = writeFlag(otherSid, [path.join(dir, "other-session-file.ts")]);
  try {
    // This session's own flag was never written for `file` — must stay silent.
    assertSilentStop(runHook(HOOK, { session_id: sid }, { env: { CLAUDE_PROJECT_DIR: dir } }));
  } finally {
    fs.rmSync(otherFlag, { force: true });
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
```

- [ ] **Step 8: Run the tests**

Run: `node --test tests/hook-large-file-warning.test.mjs`
Expected: all tests PASS (33 original + 1 new = 34).

- [ ] **Step 9: Commit**

```bash
git add templates/hooks/large-file-warning.mjs tests/hook-large-file-warning.test.mjs
git commit -m "fix(hooks): large-file-warning.mjs uses session scratch dir for both flags"
```

---

### Task 5: Migrate `sql-idempotent-review.mjs`

**Files:**
- Modify: `templates/hooks/sql-idempotent-review.mjs`
- Modify: `tests/hook-sql-idempotent-review.test.mjs`

**Interfaces:**
- Consumes: `sessionScratchDir(sessionId)` (Task 1).
- Produces: `<sessionScratchDir>/sql-notified`.

**Context:** Unlike Tasks 2-4, this hook's *content* already tags each row with `${sessionId}\t${absPath}` inside a **shared, project-hash-keyed** file — so it does not have the cross-session correctness bug the others have (a Stop-mode sweep from session B correctly ignores session A's rows, since it filters by its own `sessionId` prefix). This migration is about the permission-prompt problem only, but it also lets the row-tagging simplify: once the file itself is session-scoped, the `${sessionId}\t` prefix is redundant.

- [ ] **Step 1: Replace the import block and module-level constants**

Replace:

```js
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
```

with:

```js
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { sessionScratchDir } from "./session-scratch.mjs";
```

Replace:

```js
const projectDir = process.env.CLAUDE_PROJECT_DIR ?? process.cwd();
const projHash = createHash("sha1").update(projectDir).digest("hex").slice(0, 12);
const NOTIFIED_FLAG = path.join(os.tmpdir(), `aia-harness-sql-notified-${projHash}`);
```

with:

```js
const projectDir = process.env.CLAUDE_PROJECT_DIR ?? process.cwd();
const sessionId = typeof event.session_id === "string" ? event.session_id : "nosession";
const NOTIFIED_FLAG = path.join(sessionScratchDir(sessionId), "sql-notified");
```

- [ ] **Step 2: Simplify `markNotified()` — drop the now-redundant session prefix**

Replace:

```js
/**
 * Best-effort: record that `absPath` has already been surfaced to the agent
 * this session, so the Stop-mode sweep never double-blocks on it.
 * @param {string} absPath
 */
function markNotified(absPath) {
  const sessionId = typeof event.session_id === "string" ? event.session_id : "nosession";
  try {
    fs.appendFileSync(NOTIFIED_FLAG, `${sessionId}\t${absPath}\n`);
  } catch {
    // Best-effort; a missed write only means the Stop sweep may re-notify.
  }
}
```

with:

```js
/**
 * Best-effort: record that `absPath` has already been surfaced to the agent
 * this session, so the Stop-mode sweep never double-blocks on it. The flag
 * file is already session-scoped (see session-scratch.mjs), so each row only
 * needs the path — no session prefix required.
 * @param {string} absPath
 */
function markNotified(absPath) {
  try {
    fs.appendFileSync(NOTIFIED_FLAG, `${absPath}\n`);
  } catch {
    // Best-effort; a missed write only means the Stop sweep may re-notify.
  }
}
```

- [ ] **Step 3: Simplify `blockOnStop()`'s dedup filter**

Replace:

```js
  const candidates = status
    .split(/\r?\n/)
    .filter(Boolean)
    .filter((line) => !/[DR]/.test(line.slice(0, 2)))
    .map((line) => path.join(execDir, line.slice(3).trim()))
    .filter((abs) => path.extname(abs).toLowerCase() === ".sql");

  const sessionId = typeof event.session_id === "string" ? event.session_id : "nosession";
  const notified = readNotifiedSet();
  const fresh = [...new Set(candidates)].filter((abs) => !notified.has(`${sessionId}\t${abs}`));
  if (fresh.length === 0) return;
```

with:

```js
  const candidates = status
    .split(/\r?\n/)
    .filter(Boolean)
    .filter((line) => !/[DR]/.test(line.slice(0, 2)))
    .map((line) => path.join(execDir, line.slice(3).trim()))
    .filter((abs) => path.extname(abs).toLowerCase() === ".sql");

  const notified = readNotifiedSet();
  const fresh = [...new Set(candidates)].filter((abs) => !notified.has(abs));
  if (fresh.length === 0) return;
```

(`readNotifiedSet()` itself is unchanged — it still just reads `NOTIFIED_FLAG` and splits into a `Set` of lines; only the *content* of those lines changed from `sessionId\tpath` to bare `path`.)

- [ ] **Step 4: Update the test file's imports and shared helpers**

Replace:

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execSync } from "node:child_process";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { runHook, runHookRaw, mkGitRepo, assertCleanStdoutJson } from "./hook-runner.mjs";
import { validatePostToolUseOutput, validateStopOutput } from "../lib/validate/hook-schema.mjs";
```

with:

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { runHook, runHookRaw, mkGitRepo, assertCleanStdoutJson } from "./hook-runner.mjs";
import { validatePostToolUseOutput, validateStopOutput } from "../lib/validate/hook-schema.mjs";
import { sessionScratchDir } from "../templates/hooks/session-scratch.mjs";
```

Replace:

```js
const flagHash = (/** @type {string} */ d) =>
  createHash("sha1").update(d).digest("hex").slice(0, 12);

/** Path of the shared sql-notified de-dup flag for a project dir. */
const notifiedFlag = (/** @type {string} */ projectDir) =>
  path.join(os.tmpdir(), `aia-harness-sql-notified-${flagHash(projectDir)}`);
```

with:

```js
/** Path of the shared sql-notified de-dup flag for a session id. */
const notifiedFlag = (/** @type {string} */ sessionId) =>
  path.join(sessionScratchDir(sessionId), "sql-notified");
```

- [ ] **Step 5: Update every Stop-mode test that seeds or reads `notifiedFlag`**

**Tests unaffected (no `notifiedFlag`/`session_id` involvement at all — PostToolUse review-path tests always emit fresh `additionalContext`, no dedup state):** every test above the `// Stop mode` section header (`"sql-idempotent: empty stdin → skip..."` through `"sql-idempotent: warns against BEGIN/COMMIT..."`) — leave unchanged.

**`"stop: non-git dir → silent, schema-valid"`, `"stop: empty stdin → silent, schema-valid"`, `"stop: git repo with no changes → silent"`** — no flag file involved, no `session_id` needed for correctness, but for consistency add `session_id: "nosession"` is NOT required (these never touch `notifiedFlag`) — leave unchanged.

**`"stop: untracked .sql file → blocks, mentions the file and idempotency rules"`** (before):
```js
test("stop: untracked .sql file → blocks, mentions the file and idempotency rules", () => {
  const dir = mkGitRepo("main");
  writeSqlFile(dir, "schema.sql", "CREATE TABLE t (id int);\n");
  try {
    const parsed = assertBlockStop(
      runHook(HOOK, { hook_event_name: "Stop" }, { env: { CLAUDE_PROJECT_DIR: dir } }),
    );
    assert.match(parsed.reason, /schema\.sql/);
    assert.match(parsed.reason, /IF NOT EXISTS/);
  } finally {
    fs.rmSync(notifiedFlag(dir), { force: true });
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
```
(after):
```js
test("stop: untracked .sql file → blocks, mentions the file and idempotency rules", () => {
  const dir = mkGitRepo("main");
  const sid = path.basename(dir);
  writeSqlFile(dir, "schema.sql", "CREATE TABLE t (id int);\n");
  try {
    const parsed = assertBlockStop(
      runHook(HOOK, { hook_event_name: "Stop", session_id: sid }, { env: { CLAUDE_PROJECT_DIR: dir } }),
    );
    assert.match(parsed.reason, /schema\.sql/);
    assert.match(parsed.reason, /IF NOT EXISTS/);
  } finally {
    fs.rmSync(notifiedFlag(sid), { force: true });
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
```
Apply the identical `dir` → `sid` pattern (declare `const sid = path.basename(dir);`, add `session_id: sid` to the Stop event, change `notifiedFlag(dir)` → `notifiedFlag(sid)`) to: `"stop: tracked .sql file modified → blocks"`, `"stop: deleted .sql file → silent (excluded)"` (no notifiedFlag cleanup present, but still add `session_id: sid` for realism — optional but do it for consistency), `"stop: file renamed to .sql → silent..."` (same note), `"stop: non-.sql file changed → silent"` (same note), `"stop: stop_hook_active true with pending .sql → silent (anti-loop)"` (same note), `"stop: multiple new .sql files → blocks, reason lists all of them"`.

**`"stop: event.cwd worktree with unreviewed .sql file (CLAUDE_PROJECT_DIR is a different clean dir) → blocks"`** (before):
```js
test("stop: event.cwd worktree with unreviewed .sql file (CLAUDE_PROJECT_DIR is a different clean dir) → blocks", () => {
  const worktree = mkGitRepo("worktree-branch");
  const cleanProjectDir = fs.mkdtempSync(path.join(os.tmpdir(), "aia-sql-clean-"));
  writeSqlFile(worktree, "schema.sql", "CREATE TABLE t (id int);\n");
  try {
    const parsed = assertBlockStop(
      runHook(
        HOOK,
        { hook_event_name: "Stop", cwd: worktree },
        { env: { CLAUDE_PROJECT_DIR: cleanProjectDir } },
      ),
    );
    assert.match(parsed.reason, /schema\.sql/);
    assert.match(parsed.reason, /IF NOT EXISTS/);
  } finally {
    fs.rmSync(notifiedFlag(cleanProjectDir), { force: true });
    fs.rmSync(worktree, { recursive: true, force: true });
    fs.rmSync(cleanProjectDir, { recursive: true, force: true });
  }
});
```
(after — note the session id derives from `cleanProjectDir`, matching what `NOTIFIED_FLAG` inside the hook computes: it's keyed by `sessionId`, resolved once at module load from `event.session_id`, independent of which dir is `CLAUDE_PROJECT_DIR` vs `event.cwd`):
```js
test("stop: event.cwd worktree with unreviewed .sql file (CLAUDE_PROJECT_DIR is a different clean dir) → blocks", () => {
  const worktree = mkGitRepo("worktree-branch");
  const cleanProjectDir = fs.mkdtempSync(path.join(os.tmpdir(), "aia-sql-clean-"));
  const sid = path.basename(cleanProjectDir);
  writeSqlFile(worktree, "schema.sql", "CREATE TABLE t (id int);\n");
  try {
    const parsed = assertBlockStop(
      runHook(
        HOOK,
        { hook_event_name: "Stop", cwd: worktree, session_id: sid },
        { env: { CLAUDE_PROJECT_DIR: cleanProjectDir } },
      ),
    );
    assert.match(parsed.reason, /schema\.sql/);
    assert.match(parsed.reason, /IF NOT EXISTS/);
  } finally {
    fs.rmSync(notifiedFlag(sid), { force: true });
    fs.rmSync(worktree, { recursive: true, force: true });
    fs.rmSync(cleanProjectDir, { recursive: true, force: true });
  }
});
```

**`"stop: file already marked notified (prior postToolUse call) → silent, no double-block"`** (before):
```js
test("stop: file already marked notified (prior postToolUse call) → silent, no double-block", () => {
  const dir = mkGitRepo("main");
  const abs = writeSqlFile(dir, "schema.sql", "CREATE TABLE t (id int);\n");
  fs.writeFileSync(notifiedFlag(dir), `nosession\t${abs}\n`);
  try {
    assertSilentStop(
      runHook(HOOK, { hook_event_name: "Stop" }, { env: { CLAUDE_PROJECT_DIR: dir } }),
    );
  } finally {
    fs.rmSync(notifiedFlag(dir), { force: true });
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
```
(after — pre-seeded row content drops the `sessionId\t` prefix, matching the new `markNotified` format):
```js
test("stop: file already marked notified (prior postToolUse call) → silent, no double-block", () => {
  const dir = mkGitRepo("main");
  const sid = path.basename(dir);
  const abs = writeSqlFile(dir, "schema.sql", "CREATE TABLE t (id int);\n");
  fs.writeFileSync(notifiedFlag(sid), `${abs}\n`);
  try {
    assertSilentStop(
      runHook(HOOK, { hook_event_name: "Stop", session_id: sid }, { env: { CLAUDE_PROJECT_DIR: dir } }),
    );
  } finally {
    fs.rmSync(notifiedFlag(sid), { force: true });
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
```

**`"stop: same file, different session_id → blocks again (flag is per-session)"`** — this test's ORIGINAL intent (a different session_id still blocks) is now achieved via file isolation instead of row-tagging, but the test still validates the right end-to-end behavior. (before):
```js
test("stop: same file, different session_id → blocks again (flag is per-session)", () => {
  const dir = mkGitRepo("main");
  const abs = writeSqlFile(dir, "schema.sql", "CREATE TABLE t (id int);\n");
  fs.writeFileSync(notifiedFlag(dir), `session-A\t${abs}\n`);
  try {
    assertBlockStop(
      runHook(
        HOOK,
        { hook_event_name: "Stop", session_id: "session-B" },
        { env: { CLAUDE_PROJECT_DIR: dir } },
      ),
    );
  } finally {
    fs.rmSync(notifiedFlag(dir), { force: true });
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
```
(after — seed session-A's OWN file, then verify session-B still blocks because it reads its OWN, different file):
```js
test("stop: same file, different session_id → blocks again (flag is per-session)", () => {
  const dir = mkGitRepo("main");
  const abs = writeSqlFile(dir, "schema.sql", "CREATE TABLE t (id int);\n");
  fs.writeFileSync(notifiedFlag("session-A"), `${abs}\n`);
  try {
    assertBlockStop(
      runHook(
        HOOK,
        { hook_event_name: "Stop", session_id: "session-B" },
        { env: { CLAUDE_PROJECT_DIR: dir } },
      ),
    );
  } finally {
    fs.rmSync(notifiedFlag("session-A"), { force: true });
    fs.rmSync(notifiedFlag("session-B"), { force: true });
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
```

**`"stop: second Stop call after first already blocked → silent (flag persists)"`** (before):
```js
test("stop: second Stop call after first already blocked → silent (flag persists)", () => {
  const dir = mkGitRepo("main");
  writeSqlFile(dir, "schema.sql", "CREATE TABLE t (id int);\n");
  try {
    assertBlockStop(
      runHook(
        HOOK,
        { hook_event_name: "Stop", session_id: "s1" },
        { env: { CLAUDE_PROJECT_DIR: dir } },
      ),
    );
    assertSilentStop(
      runHook(
        HOOK,
        { hook_event_name: "Stop", session_id: "s1" },
        { env: { CLAUDE_PROJECT_DIR: dir } },
      ),
    );
  } finally {
    fs.rmSync(notifiedFlag(dir), { force: true });
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
```
(after — only the cleanup line changes, `session_id: "s1"` is already explicit):
```js
test("stop: second Stop call after first already blocked → silent (flag persists)", () => {
  const dir = mkGitRepo("main");
  writeSqlFile(dir, "schema.sql", "CREATE TABLE t (id int);\n");
  try {
    assertBlockStop(
      runHook(
        HOOK,
        { hook_event_name: "Stop", session_id: "s1" },
        { env: { CLAUDE_PROJECT_DIR: dir } },
      ),
    );
    assertSilentStop(
      runHook(
        HOOK,
        { hook_event_name: "Stop", session_id: "s1" },
        { env: { CLAUDE_PROJECT_DIR: dir } },
      ),
    );
  } finally {
    fs.rmSync(notifiedFlag("s1"), { force: true });
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
```

**`"stop: CRLF line endings in notified-flag still dedup correctly"`** (before):
```js
test("stop: CRLF line endings in notified-flag still dedup correctly", () => {
  const dir = mkGitRepo("main");
  const abs = writeSqlFile(dir, "schema.sql", "CREATE TABLE t (id int);\n");
  fs.writeFileSync(notifiedFlag(dir), `nosession\t${abs}\r\n`);
  try {
    assertSilentStop(
      runHook(HOOK, { hook_event_name: "Stop" }, { env: { CLAUDE_PROJECT_DIR: dir } }),
    );
  } finally {
    fs.rmSync(notifiedFlag(dir), { force: true });
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
```
(after):
```js
test("stop: CRLF line endings in notified-flag still dedup correctly", () => {
  const dir = mkGitRepo("main");
  const sid = path.basename(dir);
  const abs = writeSqlFile(dir, "schema.sql", "CREATE TABLE t (id int);\n");
  fs.writeFileSync(notifiedFlag(sid), `${abs}\r\n`);
  try {
    assertSilentStop(
      runHook(HOOK, { hook_event_name: "Stop", session_id: sid }, { env: { CLAUDE_PROJECT_DIR: dir } }),
    );
  } finally {
    fs.rmSync(notifiedFlag(sid), { force: true });
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
```

**`"cross-mode: postToolUse edit of a .sql file suppresses the Stop-mode block for that file"`** (before):
```js
test("cross-mode: postToolUse edit of a .sql file suppresses the Stop-mode block for that file", () => {
  const dir = mkGitRepo("main");
  const abs = writeSqlFile(dir, "schema.sql", "CREATE TABLE t (id int);\n");
  try {
    const ctx = reviewContext(
      runHook(
        HOOK,
        { hook_event_name: "PostToolUse", tool_input: { file_path: abs }, session_id: "s1" },
        { env: { CLAUDE_PROJECT_DIR: dir } },
      ),
    );
    assert.match(ctx, /idempotent/i);
    assertSilentStop(
      runHook(
        HOOK,
        { hook_event_name: "Stop", session_id: "s1" },
        { env: { CLAUDE_PROJECT_DIR: dir } },
      ),
    );
  } finally {
    fs.rmSync(notifiedFlag(dir), { force: true });
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
```
(after — only the cleanup line changes; both calls already share `session_id: "s1"`, which is exactly what makes this cross-mode test meaningful — same session, PostToolUse then Stop, same scratch dir):
```js
test("cross-mode: postToolUse edit of a .sql file suppresses the Stop-mode block for that file", () => {
  const dir = mkGitRepo("main");
  const abs = writeSqlFile(dir, "schema.sql", "CREATE TABLE t (id int);\n");
  try {
    const ctx = reviewContext(
      runHook(
        HOOK,
        { hook_event_name: "PostToolUse", tool_input: { file_path: abs }, session_id: "s1" },
        { env: { CLAUDE_PROJECT_DIR: dir } },
      ),
    );
    assert.match(ctx, /idempotent/i);
    assertSilentStop(
      runHook(
        HOOK,
        { hook_event_name: "Stop", session_id: "s1" },
        { env: { CLAUDE_PROJECT_DIR: dir } },
      ),
    );
  } finally {
    fs.rmSync(notifiedFlag("s1"), { force: true });
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
```

- [ ] **Step 6: Add a parallel-session isolation regression test**

Append at the end of the file:

```js
// ===========================================================================
// Parallel-session isolation (the row-tagging simplification this enables)
// ===========================================================================

test("stop: a different session's notified-flag never leaks into this session's sweep", () => {
  const dir = mkGitRepo("main");
  const abs = writeSqlFile(dir, "schema.sql", "CREATE TABLE t (id int);\n");
  // A parallel session already reviewed and marked THIS SAME repo's schema.sql.
  fs.writeFileSync(notifiedFlag("parallel-session-other"), `${abs}\n`);
  try {
    // This session never marked it notified — must still block.
    const parsed = assertBlockStop(
      runHook(
        HOOK,
        { hook_event_name: "Stop", session_id: "parallel-session-mine" },
        { env: { CLAUDE_PROJECT_DIR: dir } },
      ),
    );
    assert.match(parsed.reason, /schema\.sql/);
  } finally {
    fs.rmSync(notifiedFlag("parallel-session-other"), { force: true });
    fs.rmSync(notifiedFlag("parallel-session-mine"), { force: true });
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
```

- [ ] **Step 7: Run the tests**

Run: `node --test tests/hook-sql-idempotent-review.test.mjs`
Expected: all tests PASS (36 original + 1 new = 37).

- [ ] **Step 8: Commit**

```bash
git add templates/hooks/sql-idempotent-review.mjs tests/hook-sql-idempotent-review.test.mjs
git commit -m "fix(hooks): sql-idempotent-review.mjs uses session scratch dir, drops redundant row tagging"
```

---

### Task 6: Migrate `worktree-prompt-ctx.mjs`

**Files:**
- Modify: `templates/hooks/worktree-prompt-ctx.mjs`
- Modify: `tests/hook-worktree-prompt-ctx.test.mjs`

**Interfaces:**
- Consumes: `sessionScratchDir(sessionId)` (Task 1).
- Produces: `<sessionScratchDir>/worktree-renamed`.

**Context:** Same row-tagging simplification as Task 5: the file currently tags each row `${sessionId}\t${wtName}` inside a project-hash-keyed shared file (because ONE session can visit MULTIPLE worktrees and must remember which it already renamed for). Once the file is session-scoped, only `wtName` is needed per row — the file itself already IS the session boundary.

- [ ] **Step 1: Replace the import block**

Replace:

```js
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
```

with:

```js
import fs from "node:fs";
import path from "node:path";
import { sessionScratchDir } from "./session-scratch.mjs";
```

- [ ] **Step 2: Replace the flag construction and rename logic**

Replace:

```js
// Rename once per (session, worktree) — deduped via a per-project flag file so
// it never re-fires on later prompts in the same worktree (and never clobbers
// a manual /rename after the first auto-rename).
const projectDir = process.env.CLAUDE_PROJECT_DIR ?? process.cwd();
const projHash = createHash("sha1").update(projectDir).digest("hex").slice(0, 12);
const RENAMED_FLAG = path.join(os.tmpdir(), `aia-harness-worktree-renamed-${projHash}`);
const sessionId = typeof event.session_id === "string" ? event.session_id : "nosession";
const renameKey = `${sessionId}\t${wtName}`;

let alreadyRenamed = false;
try {
  alreadyRenamed = fs.readFileSync(RENAMED_FLAG, "utf8").split(/\r?\n/).includes(renameKey);
} catch {
  // No flag yet — first prompt in this worktree for this session.
}

if (!alreadyRenamed) {
  hookSpecificOutput.sessionTitle = wtName;
  try {
    fs.appendFileSync(RENAMED_FLAG, renameKey + "\n");
  } catch {
    // Best-effort; a missed write only means the rename may fire once more.
  }
}
```

with:

```js
// Rename once per (session, worktree) — deduped via a per-session flag file
// (this session may visit multiple worktrees, so the row still needs the
// worktree name — but no longer a session prefix, since the file itself is
// already session-scoped) so it never re-fires on later prompts in the same
// worktree (and never clobbers a manual /rename after the first auto-rename).
const sessionId = typeof event.session_id === "string" ? event.session_id : "nosession";
const RENAMED_FLAG = path.join(sessionScratchDir(sessionId), "worktree-renamed");

let alreadyRenamed = false;
try {
  alreadyRenamed = fs.readFileSync(RENAMED_FLAG, "utf8").split(/\r?\n/).includes(wtName);
} catch {
  // No flag yet — first prompt in this worktree for this session.
}

if (!alreadyRenamed) {
  hookSpecificOutput.sessionTitle = wtName;
  try {
    fs.appendFileSync(RENAMED_FLAG, wtName + "\n");
  } catch {
    // Best-effort; a missed write only means the rename may fire once more.
  }
}
```

(`projectDir` is fully removed — verified it was used only to feed `projHash`, nowhere else in this file.)

- [ ] **Step 3: Update the test file's imports and shared helper**

Replace:

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { runHook, runHookRaw, assertCleanStdoutJson } from "./hook-runner.mjs";
import { validateUserPromptSubmitOutput } from "../lib/validate/hook-schema.mjs";
```

with:

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { runHook, runHookRaw, assertCleanStdoutJson } from "./hook-runner.mjs";
import { validateUserPromptSubmitOutput } from "../lib/validate/hook-schema.mjs";
import { sessionScratchDir } from "../templates/hooks/session-scratch.mjs";
```

Replace:

```js
const flagHash = (/** @type {string} */ d) =>
  createHash("sha1").update(d).digest("hex").slice(0, 12);

/** Path of the shared worktree-rename de-dup flag for a project dir. */
const renamedFlag = (/** @type {string} */ projectDir) =>
  path.join(os.tmpdir(), `aia-harness-worktree-renamed-${flagHash(projectDir)}`);
```

with:

```js
/** Path of the worktree-rename de-dup flag for a session id. */
const renamedFlag = (/** @type {string} */ sessionId) =>
  path.join(sessionScratchDir(sessionId), "worktree-renamed");
```

Note: the file's early tests (before the "Session auto-rename" section) never call `renamedFlag` or seed rename state — they test the plain `additionalContext` injection (`cwd` detection), which is unaffected by this migration. Leave `run()`, `assertSilent()`, and every test above the `flagHash`/`renamedFlag` declarations completely unchanged.

- [ ] **Step 4: Replace every test in the "Session auto-rename" section**

Every test in this section currently uses `session_id: "sA"`/`"sB"`/etc. (already explicit) and `CLAUDE_PROJECT_DIR: dir`, and cleans up via `renamedFlag(dir)`. **The fix is mechanical: change every `renamedFlag(dir)` cleanup call to `renamedFlag(<the session_id actually used in that test>)`.** Apply this substitution to all 7 tests in the section (`"first prompt in a worktree sets sessionTitle..."` uses `"sA"`, `"second prompt in the SAME session+worktree..."` uses `"sB"`, `"a different session_id in the same worktree..."` uses BOTH `"sC1"` and `"sC2"` so needs both cleaned up, `"the same session entering a different worktree..."` uses `"sD"`, `"missing session_id falls back to a shared key..."` uses no explicit session_id so falls back to `"nosession"` — clean up `renamedFlag("nosession")`, `"at the project root (no worktree) sessionTitle never fires"` uses `"sE"`, `"Windows-style cwd → sessionTitle is just the worktree name..."` uses `"sWin"`).

Worked example for `"first prompt in a worktree sets sessionTitle to the worktree name"` (before):
```js
test("worktree-prompt-ctx: first prompt in a worktree sets sessionTitle to the worktree name", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "aia-wpc-"));
  const wt = path.join(dir, ".claude", "worktrees", "feature-x");
  try {
    const r = runHook(HOOK, { session_id: "sA", cwd: wt }, { env: { CLAUDE_PROJECT_DIR: dir } });
    const v = validateUserPromptSubmitOutput(r.stdout, r.exitCode);
    assert.equal(v.valid, true, `Schema invalid: ${v.errors.join("; ")}`);
    assertCleanStdoutJson(r.stdout);
    const parsed = JSON.parse(r.stdout);
    assert.equal(parsed.hookSpecificOutput.sessionTitle, "feature-x");
    assert.ok(parsed.hookSpecificOutput.additionalContext.includes(wt));
  } finally {
    fs.rmSync(renamedFlag(dir), { force: true });
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
```
(after — ONLY the cleanup line's argument changes, from `dir` to the literal session id already used above it, `"sA"`):
```js
test("worktree-prompt-ctx: first prompt in a worktree sets sessionTitle to the worktree name", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "aia-wpc-"));
  const wt = path.join(dir, ".claude", "worktrees", "feature-x");
  try {
    const r = runHook(HOOK, { session_id: "sA", cwd: wt }, { env: { CLAUDE_PROJECT_DIR: dir } });
    const v = validateUserPromptSubmitOutput(r.stdout, r.exitCode);
    assert.equal(v.valid, true, `Schema invalid: ${v.errors.join("; ")}`);
    assertCleanStdoutJson(r.stdout);
    const parsed = JSON.parse(r.stdout);
    assert.equal(parsed.hookSpecificOutput.sessionTitle, "feature-x");
    assert.ok(parsed.hookSpecificOutput.additionalContext.includes(wt));
  } finally {
    fs.rmSync(renamedFlag("sA"), { force: true });
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
```

And for the two-session-id test `"a different session_id in the same worktree gets its own sessionTitle"` (before):
```js
test("worktree-prompt-ctx: a different session_id in the same worktree gets its own sessionTitle", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "aia-wpc-"));
  const wt = path.join(dir, ".claude", "worktrees", "feature-x");
  const opts = { env: { CLAUDE_PROJECT_DIR: dir } };
  try {
    runHook(HOOK, { session_id: "sC1", cwd: wt }, opts);
    const r = runHook(HOOK, { session_id: "sC2", cwd: wt }, opts);
    assert.equal(JSON.parse(r.stdout).hookSpecificOutput.sessionTitle, "feature-x");
  } finally {
    fs.rmSync(renamedFlag(dir), { force: true });
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
```
(after):
```js
test("worktree-prompt-ctx: a different session_id in the same worktree gets its own sessionTitle", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "aia-wpc-"));
  const wt = path.join(dir, ".claude", "worktrees", "feature-x");
  const opts = { env: { CLAUDE_PROJECT_DIR: dir } };
  try {
    runHook(HOOK, { session_id: "sC1", cwd: wt }, opts);
    const r = runHook(HOOK, { session_id: "sC2", cwd: wt }, opts);
    assert.equal(JSON.parse(r.stdout).hookSpecificOutput.sessionTitle, "feature-x");
  } finally {
    fs.rmSync(renamedFlag("sC1"), { force: true });
    fs.rmSync(renamedFlag("sC2"), { force: true });
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
```

For `"missing session_id falls back to a shared key but still dedupes"` (before):
```js
test("worktree-prompt-ctx: missing session_id falls back to a shared key but still dedupes", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "aia-wpc-"));
  const wt = path.join(dir, ".claude", "worktrees", "feature-x");
  const opts = { env: { CLAUDE_PROJECT_DIR: dir } };
  try {
    const first = runHook(HOOK, { cwd: wt }, opts);
    assert.equal(JSON.parse(first.stdout).hookSpecificOutput.sessionTitle, "feature-x");
    const second = runHook(HOOK, { cwd: wt }, opts);
    assert.equal(JSON.parse(second.stdout).hookSpecificOutput.sessionTitle, undefined);
  } finally {
    fs.rmSync(renamedFlag(dir), { force: true });
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
```
(after — rename the test title slightly since "shared key" now means the fixed `"nosession"` fallback key, not a project-hash key, but the behavior it verifies — dedup still works without session_id — is identical):
```js
test("worktree-prompt-ctx: missing session_id falls back to the 'nosession' key but still dedupes", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "aia-wpc-"));
  const wt = path.join(dir, ".claude", "worktrees", "feature-x");
  const opts = { env: { CLAUDE_PROJECT_DIR: dir } };
  try {
    const first = runHook(HOOK, { cwd: wt }, opts);
    assert.equal(JSON.parse(first.stdout).hookSpecificOutput.sessionTitle, "feature-x");
    const second = runHook(HOOK, { cwd: wt }, opts);
    assert.equal(JSON.parse(second.stdout).hookSpecificOutput.sessionTitle, undefined);
  } finally {
    fs.rmSync(renamedFlag("nosession"), { force: true });
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
```

Apply the same single-line `renamedFlag(dir)` → `renamedFlag("<that test's session id>")` substitution to the remaining tests: `"second prompt in the SAME session+worktree does not repeat sessionTitle"` → `renamedFlag("sB")`; `"the same session entering a different worktree gets a fresh sessionTitle"` → `renamedFlag("sD")`; `"at the project root (no worktree) sessionTitle never fires"` → `renamedFlag("sE")`; `"Windows-style cwd → sessionTitle is just the worktree name, not the full path"` → `renamedFlag("sWin")`.

- [ ] **Step 5: Add a parallel-session isolation regression test**

Append at the end of the file:

```js
test("worktree-prompt-ctx: a parallel session's rename record never suppresses this session's first rename", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "aia-wpc-parallel-"));
  const wt = path.join(dir, ".claude", "worktrees", "feature-x");
  try {
    // A parallel session already renamed for this exact worktree.
    const other = runHook(HOOK, { session_id: "parallel-other", cwd: wt }, { env: { CLAUDE_PROJECT_DIR: dir } });
    assert.equal(JSON.parse(other.stdout).hookSpecificOutput.sessionTitle, "feature-x");

    // This session has never renamed for this worktree — must still fire.
    const mine = runHook(HOOK, { session_id: "parallel-mine", cwd: wt }, { env: { CLAUDE_PROJECT_DIR: dir } });
    assert.equal(JSON.parse(mine.stdout).hookSpecificOutput.sessionTitle, "feature-x");
  } finally {
    fs.rmSync(renamedFlag("parallel-other"), { force: true });
    fs.rmSync(renamedFlag("parallel-mine"), { force: true });
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
```

- [ ] **Step 6: Run the tests**

Run: `node --test tests/hook-worktree-prompt-ctx.test.mjs`
Expected: all tests PASS (16 original + 1 new = 17).

- [ ] **Step 7: Commit**

```bash
git add templates/hooks/worktree-prompt-ctx.mjs tests/hook-worktree-prompt-ctx.test.mjs
git commit -m "fix(hooks): worktree-prompt-ctx.mjs uses session scratch dir, drops redundant row tagging"
```

---

### Task 7: Migrate `validate-settings-schema.mjs`

**Files:**
- Modify: `templates/hooks/validate-settings-schema.mjs`
- Modify: `tests/hook-validate-settings-schema.test.mjs`

**Interfaces:**
- Consumes: `sessionScratchDir(sessionId)` (Task 1).
- Produces: `<sessionScratchDir>/settings-schema-cache.json` (only when `SETTINGS_SCHEMA_CACHE` env var is unset).

**Context:** Per the project decision, this cache also migrates to the scratch dir for consistency (trading cross-session cache reuse for zero raw-`os.tmpdir()` usage). Every existing test that reaches the cache-using code path already sets `SETTINGS_SCHEMA_CACHE` explicitly (verified by reading the file) — because `??` short-circuits, `sessionScratchDir()` is never invoked when that env var is set, so **no existing test needs to change**. The `CACHE_FILE` computation also moves to right before its first use (after all early-exit filters), so the (relatively expensive) scratch-dir directory scan only runs on the rare PostToolUse call that's actually a settings.json/settings.local.json write — not on every single edit in the project.

- [ ] **Step 1: Replace the import block and the docstring's cache-path line**

Replace:

```js
/**
 * PostToolUse hook: validate .claude/settings.json and .claude/settings.local.json
 * against the Claude Code JSON Schema from SchemaStore whenever those files are
 * written or edited. Exits 2 with a structured stderr message that instructs
 * Claude to present errors to the user and ask for confirmation before fixing.
 *
 * Fail-open on all infrastructure (network, cache, parse). Only exits 2 for
 * actual JSON syntax errors or schema validation failures.
 *
 * Schema URL and cache path are env-overridable (used in tests):
 *   SETTINGS_SCHEMA_URL   — default: https://www.schemastore.org/claude-code-settings.json
 *                           If not starting with "http", treated as a local file path.
 *   SETTINGS_SCHEMA_CACHE — default: os.tmpdir()/aia-validate-settings-schema.json
 *
 * @hook PostToolUse
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// ── Configuration (env-overridable for testing) ───────────────────────────────
const SCHEMA_URL =
  process.env.SETTINGS_SCHEMA_URL ?? "https://www.schemastore.org/claude-code-settings.json";
const CACHE_FILE =
  process.env.SETTINGS_SCHEMA_CACHE ?? path.join(os.tmpdir(), "aia-validate-settings-schema.json");
const TTL_MS = 24 * 60 * 60 * 1000;
```

with:

```js
/**
 * PostToolUse hook: validate .claude/settings.json and .claude/settings.local.json
 * against the Claude Code JSON Schema from SchemaStore whenever those files are
 * written or edited. Exits 2 with a structured stderr message that instructs
 * Claude to present errors to the user and ask for confirmation before fixing.
 *
 * Fail-open on all infrastructure (network, cache, parse). Only exits 2 for
 * actual JSON syntax errors or schema validation failures.
 *
 * Schema URL and cache path are env-overridable (used in tests):
 *   SETTINGS_SCHEMA_URL   — default: https://www.schemastore.org/claude-code-settings.json
 *                           If not starting with "http", treated as a local file path.
 *   SETTINGS_SCHEMA_CACHE — default: <this session's scratch dir>/settings-schema-cache.json
 *                           (see session-scratch.mjs). The cache no longer survives
 *                           across sessions — a deliberate trade for never touching
 *                           raw os.tmpdir(); see .claude/rules/hooks-cross-platform.md.
 *
 * @hook PostToolUse
 */
import fs from "node:fs";
import path from "node:path";
import { sessionScratchDir } from "./session-scratch.mjs";

// ── Configuration (env-overridable for testing) ───────────────────────────────
const SCHEMA_URL =
  process.env.SETTINGS_SCHEMA_URL ?? "https://www.schemastore.org/claude-code-settings.json";
const TTL_MS = 24 * 60 * 60 * 1000;
```

(`CACHE_FILE` is no longer defined here — moved to Step 2, after the early-exit filters.)

- [ ] **Step 2: Move the `CACHE_FILE` computation to right before `loadSchema()` is called**

Replace:

```js
// ── Load schema ───────────────────────────────────────────────────────────────
const schema = await loadSchema();
if (!schema) process.exit(0);
```

with:

```js
// ── Load schema ───────────────────────────────────────────────────────────────
const sessionId = typeof event?.session_id === "string" ? event.session_id : "nosession";
const CACHE_FILE =
  process.env.SETTINGS_SCHEMA_CACHE ??
  path.join(sessionScratchDir(sessionId), "settings-schema-cache.json");
const schema = await loadSchema();
if (!schema) process.exit(0);
```

(`loadSchema()` is a hoisted function declaration further down the file that already closes over `CACHE_FILE` and `SCHEMA_URL` — no change needed inside its body; it now reads the `CACHE_FILE` `const` defined immediately above this call, which JS resolves correctly regardless of the function's own textual position in the file, since the `const` is evaluated before the function actually runs.)

- [ ] **Step 3: Confirm no existing test needs a change**

Run: `node --test tests/hook-validate-settings-schema.test.mjs`
Expected: all 13 existing tests PASS unmodified (every test reaching `loadSchema()` already sets `SETTINGS_SCHEMA_CACHE` in its `env`, so `sessionScratchDir()` is never invoked in the existing suite).

- [ ] **Step 4: Add one new test exercising the real default (no env override)**

Append to `tests/hook-validate-settings-schema.test.mjs`:

```js
// ── 12: No SETTINGS_SCHEMA_CACHE override → uses the session scratch dir ────
test("settings-schema: no cache override → writes cache under the session scratch dir", () => {
  const schemaPath = writeSchema(MINIMAL_SCHEMA);
  const { dir, file } = mkSettingsDir({ content: '{"model":"sonnet"}' });
  const sessionId = "settings-schema-default-cache-test";
  const expectedCachePath = path.join(
    sessionScratchDir(sessionId),
    "settings-schema-cache.json",
  );
  try {
    fs.rmSync(expectedCachePath, { force: true });
    assertSkip(
      runHook(
        HOOK,
        { tool_name: "Write", tool_input: { file_path: file }, session_id: sessionId },
        { env: { [SCHEMA_URL_ENV]: schemaPath } }, // CACHE_ENV intentionally NOT set
      ),
    );
    assert.equal(fs.existsSync(expectedCachePath), true, "expected cache file under the session scratch dir");
    const cached = JSON.parse(fs.readFileSync(expectedCachePath, "utf8"));
    assert.deepEqual(cached.schema, MINIMAL_SCHEMA);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
    fs.unlinkSync(schemaPath);
    fs.rmSync(expectedCachePath, { force: true });
  }
});
```

Add the import at the top of the file (alongside the existing ones):

```js
import { sessionScratchDir } from "../templates/hooks/session-scratch.mjs";
```

- [ ] **Step 5: Run the full test file**

Run: `node --test tests/hook-validate-settings-schema.test.mjs`
Expected: all 14 tests PASS.

- [ ] **Step 6: Commit**

```bash
git add templates/hooks/validate-settings-schema.mjs tests/hook-validate-settings-schema.test.mjs
git commit -m "fix(hooks): validate-settings-schema.mjs caches under the session scratch dir"
```

---

### Task 8: Migrate `lib/generate/verify.mjs` (the generated strict `verify-on-stop.mjs`)

**Files:**
- Modify: `lib/generate/verify.mjs`
- Modify: `tests/verify.test.mjs`
- Modify: `tests/verify-hook.test.mjs`
- **No changes:** `tests/hook-verify-on-stop.test.mjs` — confirmed below to test the static, non-strict, non-tmp-using passive variant only.

**Interfaces:**
- Consumes: `sessionScratchDir(sessionId)` (Task 1) — the generated hook imports it via `./session-scratch.mjs` (correct: both land in `.claude/hooks/` together).
- Reads: the SAME `"files-changed"` file Task 2 writes and Tasks 3-4 also read. Must use the identical filename string `"files-changed"`.

**Context — why `hook-verify-on-stop.test.mjs` is untouched:** `templates/hooks/verify-on-stop.mjs` (the file that test targets) is the **passive fallback** hook — used only when the project has neither lint nor typecheck configured. It runs `git status --porcelain` directly every time and never reads/writes any flag file at all (confirmed by reading its full 50-line source — no `os`, no `path.join(os.tmpdir()...)` anywhere). This task only touches the **strict** variant, generated dynamically by `renderVerifyOnStop()` in `lib/generate/verify.mjs` and tested by `verify.test.mjs` (pure string-output assertions) and `verify-hook.test.mjs` (executes the generated hook as a real subprocess).

- [ ] **Step 1: Replace `lib/generate/verify.mjs`'s full content**

```js
/**
 * Generate the strict Stop hook: runs the project's detected lint + typecheck
 * commands on stop and blocks (with the error fed back) on a real failure, so
 * Claude self-corrects before finishing. Pure: returns the hook source string,
 * or null when neither lint nor typecheck is detected (caller falls back to the
 * passive reminder hook).
 *
 * The generated code intentionally avoids template literals/backticks and uses
 * string concatenation, so embedding it in this module's template literal needs
 * no backtick escaping. Newlines and the regex dot are double-escaped (\\n, \\.)
 * to survive into the generated file. An execution test runs the generated hook
 * to guard against escaping mistakes.
 *
 * @module generate/verify
 */

/** @typedef {import('../profile.mjs').ProjectProfile} ProjectProfile */

/**
 * @param {ProjectProfile} profile
 * @returns {string|null}
 */
export function renderVerifyOnStop(profile) {
  const c = (profile && profile.commands) || {};
  /** @type {{label:string,cmd:string}[]} */
  const cmds = [];
  if (c.lint) cmds.push({ label: "lint", cmd: c.lint });
  if (c.typecheck) cmds.push({ label: "typecheck", cmd: c.typecheck });
  if (cmds.length === 0) return null;

  return `#!/usr/bin/env node
/**
 * Stop hook (strict): runs the project's configured verification commands on
 * stop (lint, types). On a real failure it blocks so Claude fixes it before
 * finishing. Generated by aia-harness — fail-open on infra: a missing runtime
 * or command never blocks. Re-run /aia-harness:doctor to audit.
 */
import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";
import { sessionScratchDir } from "./session-scratch.mjs";

const COMMANDS = ${JSON.stringify(cmds)};
const projectDir = process.env.CLAUDE_PROJECT_DIR || process.cwd();
const LINTABLE = /\\.(js|jsx|ts|tsx|mjs|cjs|vue|svelte|php)$/;

let event = {};
try { event = JSON.parse(fs.readFileSync(0, "utf8") || "{}"); } catch (e) { process.exit(0); }
const sessionId = typeof event.session_id === "string" ? event.session_id : "nosession";

function flagFile() {
  return path.join(sessionScratchDir(sessionId), "files-changed");
}
function clearFlag() {
  try { fs.rmSync(flagFile(), { force: true }); } catch (e) { /* ignore */ }
}
function approve() {
  process.stdout.write(JSON.stringify({ decision: "approve" }));
  process.exit(0);
}

// Anti-loop: a stop already triggered by a previous block must be allowed.
if (event && event.stop_hook_active) { clearFlag(); approve(); }

const flag = flagFile();
if (!fs.existsSync(flag)) approve(); // session changed nothing

let changed = "";
try { changed = fs.readFileSync(flag, "utf8"); } catch (e) { approve(); }
const hasLintable = changed.split("\\n").some(function (p) { return LINTABLE.test(p.trim()); });
if (!hasLintable) { clearFlag(); approve(); }

// Ensure the active node's dir (nvm/fnm/system node) is on PATH for the run.
// process.execPath is always the actual running binary — works with any node manager.
const binDir = path.dirname(process.execPath);
const env = Object.assign({}, process.env, { PATH: binDir + path.delimiter + (process.env.PATH || "") });

const execDir = (event && typeof event.cwd === "string" && event.cwd) || projectDir;
const failures = [];
for (const entry of COMMANDS) {
  try {
    execSync(entry.cmd, { cwd: execDir, env: env, timeout: 120000, stdio: ["ignore", "pipe", "pipe"] });
  } catch (err) {
    // ENOENT / exit 127 = command or runtime missing -> infra, fail open.
    if (err.code === "ENOENT" || err.status === 127) continue;
    const out = ((err.stdout ? err.stdout.toString() : "") + (err.stderr ? err.stderr.toString() : "")).trim();
    failures.push({ label: entry.label, cmd: entry.cmd, out: out || err.message || (entry.label + " failed") });
  }
}

if (failures.length === 0) { clearFlag(); approve(); }

let lines = [];
for (const f of failures) {
  lines.push("=== " + f.label + " (" + f.cmd + ") failed ===");
  lines = lines.concat(f.out.split("\\n"));
  lines.push("");
}
const excerpt = lines.slice(0, 80).join("\\n");
const truncated = lines.length > 80 ? "\\n...(" + (lines.length - 80) + " more lines)" : "";

// Stop schema: top-level decision + reason only (no hookSpecificOutput channel).
process.stdout.write(JSON.stringify({
  decision: "block",
  reason: "Fix all lint/type errors below before finishing.\\n\\n" + excerpt + truncated
}));
process.exit(0);
`;
}
```

(Everything below `flagFile()`/`clearFlag()`/`approve()` — the anti-loop check, the `COMMANDS` loop, the PATH-binDir logic, the block/approve output — is byte-identical to the original; only the imports, the `flagFile()` body, and the reordering of `event`-parsing above the function declarations changed. `projectDir` is still defined and still used for the `execDir` fallback — untouched.)

- [ ] **Step 2: Add regression assertions to `tests/verify.test.mjs`**

Append to `tests/verify.test.mjs`:

```js
test("renderVerifyOnStop uses the session scratch helper, not raw os.tmpdir()", () => {
  const src = renderVerifyOnStop(profile({ lint: "eslint ." })) ?? "";
  assert.match(src, /sessionScratchDir/);
  assert.match(src, /session-scratch\.mjs/);
  assert.doesNotMatch(src, /os\.tmpdir/);
  assert.doesNotMatch(src, /createHash/);
});
```

- [ ] **Step 3: Run `verify.test.mjs`**

Run: `node --test tests/verify.test.mjs`
Expected: all 6 tests PASS.

- [ ] **Step 4: Replace `tests/verify-hook.test.mjs`'s full content**

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { renderVerifyOnStop } from "../lib/generate/verify.mjs";
import { assertCleanStdoutJson } from "./hook-runner.mjs";
import { validateStopOutput } from "../lib/validate/hook-schema.mjs";
import { sessionScratchDir } from "../templates/hooks/session-scratch.mjs";

/**
 * Write the generated strict hook AND a copy of session-scratch.mjs (its
 * relative import) to the same temp dir, matching how they're actually
 * shipped together in .claude/hooks/.
 */
function genHook(/** @type {Record<string,string>} */ commands) {
  const src = renderVerifyOnStop(/** @type {any} */ ({ commands }));
  if (!src) throw new Error("expected hook source");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "aia-hook-"));
  const file = path.join(dir, "verify-on-stop.mjs");
  fs.writeFileSync(file, src);
  const sessionScratchSrc = fs.readFileSync(
    path.resolve(path.dirname(new URL(import.meta.url).pathname), "..", "templates", "hooks", "session-scratch.mjs"),
    "utf8",
  );
  fs.writeFileSync(path.join(dir, "session-scratch.mjs"), sessionScratchSrc);
  return file;
}

/** Derive the session flag-file path the hook uses for a given session id. */
function flagPath(/** @type {string} */ sessionId) {
  return path.join(sessionScratchDir(sessionId), "files-changed");
}

/** Run the hook with a stdin event under a project dir; parse its JSON stdout. */
function run(
  /** @type {string} */ file,
  /** @type {string} */ projectDir,
  /** @type {any} */ event,
) {
  const out = execFileSync(process.execPath, [file], {
    input: JSON.stringify(event),
    env: { ...process.env, CLAUDE_PROJECT_DIR: projectDir },
    encoding: "utf8",
  });
  return out.trim() ? JSON.parse(out) : null;
}

function freshProject() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "aia-proj-"));
}

test("blocks with the error when a verification command fails on session-edited code", () => {
  const file = genHook({ lint: "false" });
  const proj = freshProject();
  const sid = path.basename(proj);
  fs.writeFileSync(flagPath(sid), "src/app.ts\n");
  const r = run(file, proj, { stop_hook_active: false, session_id: sid });
  assert.equal(r.decision, "block");
  assert.match(r.reason, /lint \(false\) failed/);
  fs.rmSync(flagPath(sid), { force: true });
});

test("block output obeys the Stop schema: decision + reason only, no hookSpecificOutput", () => {
  const file = genHook({ lint: "false" });
  const proj = freshProject();
  const sid = path.basename(proj);
  fs.writeFileSync(flagPath(sid), "src/app.ts\n");
  let raw = "";
  try {
    // Block path exits 0 (signals via decision), so execFileSync does not throw.
    raw = execFileSync(process.execPath, [file], {
      input: JSON.stringify({ stop_hook_active: false, session_id: sid }),
      env: { ...process.env, CLAUDE_PROJECT_DIR: proj },
      encoding: "utf8",
    });
  } finally {
    fs.rmSync(flagPath(sid), { force: true });
  }
  const v = validateStopOutput(raw, 0);
  assert.equal(v.valid, true, `Schema invalid: ${v.errors.join("; ")}`);
  assertCleanStdoutJson(raw);
  const obj = JSON.parse(raw);
  assert.equal(obj.decision, "block");
  assert.equal("hookSpecificOutput" in obj, false, "Stop output must not carry hookSpecificOutput");
});

test("approves and clears the flag when commands pass", () => {
  const file = genHook({ lint: "true" });
  const proj = freshProject();
  const sid = path.basename(proj);
  const fp = flagPath(sid);
  fs.writeFileSync(fp, "src/app.ts\n");
  const r = run(file, proj, { session_id: sid });
  assert.equal(r.decision, "approve");
  assert.equal(fs.existsSync(fp), false);
});

test("anti-loop: approves on stop_hook_active even if a command would fail", () => {
  const file = genHook({ lint: "false" });
  const proj = freshProject();
  const sid = path.basename(proj);
  fs.writeFileSync(flagPath(sid), "src/app.ts\n");
  const r = run(file, proj, { stop_hook_active: true, session_id: sid });
  assert.equal(r.decision, "approve");
  fs.rmSync(flagPath(sid), { force: true });
});

test("approves when the session changed nothing (no flag file)", () => {
  const file = genHook({ lint: "false" });
  const proj = freshProject();
  const sid = path.basename(proj);
  const r = run(file, proj, { session_id: sid });
  assert.equal(r.decision, "approve");
});

test("approves when only non-lintable files changed", () => {
  const file = genHook({ lint: "false" });
  const proj = freshProject();
  const sid = path.basename(proj);
  fs.writeFileSync(flagPath(sid), "README.md\ndocs/notes.md\n");
  const r = run(file, proj, { session_id: sid });
  assert.equal(r.decision, "approve");
  fs.rmSync(flagPath(sid), { force: true });
});

test("fail-open: a missing command (infra) does not block", () => {
  const file = genHook({ lint: "aia-nonexistent-cmd-xyz" });
  const proj = freshProject();
  const sid = path.basename(proj);
  fs.writeFileSync(flagPath(sid), "src/app.ts\n");
  const r = run(file, proj, { session_id: sid });
  assert.equal(r.decision, "approve");
  fs.rmSync(flagPath(sid), { force: true });
});

test("runs the verification command in event.cwd, not CLAUDE_PROJECT_DIR, while still finding the flag file via the session scratch dir", () => {
  const markerCmd = `${JSON.stringify(process.execPath)} -e "require('fs').writeFileSync('cwd-marker.txt', process.cwd())"`;
  const file = genHook({ lint: markerCmd });
  const proj = freshProject(); // Purpose B: session id derives from here
  const execDir = freshProject(); // Purpose A: command must actually run here
  const sid = path.basename(proj);
  fs.writeFileSync(flagPath(sid), "src/app.ts\n");
  const r = run(file, proj, { cwd: execDir, session_id: sid });
  assert.equal(r.decision, "approve");
  const markerPath = path.join(execDir, "cwd-marker.txt");
  assert.equal(fs.existsSync(markerPath), true, "command should have run inside event.cwd");
  // Resolve both sides through realpath: on macOS os.tmpdir() returns the
  // /var/... symlink while a spawned child's process.cwd() reports the
  // resolved /private/var/... target — same directory, different string.
  assert.equal(
    fs.realpathSync(fs.readFileSync(markerPath, "utf8").trim()),
    fs.realpathSync(execDir),
  );
  fs.rmSync(flagPath(sid), { recursive: true, force: true });
  fs.rmSync(proj, { recursive: true, force: true });
  fs.rmSync(execDir, { recursive: true, force: true });
});

test("parallel-session isolation: a different session's edited-files flag never leaks in", () => {
  const file = genHook({ lint: "false" });
  const proj = freshProject();
  const sid = path.basename(proj);
  const otherSid = `${sid}-other`;
  // A "parallel session" on the SAME project dir flagged its own file.
  fs.writeFileSync(flagPath(otherSid), "src/other-session.ts\n");
  try {
    // This session's own flag was never written — must approve (nothing to check).
    const r = run(file, proj, { session_id: sid });
    assert.equal(r.decision, "approve");
  } finally {
    fs.rmSync(flagPath(otherSid), { force: true });
  }
});
```

- [ ] **Step 5: Run the tests**

Run: `node --test tests/verify-hook.test.mjs`
Expected: all 9 tests PASS.

- [ ] **Step 6: Confirm `hook-verify-on-stop.test.mjs` needs no changes**

Run: `node --test tests/hook-verify-on-stop.test.mjs`
Expected: all 9 tests PASS unmodified (this file targets the passive variant, confirmed untouched by this migration).

- [ ] **Step 7: Commit**

```bash
git add lib/generate/verify.mjs tests/verify.test.mjs tests/verify-hook.test.mjs
git commit -m "fix(hooks): generated strict verify-on-stop.mjs uses session scratch dir"
```

---

### Task 9: Settings.json safety net for the fallback path

**Files:**
- Modify: `lib/generate/settings.mjs`

**Interfaces:**
- No new exports — extends `renderSettings()`'s existing `allow` `Set` and the `permissions` object it returns.

**Context:** Task 1's `sessionScratchDir()` has a fallback (`os.tmpdir()/aia-harness-session/<sid>`) for when the real Claude Code scratchpad can't be located (unrecognized platform/version). That fallback path is *not* guaranteed pre-authorized. Matching how this exact problem was solved for real in production (a sibling project's hardened config, PR-reviewed and regression-tested), this task adds a second, independent layer: explicit `permissions.allow` entries for `/tmp/**` and `/private/tmp/**`, plus `/tmp` and `/private/tmp` in `permissions.additionalDirectories` — so that even if a hook (or anything else) ever needs to touch a raw tmp path outside the resolved scratchpad, the session doesn't get interrupted by a permission prompt for it. This is defense-in-depth, not a replacement for Task 1 — the resolver stays the primary fix; this task covers what happens when the resolver's fallback branch is the one in play. Confirmed via `grep` that no existing test in this repo asserts an exact/closed `allow` list or `additionalDirectories` shape, so this addition carries low regression risk.

- [ ] **Step 1: Add the tmp allow patterns**

In `lib/generate/settings.mjs`, find:

```js
  for (const g of [
    "git status",
    "git diff",
    "git add",
    "git commit",
    "git push",
    "git pull",
    "git fetch",
    "git checkout",
    "git switch",
    "git branch",
    "git log",
    "git stash",
    "git reset",
    "git merge",
    "git rebase",
    "git tag",
  ])
    allow.add(`Bash(${g}:*)`);
```

Add immediately after it:

```js

  // Defense-in-depth for sessionScratchDir()'s fallback path (used when the
  // real Claude Code scratchpad can't be located — see
  // templates/hooks/session-scratch.mjs and .claude/rules/hooks-cross-platform.md).
  // The primary fix is resolving the pre-authorized scratchpad itself; this
  // covers the degraded case so it still never interrupts the session.
  for (const p of [
    "Write(//private/tmp/**)",
    "Edit(//private/tmp/**)",
    "Write(//tmp/**)",
    "Edit(//tmp/**)",
  ])
    allow.add(p);
```

- [ ] **Step 2: Add `additionalDirectories`**

Find:

```js
    permissions: {
      allow: [...allow].sort(),
      deny: [
        "Read(./.env)",
        "Read(./.env.*)",
        "Read(./**/.env)",
        "Read(./**/.env.*)",
        "Read(./secrets/**)",
      ],
    },
```

Replace with:

```js
    permissions: {
      allow: [...allow].sort(),
      deny: [
        "Read(./.env)",
        "Read(./.env.*)",
        "Read(./**/.env)",
        "Read(./**/.env.*)",
        "Read(./secrets/**)",
      ],
      // Covers sessionScratchDir()'s fallback path — see the allow-list comment above.
      additionalDirectories: ["/tmp", "/private/tmp"],
    },
```

- [ ] **Step 3: Run the settings-focused tests**

Run: `node --test tests/settings-strict.test.mjs tests/unit.test.mjs`
Expected: PASS. If any test fails asserting settings.json's exact shape/key-count, update that assertion to include the new `allow` entries and `additionalDirectories` — do not remove or weaken this task's addition to make an unrelated assertion pass.

- [ ] **Step 4: Run the full suite**

Run: `npm test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/generate/settings.mjs
git commit -m "feat(settings): allow-list /tmp and /private/tmp as a safety net for the scratchpad fallback path"
```

---

### Task 10: Update the governing rule docs

**Files:**
- Modify: `.claude/rules/hooks-cross-platform.md`
- Modify: `.claude/rules/hooks-cwd-resolution.md`

**Context:** `hooks-cross-platform.md` currently affirmatively instructs hook authors to use `os.tmpdir()` for "every path, home, and temp reference" — that instruction is exactly what caused the bug this plan fixes, and would cause a future hook (written by a human or an agent reading this rule) to reintroduce it. `hooks-cwd-resolution.md`'s Purpose B guidance says a shared flag-file hash "must stay on `CLAUDE_PROJECT_DIR`, never `event.cwd`" — this was correct about avoiding cwd-drift-across-worktree-entry, but didn't anticipate that hashing on `CLAUDE_PROJECT_DIR` collides across **parallel sessions** of the same project. Both docs need updating so the fix isn't silently reverted by the next hook change.

- [ ] **Step 1: Update `.claude/rules/hooks-cross-platform.md`**

Find this section:

```
- Use `os.homedir()`, `os.tmpdir()`, and `path.join()` for every path, home, and temp reference.
```

Replace with:

```
- Use `os.homedir()` and `path.join()` for every path and home-directory reference.
- **For session-transient state a hook writes and later reads back (flag files, dedup markers, per-session caches): use `sessionScratchDir(sessionId)` from `templates/hooks/session-scratch.mjs`, never raw `os.tmpdir()`.** A raw `os.tmpdir()` write falls outside Claude Code's pre-authorized per-session scratchpad and can trigger a mid-session permission prompt; worse, if the state is keyed by a project-directory hash instead of the session id, **parallel sessions of the same project silently share the file** — see `.claude/rules/hooks-cwd-resolution.md`'s Purpose B section for the concrete bug this caused. `sessionScratchDir()` is permission-free (it resolves inside Claude Code's own scratchpad) and inherently unique per session — no hash needed.
- Raw `os.tmpdir()` remains correct only for state that is deliberately **not** session-scoped and whose cross-session/cross-process sharing is harmless or desired — e.g. a content-addressed cache of external, non-project-specific data, or an intentional single global lock serializing unrelated background work. Any such use must carry a comment explaining why it is safe to share, matching the existing exceptions actually in this codebase (a downloaded-schema cache keyed by content, not by session — though even that one migrated to the session scratch dir in this project for consistency; see git history).
```

- [ ] **Step 2: Update `.claude/rules/hooks-cwd-resolution.md`**

Find this section:

```
**Purpose B — stable session identity key.** Some hooks hash a directory to
compute a shared temp-file path used to pass state from one hook invocation
to a *later, different* hook invocation in the same session (e.g.
`set-files-changed.mjs` writes a flag keyed on this hash; `memory-stop.mjs`,
`large-file-warning.mjs`, and the generated strict `verify-on-stop` hook all
read it later). This key **must stay on `CLAUDE_PROJECT_DIR`, never
`event.cwd`** — `event.cwd` can differ between the write and the read if the
session entered or left a worktree in between, which would silently break
the correlation (the reader would never find what the writer wrote).

```js
const projectDir = process.env.CLAUDE_PROJECT_DIR ?? process.cwd(); // Purpose B — do not add event.cwd here
const hash = createHash("sha1").update(projectDir).digest("hex").slice(0, 12);
```
```

Replace with:

```
**Purpose B — stable session identity key.** Some hooks need a shared
storage location to pass state from one hook invocation to a *later,
different* hook invocation in the same session (e.g. `set-files-changed.mjs`
writes a flag; `memory-stop.mjs`, `large-file-warning.mjs`, and the generated
strict `verify-on-stop` hook all read it later). **Use
`sessionScratchDir(sessionId)` from `templates/hooks/session-scratch.mjs`,
keyed by `event.session_id` — never `event.cwd`, and never a hash of
`CLAUDE_PROJECT_DIR`.**

```js
const sessionId = typeof event.session_id === "string" ? event.session_id : "nosession";
const flag = path.join(sessionScratchDir(sessionId), "files-changed"); // Purpose B
```

Two independent reasons neither of the other two values works for Purpose B:
- `event.cwd` can differ between the write and the read if the session
  entered or left a worktree in between, silently breaking the correlation
  (the reader would never find what the writer wrote).
- A hash of `CLAUDE_PROJECT_DIR` (the pattern this project used before) stays
  stable across worktree entry *within one session* — but `CLAUDE_PROJECT_DIR`
  is identical across **parallel** sessions of the same project (root +
  worktree A + worktree B — exactly the workflow `claude-code-worktrees`
  supports). Two parallel sessions hashing to the same file silently mix each
  other's state: session B's edited-file paths leak into session A's lint
  target list, a SQL-review flag set by session A suppresses session B's own
  review, etc. `event.session_id` is unique per session (including per
  worktree session), so keying on it directly — with no hash needed at all —
  fixes both the worktree-entry-drift problem the old pattern solved AND the
  parallel-session collision it didn't anticipate.
```

- [ ] **Step 3: Update the "Canonical examples" section**

Find:

```
## Canonical examples in this codebase

- Pure Purpose A: `guard-main-branch.mjs`, `worktree-write-guard.mjs`.
- Purpose A + B split in the same file: `large-file-warning.mjs`,
  `sql-idempotent-review.mjs`.
- Pure Purpose B (correctly never touches `event.cwd`): `set-files-changed.mjs`, `memory-stop.mjs`.
```

Replace with:

```
## Canonical examples in this codebase

- Pure Purpose A: `guard-main-branch.mjs`, `worktree-write-guard.mjs`.
- Purpose A + B split in the same file: `large-file-warning.mjs`,
  `sql-idempotent-review.mjs`.
- Pure Purpose B (correctly never touches `event.cwd` or `CLAUDE_PROJECT_DIR`
  for the flag path — only `sessionScratchDir(sessionId)`):
  `set-files-changed.mjs`, `memory-stop.mjs`, `worktree-prompt-ctx.mjs`.
```

- [ ] **Step 4: Update the "Forbidden" section**

Find:

```
- Don't resolve an operational directory from `CLAUDE_PROJECT_DIR`/`process.cwd()` alone when `event.cwd` is available — that is this exact bug.
- Don't key a shared flag-file hash on `event.cwd` — that breaks cross-invocation state correlation.
```

Replace with:

```
- Don't resolve an operational directory from `CLAUDE_PROJECT_DIR`/`process.cwd()` alone when `event.cwd` is available — that is this exact bug.
- Don't key Purpose-B shared state on `event.cwd` — that breaks cross-invocation state correlation.
- Don't key Purpose-B shared state on a hash of `CLAUDE_PROJECT_DIR` (or any other project-identity value) — that collides across parallel sessions of the same project. Use `sessionScratchDir(event.session_id)`.
```

- [ ] **Step 5: Run the full suite**

Run: `npm test`
Expected: PASS (doc-only change; no test targets rule files directly, but confirms nothing else regressed).

- [ ] **Step 6: Commit**

```bash
git add .claude/rules/hooks-cross-platform.md .claude/rules/hooks-cwd-resolution.md
git commit -m "docs(rules): point hook temp-state guidance at sessionScratchDir, not os.tmpdir()/project-hash"
```

---

### Task 11: Sync this repo's own dogfooded hooks + settings.json + final full verification

**Files:**
- Create: `.claude/hooks/session-scratch.mjs` (copy of `templates/hooks/session-scratch.mjs`)
- Modify: `.claude/hooks/large-file-warning.mjs` (sync from `templates/hooks/large-file-warning.mjs`)
- Modify: `.claude/hooks/validate-settings-schema.mjs` (sync from `templates/hooks/validate-settings-schema.mjs`)
- Modify: `.claude/settings.json` (add Task 9's safety-net entries — surgical merge, not regeneration)
- **Do not touch:** `.claude/hooks/verify-on-stop.mjs` — see Context below.

**Context:** This repo dogfoods its own harness — `.claude/hooks/` here is a **live, separately-tracked copy** of a subset of `templates/hooks/`, not a symlink. Verified by diffing: before this plan's changes, `.claude/hooks/large-file-warning.mjs` and `.claude/hooks/validate-settings-schema.mjs` are byte-identical to their `templates/hooks/` counterparts (confirmed via `diff`, zero output both times) — so syncing them is a pure copy, no local customization to preserve or lose. `.claude/hooks/set-files-changed.mjs`, `memory-stop.mjs`, `sql-idempotent-review.mjs`, and `worktree-prompt-ctx.mjs` do **not exist** in this repo's own `.claude/hooks/` at all (this repo's dogfood config predates or excludes them) — nothing to sync for those four.

`.claude/hooks/verify-on-stop.mjs` (2.8K) is a **third, hand-tailored variant** — verified by reading its full content: it runs typecheck/lint/tests directly via `node_modules/*/bin/*` paths and reports a non-blocking `systemMessage` (never `{decision:"block"}`), with **no flag file, no `os.tmpdir()`, no `sessionScratchDir` need at all** — it re-checks `git status --porcelain` fresh on every invocation. It is neither the passive template nor the strict generated template. This file is unaffected by the bug this plan fixes; overwriting it with the generic strict-generated content would silently replace a deliberately-customized non-blocking dev workflow with a different, blocking one — out of scope, do not touch it.

`.claude/settings.json` (this repo's own live settings) is confirmed **hand-maintained, not a byte-for-byte output of `renderSettings()`** — it carries repo-specific entries (e.g. `"Bash(node bin/harness.mjs:*)"`) that the generic generator never produces. Verified via direct read: `permissions.allow` has 15 entries today and no `additionalDirectories` key at all. So this task's settings.json step is a **surgical merge** (add 4 strings to the existing `allow` array, add one new `additionalDirectories` key) — never regenerate or overwrite the file wholesale.

- [ ] **Step 1: Copy the new shared helper into the dogfooded hooks dir**

```bash
cp templates/hooks/session-scratch.mjs .claude/hooks/session-scratch.mjs
```

- [ ] **Step 2: Sync the two affected dogfooded hooks**

```bash
cp templates/hooks/large-file-warning.mjs .claude/hooks/large-file-warning.mjs
cp templates/hooks/validate-settings-schema.mjs .claude/hooks/validate-settings-schema.mjs
```

- [ ] **Step 3: Confirm `.claude/hooks/verify-on-stop.mjs` is untouched**

Run: `git status --porcelain .claude/hooks/verify-on-stop.mjs`
Expected: no output (file not modified by this task).

- [ ] **Step 4: Merge Task 9's safety net into this repo's own `.claude/settings.json`**

Read `.claude/settings.json`. Inside the existing `"permissions"` object, add 4 strings to the existing `"allow"` array (keep every current entry — this is additive, not a replacement) and add a new `"additionalDirectories"` key alongside `"allow"`/`"deny"`:

```json
"allow": [
  "Bash(npm run:*)",
  "Bash(npm test:*)",
  "Bash(npm install)",
  "Bash(npm ci)",
  "Bash(node bin/harness.mjs:*)",
  ...(every other existing entry, unchanged)...,
  "Write(//private/tmp/**)",
  "Edit(//private/tmp/**)",
  "Write(//tmp/**)",
  "Edit(//tmp/**)"
],
```

```json
"additionalDirectories": ["/tmp", "/private/tmp"],
```

(Exact placement of the 4 new `allow` strings and the new `additionalDirectories` key within the object doesn't matter — JSON key/array order is not semantically significant here. Use the Edit tool for a targeted insertion; do not regenerate or reformat the rest of the file.)

- [ ] **Step 5: Run the full verification suite**

Run: `npm test`

This runs `npm run typecheck && npm run lint && npm run test:unit` (per `package.json`). Expected: all clean.

If `npm test` surfaces failures in test files **not** explicitly listed in this plan (e.g. a test that enumerates `PROJECT_HOOK_FILES`'s exact contents/count and doesn't yet know about `session-scratch.mjs`, or a plan/apply snapshot test whose expected artifact list is now stale by one file) — this is expected, in-scope fallout from Task 1's catalog registration: update the failing assertion to account for the new file, don't skip or work around it. Per `CLAUDE.md`'s mandatory rule on compilation/lint/typecheck errors, every failure surfaced at this point must be resolved, in this file or any other, before the task is done — even if the failing file wasn't directly edited by an earlier task.

- [ ] **Step 6: Manually verify the resolver against this real session's actual scratchpad**

Run (adjust nothing — this exercises the real, non-test code path on this exact machine):

```bash
node -e "
const { sessionScratchDir } = await import('./templates/hooks/session-scratch.mjs');
const dir = sessionScratchDir('smoke-test-session');
console.log('resolved:', dir);
console.log('under real scratchpad:', dir.includes('/scratchpad/'));
"
```

Expected: `resolved:` prints a path containing `/private/tmp/claude-<uid>/` (or `/tmp/claude-<uid>/`) `/scratchpad/aia-harness`, and `under real scratchpad: true` — confirming the resolver finds the actual pre-authorized directory on this machine, not the fallback. If it prints `false` (fallback used), investigate before proceeding — it means the candidate-root search isn't matching this session's real scratchpad layout, which would defeat the permission-prompt fix this plan exists for.

- [ ] **Step 7: Commit**

```bash
git add .claude/hooks/session-scratch.mjs .claude/hooks/large-file-warning.mjs .claude/hooks/validate-settings-schema.mjs .claude/settings.json
git commit -m "chore(dogfood): sync this repo's own hooks + settings.json to the session-scratch migration"
```

---

## Self-Review Notes (completed during planning, kept for the record)

- **Spec coverage:** permission-prompt fix (Tasks 1-8 via `sessionScratchDir`, Task 9 as a defense-in-depth safety net for the fallback path — replicating the two-mechanism approach confirmed from a sibling project's production fix), cross-session/cross-worktree collision fix (Tasks 2-8, each with a dedicated regression test), node_modules/`.husky`/`.docker` worktree isolation (verified already fixed in `worktree-create.mjs` by recent commits `fc10c0f`/`dbb01f9` — no task needed, confirmed via `diff`-free re-read), schema-cache decision (Task 7, per project decision: migrate), dogfood-copy decision (Task 11, per project decision: sync the 2 affected hooks + settings.json safety net, explicitly exclude the 1 unaffected hook variant with justification).
- **Placeholder scan:** no "TBD"/"add error handling"/bare "similar to Task N" — every task carries complete before/after code; the two largest test files (Tasks 4, 5) use an explicit named enumeration + one worked example per distinct call-site shape instead of a full-file dump, but every substitution rule is a concrete code pair, not prose.
- **Type consistency:** `sessionScratchDir(sessionId, roots?)` signature, the `"files-changed"` / `"largefile-notified"` / `"sql-notified"` / `"worktree-renamed"` / `"settings-schema-cache.json"` filename constants, and the `sidFor`/`path.basename(dir)` session-id-from-tempdir convention are used identically across every task that touches them.
