<!-- Vendored from ag-kit (github.com/vudovn/ag-kit) @ a909d03c808296b86cc124e09acf5f1c7efa4e49 :: .agents/skills/database-design/migrations.md. MIT (c) vudovn. -->

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
