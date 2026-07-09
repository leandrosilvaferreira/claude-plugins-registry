# Worktree Dependency Seeding Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a new stack-independent, always-installed hook pillar to aia-harness that seeds `node_modules`, the Husky shim, and any local Docker volume state into every new git worktree (copy, never symlink), and reimplements `.worktreeinclude` copying — because configuring a `WorktreeCreate` hook disables Claude Code's native handling of it.

**Architecture:** Two new static `.mjs` hooks under `templates/hooks/` (`worktree-create.mjs`, `worktree-remove.mjs`), registered in `PROJECT_HOOK_FILES` (`lib/data/project-catalog.mjs`) so they ship to every target project exactly like the four existing sibling `worktree-*.mjs` hooks, and hardcoded into `renderSettings()` (`lib/generate/settings.mjs`) under three wirings: `WorktreeCreate`, `WorktreeRemove`, and a new `PostToolUse` matcher group for `EnterWorktree`. `worktree-create.mjs` serves both `WorktreeCreate` (replaces native `git worktree add`) and `PostToolUse:EnterWorktree` (idempotent re-seed safety net for worktrees that already existed) — it branches only on the final stdout contract, per event. All stack-adaptation (Node ecosystem, Husky, Docker) is self-detected at runtime via `fs.existsSync`, not gated at the catalog/stack-key level — this mirrors the existing `large-file-warning.mjs` pattern (one static script, behavior branches on `event.hook_event_name` / filesystem probes) rather than adding new stack-key plumbing.

**Tech Stack:** Node ESM (`.mjs`), `node:fs`, `node:child_process`, `node:path`. No new dependencies.

## Global Constraints

- Every hook is `.mjs`, invoked exec-form (`command:"node"`, `args:[...]`) — see `.claude/rules/hooks-cross-platform.md`.
- Every `execFileSync`/`spawn` call MUST pass `windowsHide: true` — no exceptions.
- Hooks exit **0 or 2 only**. Exit 2 = blocking-error/stderr-to-Claude (schema-valid for both `WorktreeCreate` and `PostToolUse`); never use `process.exit(1)`.
- **Command-hook stdout contract for `WorktreeCreate`**: on success, write the absolute worktree path as a **bare string** to stdout — no JSON, no trailing newline beyond what `path.join` naturally has none of. This is confirmed both by the doc comment on `WorktreeCreateHookSpecificOutput` in the installed `@anthropic-ai/claude-agent-sdk`'s `sdk.d.ts` ("Command hooks print the path on stdout instead") and independently by a second investigation grepping the compiled Claude Code binary's embedded error string ("command: echo the path to stdout; http/callback: return hookSpecificOutput.worktreePath"). The JSON `hookSpecificOutput.worktreePath` shape is for `"type":"http"`/`"callback"` hooks only — irrelevant here, this harness ships exclusively `"type":"command"` hooks.
- **`WorktreeRemoveHookInput`'s path field is `worktree_path` (snake_case)** — not `path`. Confirmed against the installed SDK's `sdk.d.ts`: `WorktreeRemoveHookInput = BaseHookInput & { hook_event_name: 'WorktreeRemove'; worktree_path: string }`.
- **Copy, never symlink**, for `node_modules` and `.docker`: use `fs.cpSync(src, dest, { recursive: true, mode: fs.constants.COPYFILE_FICLONE })` (copy-on-write reflink where supported — macOS APFS, Linux Btrfs/XFS — silent fallback to full copy elsewhere). A symlinked `node_modules` makes parallel Vitest/Vite runs (root + worktree, or worktree + worktree) race on shared scratch state like `node_modules/.vite-temp`.
- Gate the entire `node_modules` block on `fs.existsSync(path.join(cwd, "package.json"))` — a project with no `package.json` must never attempt an `npm install` fallback.
- Gate the entire `.husky` block (copy attempt, regenerate attempt, **and** the missing-shim warning) on `fs.existsSync(path.join(cwd, ".husky"))` at the repo root — a project that doesn't use Husky must never see the "hooks will be INACTIVE" warning.
- `WorktreeRemove` never deletes the branch — only the worktree checkout. Branch deletion is destructive and out of scope.
- `cwd` resolution follows `.claude/rules/hooks-cwd-resolution.md` Purpose A: prefer `event.cwd`, then `process.env.CLAUDE_PROJECT_DIR`, then `process.cwd()`.
- No new stack-key/catalog-gating plumbing — both hooks are unconditional entries in `PROJECT_HOOK_FILES`, matching the four existing `worktree-*.mjs` siblings which are also unconditional.
- v1 scope is the Node ecosystem (`package.json`/lockfile), Husky, and `.docker`, by name — not a generic `.gitignore`-driven seeder. Out of scope; do not add.

---

### Task 1: Fix `validateWorktreeCreateOutput` to accept the command-hook bare-path stdout contract

**Files:**
- Modify: `lib/validate/hook-schema-extra.mjs:88-107`
- Modify: `tests/hook-schema.test.mjs` (near line 1156, inside the existing `// WorktreeCreate` test block)

**Interfaces:**
- Consumes: `parseOutput`, `requireObject`, `checkHookSpecificOutput`, `validateCommonFields` — all already exported from `lib/validate/hook-schema-helpers.mjs` (no changes to that file).
- Produces: `validateWorktreeCreateOutput(stdout, exitCode)` — same exported name/signature as today, from `lib/validate/hook-schema-extra.mjs`, re-exported via `lib/validate/hook-schema.mjs`. Task 2's test file imports this.

