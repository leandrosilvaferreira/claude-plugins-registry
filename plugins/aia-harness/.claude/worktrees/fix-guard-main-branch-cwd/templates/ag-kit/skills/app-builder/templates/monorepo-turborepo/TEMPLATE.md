---
name: monorepo-turborepo
description: Turborepo monorepo template principles. pnpm workspaces, shared packages.
---
<!-- Vendored from ag-kit (github.com/vudovn/ag-kit) @ 20a13da6d4414c7c6ae33db050a9c606eaef9f40 :: .agents/skills/app-builder/templates/monorepo-turborepo/TEMPLATE.md. MIT (c) vudovn. -->

# Turborepo Monorepo Template

> Versions reflect the latest stable line verified 2026-05. Pin to the current stable when scaffolding.

## Tech Stack

| Component | Technology |
|-----------|------------|
| Build System | Turborepo 2.x |
| Package Manager | pnpm |
| Apps | Next.js, Express |
| Packages | Shared UI, Config, Types, Utils |
| Language | TypeScript |

---

## Directory Structure

```
project-name/
├── apps/
│   ├── web/             # Next.js app
│   ├── api/             # Express API
│   └── docs/            # Documentation
├── packages/
│   ├── ui/              # Shared components (@repo/ui)
│   ├── config/          # ESLint, TS, Tailwind presets (@repo/config)
│   ├── types/           # Shared types (@repo/types)
│   └── utils/           # Shared utilities (@repo/utils)
├── turbo.json           # "tasks" key (renamed from "pipeline" in v2)
├── pnpm-workspace.yaml
└── package.json         # requires "packageManager" field
```

---

## Key Concepts

| Concept | Description |
|---------|-------------|
| Workspaces | Globs declared in `pnpm-workspace.yaml` |
| Pipeline | `turbo.json` `tasks` graph (NOT `pipeline` — renamed in v2) |
| Caching | Remote/local task caching |
| Dependencies | `workspace:*` protocol, `@repo/*` namespace |
| Env mode | v2 is strict — declare task `env`/`globalEnv` or caching breaks |

---

## Turbo Tasks (turbo.json)

> `tasks` is the v2 key. The `pipeline` key was renamed — migrate with `npx @turbo/codemod rename-pipeline`.

| Task | Depends On |
|------|------------|
| build | ^build (dependencies first) |
| dev | cache: false, persistent |
| lint | ^build |
| test | ^build |

---

## Setup Steps

1. Create root directory
2. `pnpm init`
3. Create pnpm-workspace.yaml
4. Create turbo.json
5. Add apps and packages
6. `pnpm install`
7. `pnpm dev`

---

## Common Commands

| Command | Description |
|---------|-------------|
| `pnpm dev` | Run all apps |
| `pnpm build` | Build all |
| `pnpm --filter @name/web dev` | Run specific app |
| `pnpm --filter @name/web add axios` | Add dep to app |

---

## Best Practices

- Split `apps/` (deployable) from `packages/` (libraries, shared config)
- Namespace internal packages with `@repo/*`; reference via `workspace:*`
- Define entrypoints with the `exports` field (better tree-shaking than barrel files)
- Share tsconfig/eslint from `packages/config`
- Declare task `env`/`globalEnv` explicitly (v2 strict env mode)
- Use Turbo remote caching for CI
