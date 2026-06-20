---
description: TypeScript coding standards and anti-patterns
paths:
  - "**/*.ts"
  - "**/*.tsx"
---

# TypeScript — Coding Standards

**Fontes:** Google TypeScript Style Guide · google/gts · antigravity.codes

## Anti-padrões

| Proibido | Alternativa |
|----------|-------------|
| `any` | Tipos explícitos, `unknown` com narrowing, generics |
| `Record<string, any>` | Interfaces específicas do domínio |
| Type assertion `as Foo` sem narrowing | Type guard `isFoo(x)` ou narrowing com `instanceof`/`in` |
| `// @ts-ignore` | `// @ts-expect-error` com comentário obrigatório |
| `==` para comparação | `===` sempre |
| `!` non-null assertion sem justificativa | Verificação explícita ou `?.` |
| Arquivo > 350 LOC | Dividir em módulos menores por responsabilidade |
| Magic strings repetidos | Constantes ou `as const` enum objects |
| `namespace` | Módulos ES (`import`/`export`) |
| `enum` numérico | `const` object com `as const` ou string union |

## Convenções

- `strict: true` no `tsconfig.json` — nunca desativar
- Path alias `@/*` para todos os imports internos
- `type` para unions/intersections · `interface` para objetos extensíveis
- Tipos derivados: `ReturnType<typeof fn>`, `Parameters<typeof fn>`, `Awaited<T>`
- Zod para validação runtime em boundaries externos (input de usuário, APIs externas)
- Funções públicas: sempre tipar return type explicitamente
- Generics: nome descritivo quando não óbvio (`TEntity`, não `T` para múltiplos type params)

## Tooling

- `tsc --noEmit` na pipeline (sem build step = verificação pura)
- ESLint + `@typescript-eslint` com config strict
- Prettier ou Biome para formatação
