# sql-idempotent-review Stop mode Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `sql-idempotent-review.mjs` dual-mode so `.sql` files produced by an external generator (drizzle-kit, Hibernate DDL export, Prisma, Liquibase, Alembic, …) via a Bash command get forced review, not just files the agent edited directly.

**Architecture:** The existing `PostToolUse` advisory branch is refactored into a `postToolUse()` function with byte-identical output. A new `blockOnStop()` function is added, wired to the `Stop` event: it sweeps `git status` once at end of turn, and blocks (`decision:"block"`) on any `.sql` file changed this session that was never surfaced by `postToolUse()`. Both branches share one idempotency-rules text (DRY) and one per-session notified-flag (so an agent-edited file is never double-blocked). Mirrors the exact dual-mode pattern already shipped in `templates/hooks/large-file-warning.mjs`.

**Tech Stack:** Node.js ESM (`.mjs`), `node:test` + `node:assert/strict`, `git` CLI via `execFileSync`.

**Spec:** `docs/superpowers/specs/2026-06-30-sql-idempotent-review-stop-mode-design.md`

## Global Constraints

- Every hook stays `.mjs` ESM, exec form only, no shell (`.claude/rules/hooks-cross-platform.md`).
- Every `execFileSync`/`spawn`/`exec`/`execFile`/`fork` call MUST pass `windowsHide: true`.
- Every hook output branch MUST validate against its event's schema in `lib/validate/hook-schema.mjs` (`validatePostToolUseOutput` for PostToolUse, `validateStopOutput` for Stop), exit code 0 or 2 only.
- Fail-open on all infrastructure errors (no git binary, not a git repo, spawn failure) — never throw, never block except on an actual finding.
- The `PostToolUse` branch's observable output (stdout/exit code/stderr) must stay byte-identical to the current implementation — all 22 existing tests in `tests/hook-sql-idempotent-review.test.mjs` must keep passing **unmodified**.
- The shared idempotency rules text must be extracted **verbatim** (character-for-character, no rewording) so existing content-assertion tests keep matching.
- The new `Stop` wiring is additive — both `PostToolUse` and `Stop` entries active simultaneously. This is NOT a mode flag like `--large-files` (which is either/or).
- Shared dedup flag key format: `` `${sessionId}\t${absPath}` `` — mirrors `large-file-warning.mjs`'s own notified-flag pattern exactly.
- No pattern-matching of specific generator commands (drizzle-kit, hibernate, prisma, liquibase, alembic, …). Detection is via `git status` (the effect), never a tool-name allowlist (the cause) — keeps the hook stack-independent.
- `git status --porcelain` lines are parsed with the same simplistic `line.slice(3).trim()` convention already used by `large-file-warning.mjs`'s fallback path — do not add quoted-path handling that doesn't already exist there. Deletions and renames (`D`/`R` in the first two status columns) are excluded, because the naive parser cannot correctly extract a path from a rename's `old -> new` arrow.
- Run `npm run typecheck && npm run lint` after every task, and the full `npm test` after the final task — fix any error found, in any file, per CLAUDE.md, before considering a task done.

---

## File Structure

| File | Responsibility |
| --- | --- |
| `templates/hooks/sql-idempotent-review.mjs` | The dual-mode hook itself (only file with behavior changes) |
| `tests/hook-sql-idempotent-review.test.mjs` | Existing 22 `PostToolUse` tests (untouched) + new `Stop`-mode tests |
| `lib/generate/settings.mjs` | Adds the one new `Stop` wiring line |
| `tests/settings-strict.test.mjs` | Adds one wiring-regression test |

No new files. No catalog changes — `sql-idempotent-review.mjs` is already registered in `lib/data/project-catalog.mjs` `PROJECT_HOOK_FILES` and already copied generically by `lib/plan/hook-artifacts.mjs`; both were verified during design and need no edits.

---

### Task 1: Refactor to dual-mode shape, zero behavior change

**Files:**
- Modify: `templates/hooks/sql-idempotent-review.mjs` (full rewrite, same directory/filename)