**Context:** Today, `validateWorktreeCreateOutput` calls the shared `parseStdout` helper, which treats ANY non-empty, non-JSON stdout at exit 0 as invalid ("stdout is not valid JSON"). That's correct for every other event, but wrong for `WorktreeCreate`: per the Global Constraints above, a correct, successful command-hook run prints a bare path — not JSON. Right now that correct behavior would fail this repo's own compliance test. This task fixes the validator only; it does not touch hook behavior.

- [ ] **Step 1: Read the current implementation to confirm line numbers before editing**

Run: `sed -n '80,110p' lib/validate/hook-schema-extra.mjs`
Expected: shows the current `validateWorktreeCreateOutput` function (uses `parseStdout`).

- [ ] **Step 2: Update the import line at the top of `lib/validate/hook-schema-extra.mjs`**

Find:
```js
import {
  validateCommonFields,
  validateStandardOutput,
  checkHookSpecificOutput,
  checkStringArrayField,
  checkBooleanField,
  checkObjectField,
  checkEnumField,
  parseStdout,
  makeContextValidator,
} from "./hook-schema-helpers.mjs";
```

Replace with:
```js
import {
  validateCommonFields,
  validateStandardOutput,
  checkHookSpecificOutput,
  checkStringArrayField,
  checkBooleanField,
  checkObjectField,
  checkEnumField,
  parseStdout,
  parseOutput,
  requireObject,
  makeContextValidator,
} from "./hook-schema-helpers.mjs";
```

(`parseStdout` stays — `validateElicitationLikeOutput` and `validateWatchPathsOutput` in this same file still use it.)

- [ ] **Step 3: Replace the `validateWorktreeCreateOutput` function body**

Find:
```js
export function validateWorktreeCreateOutput(stdout, exitCode) {
  const r = parseStdout(stdout, exitCode);
  if (!r.ok) return r.result;
  const { obj } = r;
  /** @type {string[]} */
  const errors = [];
  if ("hookSpecificOutput" in obj) {
    const hso = obj.hookSpecificOutput;
    errors.push(...checkHookSpecificOutput(hso, "WorktreeCreate", []));
    if (typeof hso === "object" && !Array.isArray(hso) && hso !== null) {
      if (typeof hso.worktreePath !== "string") {
        errors.push(
          `hookSpecificOutput.worktreePath is required and must be a string, got ${typeof hso.worktreePath}`,
        );
      }
    }
  }
  errors.push(...validateCommonFields(obj));
  return { valid: errors.length === 0, errors };
}
```

Replace with:
```js
export function validateWorktreeCreateOutput(stdout, exitCode) {
  if (exitCode !== 0 && exitCode !== 2) {
    return { valid: false, errors: [`exit code must be 0 or 2, got ${exitCode}`] };
  }
  if (exitCode === 2) return { valid: true, errors: [] };

  const { parsed, parseError } = parseOutput(stdout);
  if (parseError) {
    // "type":"command" hooks (the only kind this harness ships) print the
    // worktree path as a BARE string on stdout, not JSON — confirmed by the
    // WorktreeCreateHookSpecificOutput doc comment in the installed
    // @anthropic-ai/claude-agent-sdk sdk.d.ts ("Command hooks print the path
    // on stdout instead") and independently by the compiled binary's embedded
    // error string. parseOutput() already treats genuinely empty/whitespace
    // stdout as `parseError: null` above, so reaching this branch means real,
    // non-empty, non-JSON content — that bare path.
    return { valid: true, errors: [] };
  }
  if (parsed === null) return { valid: true, errors: [] };
  const objErr = requireObject(parsed);
  if (objErr) return { valid: false, errors: [objErr] };

  const obj = /** @type {Record<string, any>} */ (parsed);
  /** @type {string[]} */
  const errors = [];
  if ("hookSpecificOutput" in obj) {
    const hso = obj.hookSpecificOutput;
    errors.push(...checkHookSpecificOutput(hso, "WorktreeCreate", []));
    if (typeof hso === "object" && !Array.isArray(hso) && hso !== null) {
      if (typeof hso.worktreePath !== "string") {
        errors.push(
          `hookSpecificOutput.worktreePath is required and must be a string, got ${typeof hso.worktreePath}`,
        );
      }
    }
  }
  errors.push(...validateCommonFields(obj));
  return { valid: errors.length === 0, errors };
}
```

- [ ] **Step 4: Add a test case in `tests/hook-schema.test.mjs`**

Find (the first test in the `// WorktreeCreate` block):
```js
test("WorktreeCreate: empty stdout + exit 0 is valid (path printed on stdout instead)", () => {
  assertValid(validateWorktreeCreateOutput("", 0));
});
```

Replace with (adds one new test immediately after, keeps the original):
```js
test("WorktreeCreate: empty stdout + exit 0 is valid (path printed on stdout instead)", () => {
  assertValid(validateWorktreeCreateOutput("", 0));
});

test("WorktreeCreate: bare non-JSON stdout (command-hook path contract) is valid", () => {
  assertValid(validateWorktreeCreateOutput("/repo/.claude/worktrees/feat-x", 0));
});
```

- [ ] **Step 5: Run the schema test file and confirm it passes**

Run: `node --test tests/hook-schema.test.mjs`
Expected: all tests pass, including the two `WorktreeCreate` bare-stdout cases.

