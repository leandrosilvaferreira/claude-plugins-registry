#!/usr/bin/env node
/**
 * PostToolUse hook: whenever a .sql file is created or edited, feed Claude an
 * instruction to review and make the file idempotent — safe to run multiple
 * times in production without errors.
 *
 * Shipped by aia-harness to every target project (stack-independent). FAIL-OPEN
 * on all infrastructure — only ever exits 0 (skipped) or 2 (review request):
 *   - non-SQL file, missing tool_input, invalid stdin  → exit 0 (silent)
 *   - SQL file just written / edited                   → exit 2 (stderr → Claude)
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

process.stderr.write(
  `SQL file edited: ${file}\n` +
    `Review it and make EVERY statement idempotent so the file can be executed\n` +
    `multiple times in production without errors. Apply these rules:\n` +
    `\n` +
    `DDL:\n` +
    `  • CREATE TABLE/INDEX/SEQUENCE/SCHEMA/TYPE/DATABASE → add IF NOT EXISTS\n` +
    `  • DROP TABLE/INDEX/SEQUENCE/SCHEMA/TYPE            → add IF EXISTS\n` +
    `  • CREATE VIEW/FUNCTION/PROCEDURE/TRIGGER            → use CREATE OR REPLACE\n` +
    `  • ALTER TABLE … ADD COLUMN                         → guard with\n` +
    `      IF NOT EXISTS (SELECT 1 FROM information_schema.columns\n` +
    `                     WHERE table_name='t' AND column_name='c')\n` +
    `    or dialect equivalent (e.g. DO $$ … $$ for PG, SP_EXECUTESQL for MSSQL)\n` +
    `\n` +
    `DML:\n` +
    `  • INSERT seed/reference data                       → use INSERT OR IGNORE /\n` +
    `      ON CONFLICT DO NOTHING / MERGE or wrap in WHERE NOT EXISTS\n` +
    `  • UPDATE/DELETE that may already be applied        → add WHERE guards so\n` +
    `      re-running produces no error and changes only unapplied rows\n` +
    `\n` +
    `General:\n` +
    `  • Wrap the entire file in a transaction (BEGIN/COMMIT) if not already done\n` +
    `  • Do NOT change business logic — only add safety guards\n` +
    `  • Preserve original SQL dialect (PostgreSQL, MySQL, SQLite, MSSQL, Oracle)\n`,
);
process.exit(2);