**Interfaces:**
- Produces: `buildIdempotencyRules(): string` — shared rules text (verbatim from the current `additionalContext` array, minus the `PostToolUse`-specific header lines).
- Produces: `markNotified(absPath: string): void` — best-effort append of `` `${sessionId}\t${absPath}\n` `` to `NOTIFIED_FLAG`.
- Produces: `postToolUse(): void` — identical observable behavior to today's top-level script.
- Produces module-level constants: `projectDir` (`process.env.CLAUDE_PROJECT_DIR ?? process.cwd()`), `projHash` (sha1 of `projectDir`, sliced 12), `NOTIFIED_FLAG` (`path.join(os.tmpdir(), \`aia-harness-sql-notified-${projHash}\`)`).
- Consumes: nothing from other tasks (this is the first task).

- [ ] **Step 1: Rewrite the hook file (safe refactor — extract functions, preserve output, add bookkeeping)**

Replace the full contents of `templates/hooks/sql-idempotent-review.mjs` with:

```js
#!/usr/bin/env node
/**
 * Dual-mode hook (branches on hook_event_name):
 *
 *   • PostToolUse (ADVISORY) — whenever a .sql file is created or edited via
 *     Claude's own Edit/Write/MultiEdit, inject additionalContext asking
 *     Claude to review the file and make every statement idempotent — safe
 *     to run multiple times in production without errors.
 *
 *   • Stop (BLOCK, catch-all) — sweeps `git status` once at the end of the
 *     turn for .sql files changed this session but never surfaced above
 *     (e.g. written by a migration generator run via Bash — drizzle-kit,
 *     Hibernate DDL export, Prisma, Liquibase, Alembic, …). Blocks so the
 *     agent reviews them before finishing, deduped against the PostToolUse
 *     path via a shared per-session notified-flag so an agent-edited file
 *     is never nagged twice.
 *
 * Output channel: hookSpecificOutput.additionalContext + exit 0 for the
 * PostToolUse path (the supported context-injection channel — same as
 * large-file-warning advisory). {decision:"block"} + exit 0 for the Stop
 * path (Stop has no additionalContext channel; block is the only way to
 * surface anything to the agent).
 *
 * Shipped by aia-harness to every target project (stack-independent).
 * FAIL-OPEN — only ever exits 0.
 */
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { createHash } from "node:crypto";

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

const projectDir = process.env.CLAUDE_PROJECT_DIR ?? process.cwd();
const projHash = createHash("sha1").update(projectDir).digest("hex").slice(0, 12);
const NOTIFIED_FLAG = path.join(os.tmpdir(), `aia-harness-sql-notified-${projHash}`);

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

/** Shared idempotency guidance, reused by both modes. @returns {string} */
function buildIdempotencyRules() {
  return [
    `MIGRATION SAFETY (check this first):`,
    `  • If this is an ALREADY-COMMITTED / previously-applied migration, do NOT`,
    `    edit it. Changing an applied migration's content changes its hash and`,
    `    breaks hash-based tracking (Drizzle __drizzle_migrations, Flyway,`,
    `    Liquibase) → "previously applied migration has been edited" on the next`,
    `    deploy. Only make NEW / uncommitted migration files idempotent.`,
    ``,
    `DDL:`,
    `  • CREATE TABLE/INDEX/SEQUENCE/SCHEMA/DATABASE → add IF NOT EXISTS`,
    `  • DROP TABLE/INDEX/SEQUENCE/TYPE/CONSTRAINT   → add IF EXISTS`,
    `  • CREATE VIEW/FUNCTION/PROCEDURE/TRIGGER      → use CREATE OR REPLACE`,
    `  • ALTER TABLE … ADD COLUMN                    → ADD COLUMN IF NOT EXISTS, or`,
    `      guard with IF NOT EXISTS (SELECT 1 FROM information_schema.columns`,
    `      WHERE table_name='t' AND column_name='c')`,
    `  • CREATE TYPE … AS ENUM → PostgreSQL has NO "IF NOT EXISTS" for CREATE TYPE;`,
    `      do NOT add it (invalid SQL). Wrap instead:`,
    `        DO $$ BEGIN`,
    `          CREATE TYPE "x" AS ENUM (…);`,
    `        EXCEPTION WHEN duplicate_object THEN NULL;`,
    `        END $$;`,
    `  • ALTER TYPE … ADD VALUE → ADD VALUE IF NOT EXISTS (PostgreSQL enums)`,
    ``,
    `DML:`,
    `  • INSERT seed/reference data → INSERT OR IGNORE / ON CONFLICT DO NOTHING /`,
    `      MERGE, or wrap in WHERE NOT EXISTS (dialect equivalent)`,
    `  • UPDATE/DELETE that may already be applied → add WHERE guards so re-running`,
    `      produces no error and changes only the still-unapplied rows`,
    ``,
    `General:`,
    `  • Transactions: do NOT add BEGIN/COMMIT to migration files — the migration`,
    `      tool (Drizzle/Flyway/Liquibase/Alembic/…) already wraps each migration in`,
    `      one, and an explicit COMMIT ends it early (breaks rollback). Some DDL also`,
    `      cannot run inside a transaction at all (PostgreSQL CREATE INDEX`,
    `      CONCURRENTLY, ALTER TYPE … ADD VALUE). Only wrap standalone scripts that`,
    `      are run directly (e.g. psql -f), never migrations.`,
    `  • Some statements have NO idempotent form (e.g. ALTER COLUMN … SET DATA TYPE`,
    `      in PostgreSQL — no IF EXISTS equivalent). Flag those for manual review;`,
    `      do NOT fake a guard that changes their meaning.`,
    `  • Do NOT change business logic — only add safety guards`,
    `  • Preserve the original SQL dialect (PostgreSQL, MySQL, SQLite, MSSQL, Oracle)`,
  ].join("\n");
}

