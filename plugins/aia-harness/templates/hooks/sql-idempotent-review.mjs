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
import { execFileSync } from "node:child_process";

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

if (event.hook_event_name !== "Stop") {
  postToolUse();
} else {
  blockOnStop();
}
process.exit(0);
