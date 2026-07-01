---
description: TypeScript coding standards and anti-patterns
paths:
  - "**/*.ts"
  - "**/*.tsx"
---

# TypeScript — Coding Standards

**Sources:** Google TypeScript Style Guide · google/gts · antigravity.codes

## Anti-patterns

| Forbidden | Alternative |
| --------- | ----------- |
| `any` | Explicit types, `unknown` with narrowing, generics |
| `Record<string, any>` | Domain-specific interfaces |
| Type assertion `as Foo` without narrowing | Type guard `isFoo(x)` or narrowing with `instanceof`/`in` |
| `// @ts-ignore` | `// @ts-expect-error` with mandatory comment |
| `==` for comparison | `===` always |
| `!` non-null assertion without justification | Explicit check or `?.` |
| File > 350 LOC | Split into smaller modules by responsibility |
| Repeated magic strings | Constants or `as const` enum objects |
| `namespace` | ES modules (`import`/`export`) |
| Numeric `enum` | `const` object with `as const` or string union |

## Conventions

- `strict: true` in `tsconfig.json` — never disable
- Path alias `@/*` for all internal imports
- `type` for unions/intersections · `interface` for extensible objects
- Derived types: `ReturnType<typeof fn>`, `Parameters<typeof fn>`, `Awaited<T>`
- Zod for runtime validation at external boundaries (user input, external APIs)
- Public functions: always type return type explicitly
- Generics: descriptive name when not obvious (`TEntity`, not `T` for multiple type params)

## Tooling

- `tsc --noEmit` in the pipeline (no build step = pure type check)
- ESLint + `@typescript-eslint` with strict config
- Prettier or Biome for formatting
