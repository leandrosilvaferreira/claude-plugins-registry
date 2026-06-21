<!-- Vendored from ag-kit (github.com/vudovn/ag-kit) @ 20a13da6d4414c7c6ae33db050a9c606eaef9f40 :: .agents/skills/database-design/indexing.md. MIT (c) vudovn. -->

# Indexing Principles

> When and how to create indexes effectively.

## When to Create Indexes

```
Index these:
├── Columns in WHERE clauses
├── Columns in JOIN conditions
├── Columns in ORDER BY
├── Foreign key columns
└── Unique constraints

Don't over-index:
├── Write-heavy tables (slower inserts)
├── Low-cardinality columns
├── Columns rarely queried
```

## Index Type Selection

| Type | Use For |
|------|---------|
| **B-tree** | General purpose, equality & range |
| **Hash** | Equality only, faster |
| **GIN** | JSONB, arrays, full-text |
| **GiST** | Geometric, range types |
| **HNSW/IVFFlat** | Vector similarity (pgvector) |

## Composite Index Principles

```
Order matters for composite indexes:
├── Equality columns first
├── Range columns last
├── Most selective first
└── Match query pattern
```