- [ ] **Step 6: Typecheck + lint**

Run: `npm run typecheck && npm run lint`
Expected: clean, no errors.

- [ ] **Step 7: Commit**

```bash
git add lib/validate/hook-schema-extra.mjs tests/hook-schema.test.mjs
git commit -m "fix: accept bare-path stdout in WorktreeCreate hook-schema validator"
```

---

### Task 2: `worktree-create.mjs` hook (WorktreeCreate + PostToolUse:EnterWorktree)

**Files:**
- Create: `templates/hooks/worktree-create.mjs`
- Create: `tests/hook-worktree-create.test.mjs`

**Interfaces:**
- Consumes: `validateWorktreeCreateOutput` (fixed in Task 1, from `lib/validate/hook-schema.mjs`), `validatePostToolUseOutput` (already exists, unchanged), `runHook`/`runHookRaw`/`mkGitRepo`/`assertCleanStdoutJson` from `tests/hook-runner.mjs` (already exist, unchanged).
- Produces: the file `templates/hooks/worktree-create.mjs` (a script, no JS exports — referenced by filename string `"worktree-create.mjs"` in Task 4).

**Context:** This hook has two entry points sharing one file, matching the `large-file-warning.mjs` precedent of one script branching on `event.hook_event_name`:
- `WorktreeCreate` stdin (`WorktreeCreateHookInput`): `{hook_event_name:"WorktreeCreate", name, cwd, ...}`. Must create the worktree (replaces native `git worktree add`) and print its absolute path as a bare stdout string.
- `PostToolUse` stdin with `tool_name:"EnterWorktree"` (`PostToolUseHookInput`): `{hook_event_name:"PostToolUse", tool_input:{name|path}, cwd, ...}`. Fires on every `EnterWorktree` call, including entry into an already-existing worktree — an idempotent "make sure the seeds are there" safety net. `PostToolUse`'s schema has no bare-path convention, so this path must stay silent (empty stdout).

- [ ] **Step 1: Write `templates/hooks/worktree-create.mjs`**

