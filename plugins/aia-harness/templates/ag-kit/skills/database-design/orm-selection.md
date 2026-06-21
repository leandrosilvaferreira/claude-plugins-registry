<!-- Vendored from ag-kit (github.com/vudovn/ag-kit) @ 20a13da6d4414c7c6ae33db050a9c606eaef9f40 :: .agents/skills/database-design/orm-selection.md. MIT (c) vudovn. -->

# ORM Selection

> Choose ORM based on deployment and DX needs.

## Decision Tree

```
What's the context?
│
├── Edge deployment / Bundle size matters
│   └── Drizzle (smallest, SQL-like)
│
├── Best DX / Schema-first
│   └── Prisma (migrations, studio)
│
├── Maximum control
│   └── Raw SQL with query builder
│
└── Python ecosystem
    └── SQLAlchemy 2.0 (async support)
```

## Comparison

| ORM | Best For | Trade-offs |
|-----|----------|------------|
| **Drizzle** | Edge, TypeScript | Newer, less examples |
| **Prisma** | DX, schema management | Heavier, not edge-ready |
| **Kysely** | Type-safe SQL builder | Manual migrations |
| **Raw SQL** | Complex queries, control | Manual type safety |
