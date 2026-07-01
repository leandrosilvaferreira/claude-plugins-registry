---
description: Drizzle ORM schema, query, transaction, and migration conventions for NestJS
paths:
  - "src/database/**"
  - "drizzle/**"
---

# Database — Drizzle ORM

**Applies to**: `src/database/` and any DB access across the codebase

## Injection

Inject via the `DRIZZLE` symbol token:

```ts
constructor(@Inject(DRIZZLE) private readonly db: DrizzleDB) {}
```

Both `DRIZZLE` and `DrizzleDB` are exported from `database.module.ts`. Pool created once in `useFactory`, reused for the app lifetime. Never call `drizzle()` or `new Pool()` per request.

## Schema conventions

- One file per table: `src/database/schema/<table>.ts`.
- All tables re-exported from `src/database/schema/index.ts` (the barrel `drizzle()` and `drizzle.config.ts` consume). A table not exported from the barrel is invisible to the app and drizzle-kit.
- Primary key: `uuid('id').primaryKey().defaultRandom()`
- Strings: `varchar(name, { length })` with explicit length. Add `.notNull()` / `.unique()` as needed.
- Timestamps: `timestamp(col, { withTimezone: true })`. `createdAt .defaultNow()`, `updatedAt .defaultNow().$onUpdate(() => new Date())`.
- Naming: snake_case DB columns ↔ camelCase TypeScript fields.
- Export row types: `export type X = typeof table.$inferSelect` and `export type NewX = typeof table.$inferInsert`. Services consume these — never write interface duplicates by hand.

## Queries

Use the query builder + `drizzle-orm` operators (`eq`, `and`, `like`, `gt`, `lt`). **Flag raw string interpolation — SQL injection risk.**

- Reads: relational API `db.query.<table>.findFirst/findMany({ where })` or builder `db.select().from(...)`
- Writes: `db.insert(table).values(data).returning()` then destructure the returned row.
- Multi-write atomicity: `db.transaction(async (tx) => { ... })` using `tx`, not `db`.

## Migrations

- drizzle-kit only — never write migration SQL by hand. Use the `nestjs-db-migration` skill for the guarded flow.
- `db:generate` → review generated SQL → `db:migrate`.
- Never use `db:push` against production.
- Run `typecheck` after applying migrations — schema type changes propagate app-wide.