```js
#!/usr/bin/env node
/**
 * Worktree seed hook — WorktreeCreate + PostToolUse:EnterWorktree.
 *
 * WorktreeCreate stdin (WorktreeCreateHookInput): {hook_event_name:"WorktreeCreate",
 * name, cwd, ...}. This is a "type":"command" hook — Claude Code's native
 * `git worktree add` is replaced entirely once this is wired; on success this
 * hook must print the absolute worktree path as a BARE string on stdout (no
 * JSON — that shape is only for "type":"http"/"callback" hooks, per the
 * WorktreeCreateHookSpecificOutput doc comment in the installed
 * @anthropic-ai/claude-agent-sdk sdk.d.ts).
 *
 * PostToolUse stdin with tool_name "EnterWorktree" (PostToolUseHookInput):
 * {hook_event_name:"PostToolUse", tool_input:{name|path}, cwd, ...} — fires on
 * every EnterWorktree call, including entry into a worktree that already
 * existed. Used here as an idempotent re-seed safety net. PostToolUse's schema
 * has no bare-path convention, so this path stays silent (empty stdout).
 */
import { execFileSync, spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

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

/**
 * @param {string} cwd
 * @param {string[]} args
 * @returns {string}
 */
function git(cwd, args) {
  try {
    return execFileSync("git", args, {
      cwd,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
      windowsHide: true,
    }).trim();
  } catch {
    return "";
  }
}

const isCreate = event.hook_event_name === "WorktreeCreate";

// WorktreeCreate gives {name}; PostToolUse:EnterWorktree gives {tool_input:{name|path}}.
let name = typeof event.name === "string" ? event.name : "";
let wtPathInput = "";
if (!name) {
  const ti = event.tool_input ?? {};
  name = typeof ti.name === "string" ? ti.name : "";
  wtPathInput = typeof ti.path === "string" ? ti.path : "";
}

// Purpose A (operational directory): prefer event.cwd, then CLAUDE_PROJECT_DIR,
// then process.cwd() — see .claude/rules/hooks-cwd-resolution.md.
const cwdArg = typeof event.cwd === "string" && event.cwd ? event.cwd : "";
let cwd = cwdArg || process.env.CLAUDE_PROJECT_DIR || process.cwd();

// If cwd is already inside a worktree (PostToolUse can fire after EnterWorktree's
// own cwd switch), the real repo root is the prefix before the marker.
const insideWorktree = cwd.match(/^(.+?)[/\\]\.claude[/\\]worktrees[/\\]/);
if (insideWorktree) cwd = insideWorktree[1];

// An explicit path (from PostToolUse:EnterWorktree) wins for root+name.
// EnterWorktree can pass a RELATIVE path — resolve it before matching.
if (wtPathInput) {
  const abs = path.isAbsolute(wtPathInput) ? wtPathInput : path.resolve(cwd, wtPathInput);
  const m = abs.match(/^(.+?)[/\\]\.claude[/\\]worktrees[/\\]([^/\\]+)[/\\]?$/);
  if (m) {
    cwd = m[1];
    if (!name) name = m[2];
  }
}

if (!name) process.exit(0);
const dir = path.join(cwd, ".claude", "worktrees", name);

// Worktree already on disk (EnterWorktree entering an existing local worktree) → skip git creation.
if (!fs.existsSync(dir)) {
  git(cwd, ["worktree", "prune"]);
  try {
    execFileSync("git", ["worktree", "add", dir, "-b", name], {
      cwd,
      stdio: "ignore",
      windowsHide: true,
    });
  } catch {
    try {
      execFileSync("git", ["worktree", "add", dir, name], {
        cwd,
        stdio: "ignore",
        windowsHide: true,
      });
    } catch {
      /* checked below */
    }
  }
}

if (!fs.existsSync(dir)) {
  process.stderr.write(`worktree-create: failed to create ${dir}\n`);
  process.exit(2);
}

/**
 * Package manager install command for a fresh `node_modules`, chosen by lockfile.
 * @param {string} d
 * @returns {{ cmd: string, args: string[] }}
 */
function detectInstallCommand(d) {
  if (fs.existsSync(path.join(d, "pnpm-lock.yaml"))) return { cmd: "pnpm", args: ["install"] };
  if (fs.existsSync(path.join(d, "yarn.lock"))) return { cmd: "yarn", args: ["install"] };
  if (fs.existsSync(path.join(d, "bun.lockb")) || fs.existsSync(path.join(d, "bun.lock")))
    return { cmd: "bun", args: ["install"] };
  return { cmd: "npm", args: ["install"] };
}

// node_modules: isolated copy, never a symlink — gated on package.json so a
// non-Node project never attempts this block. Vitest/Vite write scratch state
// into node_modules/.vite-temp; a symlinked node_modules shares that dir
// between root and every worktree, so parallel test runs race on it (one
// process removes/renames it while another reads/writes). COPYFILE_FICLONE
// asks for a copy-on-write reflink (near-instant, space-efficient on APFS/
// Btrfs/XFS) and silently falls back to a full copy where unsupported. Trade-
// off accepted: root `npm install` no longer propagates to already-live
// worktrees — run it inside the worktree itself for a new dependency.
if (fs.existsSync(path.join(cwd, "package.json"))) {
  const rootModules = path.join(cwd, "node_modules");
  const wtModules = path.join(dir, "node_modules");
  if (fs.existsSync(rootModules)) {
    if (!fs.existsSync(wtModules)) {
      try {
        fs.cpSync(rootModules, wtModules, {
          recursive: true,
          mode: fs.constants.COPYFILE_FICLONE,
        });
      } catch {
        try {
          fs.rmSync(wtModules, { recursive: true, force: true });
          fs.symlinkSync(rootModules, wtModules, "dir");
          process.stderr.write(
            "worktree-create: WARNING — node_modules copy failed; symlinked as last resort. " +
              "Parallel test runs may conflict via a shared node_modules/.vite-temp.\n",
          );
        } catch {
          /* nothing more we can do */
        }
      }
    }
  } else if (!fs.existsSync(wtModules)) {
    // No root node_modules to copy — install fresh, backgrounded so this hook
    // doesn't block the session on a full install.
    const { cmd, args } = detectInstallCommand(cwd);
    spawn(cmd, args, { cwd: dir, stdio: "ignore", detached: true, windowsHide: true }).unref();
  }
}

// .husky/_: Husky's generated shim (from `npm run prepare`/`husky`), ignored via
// its own .husky/_/.gitignore — git worktree only materializes tracked content,
// so a new worktree never inherits it. Gated on the root .husky dir existing at
// all, so a project that doesn't use Husky never triggers this block or its
// warning. Without the shim, core.hooksPath points at an empty dir and git
// silently skips pre-commit/pre-push there. Never symlink: a shared inode means
// one worktree regenerating it (via `npm install`/`prepare`) can race with
// another mid-commit/push.
if (fs.existsSync(path.join(cwd, ".husky"))) {
  const wtHuskyShim = path.join(dir, ".husky", "_");
  if (!fs.existsSync(wtHuskyShim)) {
    const rootHuskyShim = path.join(cwd, ".husky", "_");
    if (fs.existsSync(rootHuskyShim)) {
      try {
        fs.cpSync(rootHuskyShim, wtHuskyShim, { recursive: true });
      } catch {
        /* checked below */
      }
    } else if (fs.existsSync(path.join(dir, ".husky"))) {
      try {
        execFileSync("npx", ["husky"], { cwd: dir, stdio: "ignore", windowsHide: true });
      } catch {
        /* checked below */
      }
    }
  }
  if (!fs.existsSync(wtHuskyShim)) {
    process.stderr.write(
      "worktree-create: WARNING — .husky/_ missing; native git hooks (pre-commit, pre-push) " +
        "will be INACTIVE and SILENT in this worktree.\n",
    );
  }
}

// .docker: isolated copy of any local Docker volumes/state at the repo root, if
// present. Same COPYFILE_FICLONE reflink as node_modules above. Never symlink —
// a worktree needs its own independent volume state (e.g. a local DB).
const rootDocker = path.join(cwd, ".docker");
const wtDocker = path.join(dir, ".docker");
if (fs.existsSync(rootDocker) && !fs.existsSync(wtDocker)) {
  try {
    fs.cpSync(rootDocker, wtDocker, { recursive: true, mode: fs.constants.COPYFILE_FICLONE });
  } catch (err) {
    process.stderr.write(
      `worktree-create: WARNING — .docker copy failed: ${err instanceof Error ? err.message : String(err)}\n`,
    );
  }
}

// .worktreeinclude: gitignored files/dirs to copy verbatim. Once WorktreeCreate
// is configured, Claude Code's native .worktreeinclude processing is disabled,
// so this hook must reimplement it.
const includeFile = path.join(cwd, ".worktreeinclude");
if (fs.existsSync(includeFile)) {
  const patterns = fs
    .readFileSync(includeFile, "utf8")
    .split("\n")
    .map((line) => line.replace(/#.*$/, "").trim())
    .filter(Boolean);
  for (const pattern of patterns) {
    const src = path.join(cwd, pattern);
    const dest = path.join(dir, pattern);
    if (fs.existsSync(dest) || !fs.existsSync(src)) continue;
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.cpSync(src, dest, { recursive: true });
  }
}

// Command-hook contract: WorktreeCreate must print the bare path on stdout;
// PostToolUse has no such field and must stay silent (empty, valid stdout).
if (isCreate) process.stdout.write(dir);
process.exit(0);
```