/**
 * ADVISORY (PostToolUse): unchanged output from the pre-refactor version.
 * Fires on every .sql Edit/Write/MultiEdit, no dedup. Also records the file
 * in the shared notified-flag so Stop-mode never double-blocks on it.
 */
function postToolUse() {
  const ti = event?.tool_input ?? {};
  const file = ti.file_path || ti.path;
  if (!file || typeof file !== "string") return;
  if (path.extname(file).toLowerCase() !== ".sql") return;

  const additionalContext = [
    `SQL file edited: ${file}`,
    `Review it and make EVERY statement idempotent so the file can be executed`,
    `multiple times in production without errors. Apply these rules:`,
    ``,
    buildIdempotencyRules(),
  ].join("\n");

  process.stdout.write(
    JSON.stringify({ hookSpecificOutput: { hookEventName: "PostToolUse", additionalContext } }),
  );

  const abs = path.isAbsolute(file) ? file : path.join(projectDir, file);
  markNotified(abs);
}

postToolUse();
process.exit(0);
```

- [ ] **Step 2: Run the existing test suite to confirm zero regression**

Run: `node --test tests/hook-sql-idempotent-review.test.mjs`
Expected: `# pass 22`, `# fail 0` — every existing test still passes unmodified (the refactor is behavior-preserving; `markNotified`'s tmpdir write is a silent side effect no existing test observes).

- [ ] **Step 3: Typecheck and lint**

Run: `npm run typecheck && npm run lint`
Expected: both exit 0, no errors.

- [ ] **Step 4: Commit**

```bash
git add templates/hooks/sql-idempotent-review.mjs
git commit -m "refactor(hooks): extract sql-idempotent-review into functions, prep for dual-mode

Behavior-preserving: postToolUse() output is byte-identical to the prior
top-level script. Adds module-level projectDir/notified-flag scaffolding
that Stop-mode (next commit) will read."
```

---

### Task 2: Add Stop-mode blocking (TDD)

**Files:**
- Modify: `templates/hooks/sql-idempotent-review.mjs`
- Modify: `tests/hook-sql-idempotent-review.test.mjs`

**Interfaces:**
- Consumes from Task 1: `buildIdempotencyRules()`, `markNotified(absPath)`, `projectDir`, `NOTIFIED_FLAG`, module-level `event`.
- Produces: `readNotifiedSet(): Set<string>` — reads `NOTIFIED_FLAG`, returns the set of `` `${sessionId}\t${absPath}` `` keys already notified (CRLF-tolerant split), empty set on any read error.
- Produces: `blockOnStop(): void` — the new Stop-mode sweep.
- Produces (bottom of file): dispatch branches on `event.hook_event_name !== "Stop"` (NOT `=== "PostToolUse"` — the 22 pre-existing tests never set `hook_event_name` at all, so `undefined` must keep routing to `postToolUse()` exactly as it always implicitly did before any dispatch existed; only an explicit `"Stop"` should route to `blockOnStop()`).

