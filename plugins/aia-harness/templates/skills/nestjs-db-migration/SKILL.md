---
name: nestjs-db-migration
description: Guards the Drizzle-kit generate → review → migrate flow for NestJS + Drizzle ORM projects. Use when changing the database schema or applying a migration.
---

# NestJS DB Migration

Invoke when changing a Drizzle schema file or applying a Postgres migration.

Find the exact commands for this project in the root `CLAUDE.md` (typically `db:generate` and `db:migrate`).

## Steps

1. **Edit schema** — change the file under `src/database/schema/`. Export the new table from `schema/index.ts` (the barrel); a table not exported here is invisible to drizzle-kit and the app.

2. **Generate migration**:
   ```bash
   npm run db:generate
   ```
   Produces a new SQL file in `drizzle/`. Read CLAUDE.md for the exact command if the project uses workspace flags.

3. **Review the generated SQL — mandatory before applying**:
   - Flag `DROP TABLE` / `DROP COLUMN` — data loss, needs confirmation.
   - Flag `ALTER COLUMN ... NOT NULL` on a populated table without a default — fails on existing rows.
   - Flag type narrowing (e.g., `text` → `varchar(n)`) — may truncate existing data.
   - Present these findings to the user and wait for explicit approval before proceeding.

4. **Apply**:
   ```bash
   npm run db:migrate
   ```
   Requires `DATABASE_URL` set in `.env`. Read CLAUDE.md for the exact command.

5. **Typecheck after applying**:
   ```bash
   npm run typecheck
   ```
   Schema type changes propagate app-wide — verify no type errors were introduced.

## Rules

- `db:push` is for local dev iteration only — never use against production.
- Never write migration SQL by hand — always use drizzle-kit to generate it.
- Never commit a migration without reviewing its SQL first.