- [ ] **Step 2: Write `tests/hook-worktree-create.test.mjs`**

```js
/**
 * Schema + behavior compliance tests for templates/hooks/worktree-create.mjs
 * Run: node --test tests/hook-worktree-create.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { runHook, runHookRaw, mkGitRepo, assertCleanStdoutJson } from "./hook-runner.mjs";
import {
  validateWorktreeCreateOutput,
  validatePostToolUseOutput,
} from "../lib/validate/hook-schema.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const HOOK = path.join(ROOT, "templates", "hooks", "worktree-create.mjs");

/** Seed a repo dir with node_modules, Husky shim, and a .worktreeinclude'd .env. */
function seedFixture(dir) {
  fs.writeFileSync(path.join(dir, "package.json"), JSON.stringify({ name: "fixture" }));
  fs.mkdirSync(path.join(dir, "node_modules", "some-pkg"), { recursive: true });
  fs.writeFileSync(path.join(dir, "node_modules", "some-pkg", "index.js"), "module.exports = 1;\n");
  fs.mkdirSync(path.join(dir, ".husky", "_"), { recursive: true });
  fs.writeFileSync(path.join(dir, ".husky", "_", "husky.sh"), "# husky shim\n");
  fs.writeFileSync(path.join(dir, ".worktreeinclude"), "# comment\n.env\n");
  fs.writeFileSync(path.join(dir, ".env"), "SECRET=1\n");
}

test("worktree-create: empty stdin → pass through, exit 0", () => {
  const r = runHookRaw(HOOK, "");
  assert.equal(r.exitCode, 0);
  assert.equal(r.stdout, "");
});

test("worktree-create: invalid JSON stdin → pass through, exit 0", () => {
  const r = runHookRaw(HOOK, "not-json{{{");
  assert.equal(r.exitCode, 0);
  assert.equal(r.stdout, "");
});

test("worktree-create: WorktreeCreate with no resolvable name → pass through, exit 0", () => {
  const dir = mkGitRepo("main");
  try {
    const r = runHook(HOOK, { hook_event_name: "WorktreeCreate", cwd: dir });
    assert.equal(r.exitCode, 0);
    assert.equal(r.stdout, "");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("worktree-create: WorktreeCreate creates the worktree and seeds node_modules/husky/.worktreeinclude", () => {
  const dir = mkGitRepo("main");
  try {
    seedFixture(dir);
    const expected = path.join(dir, ".claude", "worktrees", "feat-x");

    const r = runHook(HOOK, { hook_event_name: "WorktreeCreate", name: "feat-x", cwd: dir });

    assert.equal(r.exitCode, 0);
    const v = validateWorktreeCreateOutput(r.stdout, r.exitCode);
    assert.equal(v.valid, true, `Schema invalid: ${v.errors.join("; ")}`);
    assert.equal(r.stdout.trim(), expected, "must print the bare worktree path");
    assert.equal(r.stdout, r.stdout.trim(), "no leading/trailing whitespace around the bare path");

    assert.ok(fs.existsSync(expected), "worktree dir must exist");
    const list = execSync("git worktree list", { cwd: dir, encoding: "utf8" });
    assert.ok(list.includes("feat-x"), "git worktree list must show the new worktree");

    const wtModules = path.join(expected, "node_modules");
    const st = fs.lstatSync(wtModules);
    assert.equal(st.isSymbolicLink(), false, "node_modules must be a real copy, not a symlink");
    assert.equal(st.isDirectory(), true);
    assert.equal(
      fs.readFileSync(path.join(wtModules, "some-pkg", "index.js"), "utf8"),
      "module.exports = 1;\n",
    );

    assert.ok(
      fs.existsSync(path.join(expected, ".husky", "_", "husky.sh")),
      "husky shim must be copied",
    );
    assert.equal(fs.readFileSync(path.join(expected, ".env"), "utf8"), "SECRET=1\n");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("worktree-create: re-running the same WorktreeCreate payload is a safe no-op", () => {
  const dir = mkGitRepo("main");
  try {
    seedFixture(dir);
    const event = { hook_event_name: "WorktreeCreate", name: "feat-x", cwd: dir };
    runHook(HOOK, event);
    const r2 = runHook(HOOK, event);
    assert.equal(r2.exitCode, 0);
    const expected = path.join(dir, ".claude", "worktrees", "feat-x");
    assert.equal(r2.stdout.trim(), expected);
    const st = fs.lstatSync(path.join(expected, "node_modules"));
    assert.equal(st.isSymbolicLink(), false);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("worktree-create: no package.json → node_modules block is skipped entirely", () => {
  const dir = mkGitRepo("main");
  try {
    const r = runHook(HOOK, { hook_event_name: "WorktreeCreate", name: "feat-y", cwd: dir });
    assert.equal(r.exitCode, 0);
    const expected = path.join(dir, ".claude", "worktrees", "feat-y");
    assert.ok(fs.existsSync(expected));
    assert.equal(fs.existsSync(path.join(expected, "node_modules")), false);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("worktree-create: no root .husky → no husky warning on stderr", () => {
  const dir = mkGitRepo("main");
  try {
    const r = runHook(HOOK, { hook_event_name: "WorktreeCreate", name: "feat-z", cwd: dir });
    assert.equal(r.exitCode, 0);
    assert.ok(!/husky/i.test(r.stderr), "must not warn about husky when the project has none");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("worktree-create: creation failure (not a git repo) → exit 2, stderr set, schema-valid", () => {
  const dir = fs.mkdtempSync(path.join(ROOT, ".tmp-worktree-create-test-"));
  try {
    const r = runHook(HOOK, { hook_event_name: "WorktreeCreate", name: "feat-fail", cwd: dir });
    assert.equal(r.exitCode, 2);
    assert.ok(r.stderr.length > 0);
    const v = validateWorktreeCreateOutput(r.stdout, r.exitCode);
    assert.equal(v.valid, true, `Schema invalid: ${v.errors.join("; ")}`);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("worktree-create: PostToolUse:EnterWorktree on an existing worktree stays silent, schema-valid", () => {
  const dir = mkGitRepo("main");
  try {
    seedFixture(dir);
    runHook(HOOK, { hook_event_name: "WorktreeCreate", name: "feat-x", cwd: dir });

    const r = runHook(HOOK, {
      hook_event_name: "PostToolUse",
      tool_name: "EnterWorktree",
      tool_input: { name: "feat-x" },
      cwd: dir,
    });
    assert.equal(r.exitCode, 0);
    assert.equal(r.stdout, "", "PostToolUse path must stay silent, not print the bare path");
    assertCleanStdoutJson(r.stdout);
    const v = validatePostToolUseOutput(r.stdout, r.exitCode);
    assert.equal(v.valid, true, `Schema invalid: ${v.errors.join("; ")}`);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("worktree-create: event.cwd (worktree-nested) resolves the root, overriding CLAUDE_PROJECT_DIR", () => {
  const projectDir = mkGitRepo("main");
  try {
    seedFixture(projectDir);
    runHook(HOOK, { hook_event_name: "WorktreeCreate", name: "feat-x", cwd: projectDir });
    const nestedCwd = path.join(projectDir, ".claude", "worktrees", "feat-x");

    const r = runHook(
      HOOK,
      {
        hook_event_name: "PostToolUse",
        tool_name: "EnterWorktree",
        tool_input: { name: "feat-x" },
        cwd: nestedCwd,
      },
      { env: { CLAUDE_PROJECT_DIR: "/nonexistent/should-not-be-used" } },
    );
    assert.equal(r.exitCode, 0);
  } finally {
    fs.rmSync(projectDir, { recursive: true, force: true });
  }
});
```

