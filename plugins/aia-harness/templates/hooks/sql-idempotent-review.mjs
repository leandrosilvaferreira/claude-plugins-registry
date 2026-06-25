#!/usr/bin/env node
/**
 * PostToolUse hook: whenever a .sql file is created or edited, inject
 * additionalContext asking Claude to review the file and make every statement
 * idempotent — safe to run multiple times in production without errors.
 *
 * Output channel: hookSpecificOutput.additionalContext + exit 0 — the supported
 * PostToolUse context-injection channel (same as large-file-warning advisory).
 * Earlier versions wrote to stderr + exit 2; for a non-blocking advisory that
 * abuses the blocking-error channel (the tool already ran). additionalContext is
 * the correct, non-error path Claude reliably considers.
 *
 * Shipped by aia-harness to every target project (stack-independent). FAIL-OPEN —
 * only ever exits 0:
 *   - non-SQL file, missing tool_input, invalid stdin → exit 0, no output
 *   - SQL file written / edited                       → exit 0 + additionalContext
 */
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

const ti = event?.tool_input ?? {};
const file = ti.file_path || ti.path;
if (!file || typeof file !== "string") process.exit(0);

if (path.extname(file).toLowerCase() !== ".sql") process.exit(0);

const additionalContext = [
  `SQL file edited: ${file}`,
  `Review it and make EVERY statement idempotent so the file can be executed`,
  `multiple times in production without errors. Apply these rules:`,
  ``,
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

process.stdout.write(
  JSON.stringify({ hookSpecificOutput: { hookEventName: "PostToolUse", additionalContext } }),
);
process.exit(0);
