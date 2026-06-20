---
description: Next.js coding standards and anti-patterns
paths:
  - "**/*.ts"
  - "**/*.tsx"
---

# Next.js — Coding Standards

**Fontes:** Vercel/Next.js official docs · nextjs.org

## Anti-padrões

| Proibido | Alternativa |
|----------|-------------|
| `"use client"` desnecessário no topo | Server Components por padrão; client apenas para interatividade |
| `<img>` HTML nativo | `next/image` para otimização automática |
| Fontes sem `next/font` | `next/font` elimina layout shift e auto-otimiza |
| `fetch` sem política de cache | Definir `cache: 'force-cache'`, `'no-store'` ou `revalidate` explicitamente |
| `useSearchParams` fora de `<Suspense>` | Envolver em `<Suspense fallback={...}>` |
| Dados buscados em Client Component que poderiam ser Server | Mover fetch para Server Component e passar como prop |
| Route Handler retornando dados que uma Server Action faria | Server Actions para mutações; Route Handlers para APIs externas |
| `getServerSideProps` (Pages Router) em código novo | App Router com Server Components |
| `cookies()`/`headers()` em componente de layout raiz | Dynamic functions apenas onde necessário |

## Convenções

- `app/` router (App Router) em projetos novos — não Pages Router
- Layout: `layout.tsx` compartilhado · `page.tsx` por rota · `loading.tsx` e `error.tsx` por segmento
- Metadata: `export const metadata` ou `generateMetadata()` em cada `page.tsx`
- Imagens: sempre definir `width` e `height` no `<Image>` ou usar `fill` com container posicionado
- Variáveis de ambiente: `NEXT_PUBLIC_` apenas para o que deve ir ao client; demais ficam server-only
- Middleware em `middleware.ts` na raiz — não em `app/`

## Tooling

- `next lint` (ESLint config embutida) na pipeline
- `@next/bundle-analyzer` para inspecionar bundle
- Vercel Speed Insights + Web Analytics para métricas de produção