- [ ] **Step 3: Run the new test file, confirm every test passes**

Run: `node --test tests/hook-worktree-create.test.mjs`
Expected: all tests pass (0 failures).

- [ ] **Step 4: Typecheck + lint**

Run: `npm run typecheck && npm run lint`
Expected: clean.

- [ ] **Step 5: Commit**

```bash
git add templates/hooks/worktree-create.mjs tests/hook-worktree-create.test.mjs
git commit -m "feat: add worktree-create.mjs hook (WorktreeCreate + PostToolUse:EnterWorktree)"
```

---

### Task 3: `worktree-remove.mjs` hook (WorktreeRemove)

**Files:**
- Create: `templates/hooks/worktree-remove.mjs`
- Create: `tests/hook-worktree-remove.test.mjs`

**Interfaces:**
- Consumes: `validateWorktreeRemoveOutput` (already exists, unchanged, from `lib/validate/hook-schema.mjs`), `runHook`/`runHookRaw`/`mkGitRepo` from `tests/hook-runner.mjs`.
- Produces: the file `templates/hooks/worktree-remove.mjs` (referenced by filename string `"worktree-remove.mjs"` in Task 4).

- [ ] **Step 1: Write `templates/hooks/worktree-remove.mjs`**

```js
#!/usr/bin/env node
/**
 * WorktreeRemove hook. Fires on worktree cleanup (session exit without
 * changes, explicit ExitWorktree "remove", etc).
 *
 * stdin (WorktreeRemoveHookInput, per the installed @anthropic-ai/claude-agent-sdk
 * sdk.d.ts): {hook_event_name:"WorktreeRemove", worktree_path: string, cwd, ...}.
 * NOTE the field is `worktree_path` (snake_case), not `path`.
 *
 * Deliberately does not delete the branch — only the worktree checkout.
 * Deleting a branch is a destructive, out-of-scope action (it may hold real
 * commits); that decision is left to the user/agent.
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";

/** @type {any} */
let event = {};
try {
  event = JSON.parse(fs.readFileSync(0, "utf8") || "{}");
} catch {
  process.exit(0);
}

const wtPath = typeof event.worktree_path === "string" ? event.worktree_path : "";
const cwd =
  typeof event.cwd === "string" && event.cwd
    ? event.cwd
    : process.env.CLAUDE_PROJECT_DIR || process.cwd();
if (!wtPath) process.exit(0);

try {
  execFileSync("git", ["worktree", "remove", "--force", wtPath], {
    cwd,
    stdio: "ignore",
    windowsHide: true,
  });
} catch {
  /* falls through to the rm below regardless */
}
try {
  fs.rmSync(wtPath, { recursive: true, force: true });
} catch {
  /* best-effort */
}
try {
  execFileSync("git", ["worktree", "prune"], { cwd, stdio: "ignore", windowsHide: true });
} catch {
  /* best-effort */
}
process.exit(0);
```