- [ ] **Step 1: Write the failing Stop-mode tests**

In `tests/hook-sql-idempotent-review.test.mjs`, replace the import block at the top of the file:

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { runHook, runHookRaw } from "./hook-runner.mjs";
import { validatePostToolUseOutput } from "../lib/validate/hook-schema.mjs";
```

with:

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execSync } from "node:child_process";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { runHook, runHookRaw, mkGitRepo } from "./hook-runner.mjs";
import { validatePostToolUseOutput, validateStopOutput } from "../lib/validate/hook-schema.mjs";
```

Then append this block to the **end** of the file (after the last existing test):

```js
// ===========================================================================
// Stop mode — catch-all sweep for externally-generated .sql files
// ===========================================================================

const flagHash = (/** @type {string} */ d) => createHash("sha1").update(d).digest("hex").slice(0, 12);

/** Path of the shared sql-notified de-dup flag for a project dir. */
const notifiedFlag = (/** @type {string} */ projectDir) =>
  path.join(os.tmpdir(), `aia-harness-sql-notified-${flagHash(projectDir)}`);

/** @param {import("./hook-runner.mjs").HookResult} result */
function assertSilentStop({ stdout, exitCode }) {
  const v = validateStopOutput(stdout, exitCode);
  assert.equal(v.valid, true, `Schema invalid: ${v.errors.join("; ")}`);
  assert.equal(exitCode, 0);
  assert.equal(stdout.trim(), "", "expected empty stdout (silent)");
}

/**
 * @param {import("./hook-runner.mjs").HookResult} result
 * @returns {any}
 */
function assertBlockStop({ stdout, exitCode }) {
  const v = validateStopOutput(stdout, exitCode);
  assert.equal(v.valid, true, `Schema invalid: ${v.errors.join("; ")}`);
  assert.equal(exitCode, 0);
  const parsed = JSON.parse(stdout);
  assert.equal(parsed.decision, "block", "expected decision:block");
  assert.ok(
    typeof parsed.reason === "string" && parsed.reason.length > 0,
    "expected non-empty reason",
  );
  return parsed;
}

/**
 * Write a file at `relPath` under `dir`, creating parent dirs as needed.
 * @param {string} dir
 * @param {string} relPath
 * @param {string} [content]
 * @returns {string} absolute path written
 */
function writeSqlFile(dir, relPath, content = "-- sql\n") {
  const abs = path.join(dir, relPath);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, content);
  return abs;
}

test("stop: non-git dir → silent, schema-valid", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "aia-sql-stop-"));
  try {
    assertSilentStop(runHook(HOOK, { hook_event_name: "Stop" }, { env: { CLAUDE_PROJECT_DIR: dir } }));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("stop: empty stdin → silent, schema-valid", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "aia-sql-stop-"));
  try {
    assertSilentStop(runHookRaw(HOOK, "", { env: { CLAUDE_PROJECT_DIR: dir } }));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("stop: git repo with no changes → silent", () => {
  const dir = mkGitRepo("main");
  try {
    assertSilentStop(runHook(HOOK, { hook_event_name: "Stop" }, { env: { CLAUDE_PROJECT_DIR: dir } }));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

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

test("stop: tracked .sql file modified → blocks", () => {
  const dir = mkGitRepo("main");
  const abs = writeSqlFile(dir, "migrations/001.sql", "CREATE TABLE a (id int);\n");
  execSync("git add migrations/001.sql", { cwd: dir, stdio: "pipe" });
  execSync('git commit -m "add migration"', { cwd: dir, stdio: "pipe" });
  fs.appendFileSync(abs, "ALTER TABLE a ADD COLUMN name text;\n");
  try {
    const parsed = assertBlockStop(
      runHook(HOOK, { hook_event_name: "Stop" }, { env: { CLAUDE_PROJECT_DIR: dir } }),
    );
    assert.match(parsed.reason, /001\.sql/);
  } finally {
    fs.rmSync(notifiedFlag(dir), { force: true });
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("stop: deleted .sql file → silent (excluded)", () => {
  const dir = mkGitRepo("main");
  const abs = writeSqlFile(dir, "old.sql", "SELECT 1;\n");
  execSync("git add old.sql", { cwd: dir, stdio: "pipe" });
  execSync('git commit -m "add old.sql"', { cwd: dir, stdio: "pipe" });
  fs.rmSync(abs);
  try {
    assertSilentStop(runHook(HOOK, { hook_event_name: "Stop" }, { env: { CLAUDE_PROJECT_DIR: dir } }));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("stop: file renamed to .sql → silent (rename arrow not parsed, excluded on purpose)", () => {
  const dir = mkGitRepo("main");
  const abs = writeSqlFile(dir, "staging.txt", "CREATE TABLE t (id int);\n");
  execSync("git add staging.txt", { cwd: dir, stdio: "pipe" });
  execSync('git commit -m "add staging.txt"', { cwd: dir, stdio: "pipe" });
  fs.renameSync(abs, path.join(dir, "schema.sql"));
  execSync("git add -A", { cwd: dir, stdio: "pipe" });
  try {
    assertSilentStop(runHook(HOOK, { hook_event_name: "Stop" }, { env: { CLAUDE_PROJECT_DIR: dir } }));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("stop: non-.sql file changed → silent", () => {
  const dir = mkGitRepo("main");
  writeSqlFile(dir, "notes.md", "# notes\n");
  try {
    assertSilentStop(runHook(HOOK, { hook_event_name: "Stop" }, { env: { CLAUDE_PROJECT_DIR: dir } }));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("stop: stop_hook_active true with pending .sql → silent (anti-loop)", () => {
  const dir = mkGitRepo("main");
  writeSqlFile(dir, "schema.sql", "CREATE TABLE t (id int);\n");
  try {
    assertSilentStop(
      runHook(
        HOOK,
        { hook_event_name: "Stop", stop_hook_active: true },
        { env: { CLAUDE_PROJECT_DIR: dir } },
      ),
    );
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("stop: multiple new .sql files → blocks, reason lists all of them", () => {
  const dir = mkGitRepo("main");
  writeSqlFile(dir, "one.sql", "CREATE TABLE a (id int);\n");
  writeSqlFile(dir, "two.sql", "CREATE TABLE b (id int);\n");
  try {
    const parsed = assertBlockStop(
      runHook(HOOK, { hook_event_name: "Stop" }, { env: { CLAUDE_PROJECT_DIR: dir } }),
    );
    assert.match(parsed.reason, /one\.sql/);
    assert.match(parsed.reason, /two\.sql/);
  } finally {
    fs.rmSync(notifiedFlag(dir), { force: true });
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("stop: file already marked notified (prior postToolUse call) → silent, no double-block", () => {
  const dir = mkGitRepo("main");
  const abs = writeSqlFile(dir, "schema.sql", "CREATE TABLE t (id int);\n");
  fs.writeFileSync(notifiedFlag(dir), `nosession\t${abs}\n`);
  try {
    assertSilentStop(runHook(HOOK, { hook_event_name: "Stop" }, { env: { CLAUDE_PROJECT_DIR: dir } }));
  } finally {
    fs.rmSync(notifiedFlag(dir), { force: true });
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

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

test("stop: second Stop call after first already blocked → silent (flag persists)", () => {
  const dir = mkGitRepo("main");
  writeSqlFile(dir, "schema.sql", "CREATE TABLE t (id int);\n");
  try {
    assertBlockStop(
      runHook(HOOK, { hook_event_name: "Stop", session_id: "s1" }, { env: { CLAUDE_PROJECT_DIR: dir } }),
    );
    assertSilentStop(
      runHook(HOOK, { hook_event_name: "Stop", session_id: "s1" }, { env: { CLAUDE_PROJECT_DIR: dir } }),
    );
  } finally {
    fs.rmSync(notifiedFlag(dir), { force: true });
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("stop: CRLF line endings in notified-flag still dedup correctly", () => {
  const dir = mkGitRepo("main");
  const abs = writeSqlFile(dir, "schema.sql", "CREATE TABLE t (id int);\n");
  fs.writeFileSync(notifiedFlag(dir), `nosession\t${abs}\r\n`);
  try {
    assertSilentStop(runHook(HOOK, { hook_event_name: "Stop" }, { env: { CLAUDE_PROJECT_DIR: dir } }));
  } finally {
    fs.rmSync(notifiedFlag(dir), { force: true });
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

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
      runHook(HOOK, { hook_event_name: "Stop", session_id: "s1" }, { env: { CLAUDE_PROJECT_DIR: dir } }),
    );
  } finally {
    fs.rmSync(notifiedFlag(dir), { force: true });
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
```

