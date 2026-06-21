<!-- Vendored from ag-kit (github.com/vudovn/ag-kit) @ 20a13da6d4414c7c6ae33db050a9c606eaef9f40 :: .agents/skills/database-design/migrations.md. MIT (c) vudovn. -->

# Migration Principles

> Safe migration strategy for zero-downtime changes.

## Safe Migration Strategy

```
For zero-downtime changes:
│
├── Adding column
│   └── Add as nullable → backfill → add NOT NULL
│
├── Removing column
│   └── Stop using → deploy → remove column
│
├── Adding index
│   └── CREATE INDEX CONCURRENTLY (non-blocking)
│
└── Renaming column
    └── Add new → migrate data → deploy → drop old
```

## Migration Philosophy

- Never make breaking changes in one step
- Test migrations on data copy first
- Have rollback plan
- Run in transaction when possible

## Serverless Databases

### Neon (Serverless PostgreSQL)

| Feature | Benefit |
|---------|---------|
| Scale to zero | Cost savings |
| Instant branching | Dev/preview |
| Full PostgreSQL | Compatibility |
| Autoscaling | Traffic handling |

### Turso (Edge SQLite)

| Feature | Benefit |
|---------|---------|
| Edge locations | Ultra-low latency |
| SQLite compatible | Simple |
| Generous free tier | Cost |
| Global distribution | Performance |