- [ ] **Step 2: Write `tests/hook-worktree-remove.test.mjs`**

```js
/**
 * Schema + behavior compliance tests for templates/hooks/worktree-remove.mjs
 * Run: node --test tests/hook-worktree-remove.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { execFileSync, execSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { runHook, runHookRaw, mkGitRepo } from "./hook-runner.mjs";
import { validateWorktreeRemoveOutput } from "../lib/validate/hook-schema.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const HOOK = path.join(ROOT, "templates", "hooks", "worktree-remove.mjs");
const CREATE_HOOK = path.join(ROOT, "templates", "hooks", "worktree-create.mjs");

test("worktree-remove: empty stdin → pass through, exit 0", () => {
  const r = runHookRaw(HOOK, "");
  assert.equal(r.exitCode, 0);
});

test("worktree-remove: invalid JSON stdin → pass through, exit 0", () => {
  const r = runHookRaw(HOOK, "not-json{{{");
  assert.equal(r.exitCode, 0);
});

test("worktree-remove: no worktree_path field → pass through, exit 0 (event.path is NOT the field)", () => {
  const r = runHook(HOOK, { hook_event_name: "WorktreeRemove", path: "/should/be/ignored" });
  assert.equal(r.exitCode, 0);
});

test("worktree-remove: removes the worktree checkout but keeps the branch", () => {
  const dir = mkGitRepo("main");
  try {
    const createResult = runHook(CREATE_HOOK, {
      hook_event_name: "WorktreeCreate",
      name: "feat-remove-me",
      cwd: dir,
    });
    const wtPath = createResult.stdout.trim();
    assert.ok(fs.existsSync(wtPath), "precondition: worktree must exist before removal");

    const r = runHook(HOOK, { hook_event_name: "WorktreeRemove", worktree_path: wtPath, cwd: dir });
    assert.equal(r.exitCode, 0);
    const v = validateWorktreeRemoveOutput(r.stdout, r.exitCode);
    assert.equal(v.valid, true, `Schema invalid: ${v.errors.join("; ")}`);

    assert.equal(fs.existsSync(wtPath), false, "worktree dir must be gone");
    const list = execSync("git worktree list", { cwd: dir, encoding: "utf8" });
    assert.ok(!list.includes("feat-remove-me"), "git worktree list must not show it anymore");

    const branches = execFileSync("git", ["branch", "--list", "feat-remove-me"], {
      cwd: dir,
      encoding: "utf8",
    });
    assert.ok(branches.includes("feat-remove-me"), "branch must NOT be deleted");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("worktree-remove: re-running on an already-removed path is a safe no-op", () => {
  const dir = mkGitRepo("main");
  try {
    const createResult = runHook(CREATE_HOOK, {
      hook_event_name: "WorktreeCreate",
      name: "feat-double-remove",
      cwd: dir,
    });
    const wtPath = createResult.stdout.trim();
    const event = { hook_event_name: "WorktreeRemove", worktree_path: wtPath, cwd: dir };
    runHook(HOOK, event);
    const r2 = runHook(HOOK, event);
    assert.equal(r2.exitCode, 0);
    assert.equal(fs.existsSync(wtPath), false);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
```

- [ ] **Step 3: Run the new test file, confirm every test passes**

Run: `node --test tests/hook-worktree-remove.test.mjs`
Expected: all tests pass (0 failures).

- [ ] **Step 4: Typecheck + lint**

Run: `npm run typecheck && npm run lint`
Expected: clean.

- [ ] **Step 5: Commit**

```bash
git add templates/hooks/worktree-remove.mjs tests/hook-worktree-remove.test.mjs
git commit -m "feat: add worktree-remove.mjs hook (WorktreeRemove)"
```

---

### Task 4: Register the catalog entries, wire settings.json, verify full suite

**Files:**
- Modify: `lib/data/project-catalog.mjs` (`PROJECT_HOOK_FILES` array)
- Modify: `lib/generate/settings.mjs` (`renderSettings`)
- Modify: `tests/unit.test.mjs`

**Interfaces:**
- Consumes: filenames `"worktree-create.mjs"` (Task 2) and `"worktree-remove.mjs"` (Task 3) — both files must already exist under `templates/hooks/` for `tests/catalog-paths-integrity.test.mjs` and `tests/templates-orphan.test.mjs` to pass (both are generic/pre-existing — no changes needed to either test file).
- Produces: nothing consumed further within this plan — this is the integration task that makes the pillar actually install.

- [ ] **Step 1: Register both files in `PROJECT_HOOK_FILES`**