This reuses `reviewContext()`, already defined earlier in the same file by the existing 22 tests — do not redefine it.

- [ ] **Step 2: Run tests, confirm the new ones fail**

Run: `node --test tests/hook-sql-idempotent-review.test.mjs`
Expected: the 22 pre-existing tests still `PASS`; the 15 new `stop:`/`cross-mode:` tests `FAIL` (no `Stop` branch exists yet — `blockOnStop`/`readNotifiedSet` are undefined and the file always runs `postToolUse()` regardless of `hook_event_name`, so every new test's `assertSilentStop`/`assertBlockStop` sees the wrong output shape).

- [ ] **Step 3: Implement `blockOnStop()` and the dispatch branch**

In `templates/hooks/sql-idempotent-review.mjs`, change the import block from:

```js
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { createHash } from "node:crypto";
```

to:

```js
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
```

Add these two functions immediately after `postToolUse()` (before the final `postToolUse(); process.exit(0);` lines):

```js
/** @returns {Set<string>} keys already notified this session, "sessionId\tabsPath" */
function readNotifiedSet() {
  try {
    const raw = fs.readFileSync(NOTIFIED_FLAG, "utf8");
    return new Set(raw.split(/\r?\n/).filter(Boolean));
  } catch {
    return new Set();
  }
}

/**
 * BLOCK (Stop): sweep `git status` for .sql files changed this session but
 * never surfaced via postToolUse(). Anti-loop via stop_hook_active.
 */
function blockOnStop() {
  if (event && event.stop_hook_active) return;

  let status;
  try {
    status = execFileSync("git", ["status", "--porcelain", "--untracked-files=all"], {
      cwd: projectDir,
      encoding: "utf8",
      windowsHide: true,
    });
  } catch {
    return;
  }

  const candidates = status
    .split(/\r?\n/)
    .filter(Boolean)
    .filter((line) => !/[DR]/.test(line.slice(0, 2)))
    .map((line) => path.join(projectDir, line.slice(3).trim()))
    .filter((abs) => path.extname(abs).toLowerCase() === ".sql");

  const sessionId = typeof event.session_id === "string" ? event.session_id : "nosession";
  const notified = readNotifiedSet();
  const fresh = [...new Set(candidates)].filter((abs) => !notified.has(`${sessionId}\t${abs}`));
  if (fresh.length === 0) return;

  for (const abs of fresh) markNotified(abs);

  const list = fresh.map((abs) => `  • ${path.relative(projectDir, abs)}`).join("\n");
  const reason = [
    `${fresh.length} SQL file(s) changed this session but were never reviewed for`,
    `idempotency (likely written by an external tool — migration generator, ORM,`,
    `build plugin — not a direct Claude edit):`,
    list,
    ``,
    `Review EACH file above and make every statement idempotent so it can run`,
    `multiple times in production without errors. Apply these rules:`,
    ``,
    buildIdempotencyRules(),
  ].join("\n");

  process.stdout.write(JSON.stringify({ decision: "block", reason }));
}
```

Replace the final two lines of the file:

```js
postToolUse();
process.exit(0);
```

with:

```js
if (event.hook_event_name !== "Stop") {
  postToolUse();
} else {
  blockOnStop();
}
process.exit(0);
```

Use `!== "Stop"`, NOT `=== "PostToolUse"`. The 22 pre-existing tests in
`tests/hook-sql-idempotent-review.test.mjs` construct events like
`{ tool_input: { file_path: "src/app.ts" } }` with no `hook_event_name`
field at all (they predate this dispatch). `undefined !== "Stop"` is `true`,
so they keep routing to `postToolUse()` — matching their original,
pre-dual-mode behavior. Real Claude Code invocations always set
`hook_event_name` to a concrete value, so this only changes behavior for
the malformed/legacy-fixture case, never in production.

- [ ] **Step 4: Run tests, confirm everything passes**

Run: `node --test tests/hook-sql-idempotent-review.test.mjs`
Expected: `# pass 37`, `# fail 0` (22 original + 15 new).

- [ ] **Step 5: Typecheck and lint**

Run: `npm run typecheck && npm run lint`
Expected: both exit 0, no errors.

- [ ] **Step 6: Commit**

```bash
git add templates/hooks/sql-idempotent-review.mjs tests/hook-sql-idempotent-review.test.mjs
git commit -m "feat(hooks): sql-idempotent-review blocks at Stop on externally-generated SQL

New Stop-mode branch sweeps git status once at end of turn and blocks on
any .sql file changed this session but never surfaced via the existing
PostToolUse advisory (e.g. drizzle-kit/Hibernate/Prisma/Liquibase output
written via Bash, not a direct Claude edit). Deduped against PostToolUse
via a shared per-session notified-flag so an agent-edited file is never
double-blocked. Mirrors large-file-warning.mjs's dual-mode pattern."
```

---

### Task 3: Wire the Stop hook in settings generation

**Files:**
- Modify: `lib/generate/settings.mjs`
- Modify: `tests/settings-strict.test.mjs`

**Interfaces:**
- Consumes: `hookCmd(script)` (already defined in `lib/generate/settings.mjs`), `stopCommands(s)` / `postCommands(s)` test helpers (already defined in `tests/settings-strict.test.mjs` at lines 93–100).
- No new interfaces produced (leaf task).

- [ ] **Step 1: Add the Stop wiring**

In `lib/generate/settings.mjs`, inside `renderSettings()`, change:

```js
    Stop: [
      {
        hooks: [
          { type: "command", ...hookCmd("verify-on-stop.mjs"), timeout: 300 },
          { type: "command", ...hookCmd("memory-stop.mjs"), timeout: 30 },
        ],
      },
    ],
```

to:

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
```

The existing `PostToolUse[0].hooks` entry for `sql-idempotent-review.mjs` (matcher `Edit|Write|MultiEdit`) is untouched — do not modify it.

- [ ] **Step 2: Write the wiring-regression test**

Append to `tests/settings-strict.test.mjs` (after the last existing test in the file):

```js
test("sql-idempotent-review is wired under both Stop and PostToolUse (additive, not a mode choice)", () => {
  const s = JSON.parse(renderSettings(profile(), {}, {}));
  assert.ok(
    stopCommands(s).some((/** @type {any} */ c) => /sql-idempotent-review\.mjs/.test(c)),
    "expected sql-idempotent-review wired under Stop",
  );
  assert.ok(
    postCommands(s).some((/** @type {any} */ c) => /sql-idempotent-review\.mjs/.test(c)),
    "expected sql-idempotent-review still wired under PostToolUse",
  );
});
```

- [ ] **Step 3: Run the settings test file**

Run: `node --test tests/settings-strict.test.mjs`
Expected: all tests pass, including the new one.

- [ ] **Step 4: Run the full verification suite**

Run: `npm test`
Expected: typecheck, lint, and all unit tests (including both files touched by Tasks 1–3) pass with zero errors.

- [ ] **Step 5: Commit**

```bash
git add lib/generate/settings.mjs tests/settings-strict.test.mjs
git commit -m "feat(settings): wire sql-idempotent-review under Stop as well as PostToolUse

Additive wiring (not a --large-files-style mode flag) — both entries
active simultaneously so agent-edited SQL keeps the existing advisory
while externally-generated SQL now gets the new Stop-time block."
```

---

## Done Criteria

- [ ] All 3 tasks committed.
- [ ] `npm test` green (typecheck + lint + unit).
- [ ] `templates/hooks/sql-idempotent-review.mjs` is dual-mode: `postToolUse()` output byte-identical to before, `blockOnStop()` new.
- [ ] `tests/hook-sql-idempotent-review.test.mjs` has 37 passing tests (22 original + 15 new).
- [ ] `tests/settings-strict.test.mjs` proves `sql-idempotent-review.mjs` is wired under both `PostToolUse` and `Stop`.
- [ ] No changes needed (and none made) to `lib/data/project-catalog.mjs`, `lib/plan/hook-artifacts.mjs`, or `.claude/settings.json` — verified during design as already correct/not-applicable.