In `lib/data/project-catalog.mjs`, find:
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
  "validate-settings-schema.mjs",
];
```

Replace with:
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

- [ ] **Step 2: Wire `WorktreeCreate` + `WorktreeRemove` + `PostToolUse:EnterWorktree` in `renderSettings`**

In `lib/generate/settings.mjs`, find:
```js
    PostToolUse: [
      {
        matcher: "Edit|Write|MultiEdit",
        hooks: [
          { type: "command", ...hookCmd("format-on-edit.mjs"), timeout: 60 },
          { type: "command", ...hookCmd("set-files-changed.mjs"), timeout: 30 },
          { type: "command", ...hookCmd("sql-idempotent-review.mjs"), timeout: 10 },
          { type: "command", ...hookCmd("validate-settings-schema.mjs"), timeout: 30 },
        ],
      },
    ],
```

Replace with:
```js
    PostToolUse: [
      {
        matcher: "Edit|Write|MultiEdit",
        hooks: [
          { type: "command", ...hookCmd("format-on-edit.mjs"), timeout: 60 },
          { type: "command", ...hookCmd("set-files-changed.mjs"), timeout: 30 },
          { type: "command", ...hookCmd("sql-idempotent-review.mjs"), timeout: 10 },
          { type: "command", ...hookCmd("validate-settings-schema.mjs"), timeout: 30 },
        ],
      },
      {
        // Idempotent re-seed safety net: fires on every EnterWorktree call,
        // including entry into a worktree that already existed before this
        // hook was configured. worktree-create.mjs stays silent on this path.
        matcher: "EnterWorktree",
        hooks: [{ type: "command", ...hookCmd("worktree-create.mjs"), timeout: 60 }],
      },
    ],
```

Then find:
```js
    Stop: [
      {
        hooks: [
          { type: "command", ...hookCmd("verify-on-stop.mjs"), timeout: 300 },
          { type: "command", ...hookCmd("memory-stop.mjs"), timeout: 30 },
          { type: "command", ...hookCmd("sql-idempotent-review.mjs"), timeout: 15 },
        ],
      },
    ],
  };
```

Replace with:
```js
    Stop: [
      {
        hooks: [
          { type: "command", ...hookCmd("verify-on-stop.mjs"), timeout: 300 },
          { type: "command", ...hookCmd("memory-stop.mjs"), timeout: 30 },
          { type: "command", ...hookCmd("sql-idempotent-review.mjs"), timeout: 15 },
        ],
      },
    ],
    // Replaces Claude Code's native `git worktree add` entirely once configured
    // (also disables native .worktreeinclude processing — worktree-create.mjs
    // reimplements that copy). Must print the created worktree's absolute path
    // as a bare string on stdout (command-hook contract, not JSON).
    WorktreeCreate: [
      { hooks: [{ type: "command", ...hookCmd("worktree-create.mjs"), timeout: 30 }] },
    ],
    // Replaces Claude Code's native worktree cleanup. Removes the worktree
    // checkout only — never deletes the branch (destructive, out of scope).
    WorktreeRemove: [
      { hooks: [{ type: "command", ...hookCmd("worktree-remove.mjs"), timeout: 15 }] },
    ],
  };
```

- [ ] **Step 3: Add a `renderSettings` wiring test to `tests/unit.test.mjs`**

Find:
```js
test("hookCmd: renderSettings emits exec form for hooks", () => {
```

Insert a new test immediately **before** it:
```js
test("renderSettings: wires WorktreeCreate, WorktreeRemove, and PostToolUse:EnterWorktree", () => {
  const json = JSON.parse(renderSettings(minimalProfile()));

  const createGroup = json.hooks.WorktreeCreate?.[0];
  assert.ok(createGroup, "WorktreeCreate hook group missing");
  assert.equal(createGroup.hooks[0].command, "node");
  assert.ok(createGroup.hooks[0].args[0].endsWith("worktree-create.mjs"));
  assert.equal(createGroup.hooks[0].timeout, 30);

  const removeGroup = json.hooks.WorktreeRemove?.[0];
  assert.ok(removeGroup, "WorktreeRemove hook group missing");
  assert.equal(removeGroup.hooks[0].command, "node");
  assert.ok(removeGroup.hooks[0].args[0].endsWith("worktree-remove.mjs"));
  assert.equal(removeGroup.hooks[0].timeout, 15);

  const enterGroup = /** @type {any[]} */ (json.hooks.PostToolUse).find(
    (/** @type {any} */ e) => e.matcher === "EnterWorktree",
  );
  assert.ok(enterGroup, "PostToolUse EnterWorktree group missing");
  assert.ok(enterGroup.hooks[0].args[0].endsWith("worktree-create.mjs"));
  assert.equal(enterGroup.hooks[0].timeout, 60);
});

test("hookCmd: renderSettings emits exec form for hooks", () => {
```

(Note: `renderSettings` and `minimalProfile` are already imported/defined above this point in the file — no new imports needed.)

- [ ] **Step 4: Run the full test suite**

Run: `npm test`
Expected: all tests pass, including (automatically, no new test files needed for these):
- `tests/catalog-paths-integrity.test.mjs` — confirms both new files exist under `templates/hooks/`.
- `tests/templates-orphan.test.mjs` — confirms both new files are registered (they are, via `PROJECT_HOOK_FILES`).
- `tests/hook-schema.test.mjs`, `tests/hook-worktree-create.test.mjs`, `tests/hook-worktree-remove.test.mjs` from Tasks 1-3.
- `tests/unit.test.mjs` — the new wiring test from Step 3.

- [ ] **Step 5: Commit**

```bash
git add lib/data/project-catalog.mjs lib/generate/settings.mjs tests/unit.test.mjs
git commit -m "feat: install worktree-create/worktree-remove hooks via PROJECT_HOOK_FILES + renderSettings"
```
