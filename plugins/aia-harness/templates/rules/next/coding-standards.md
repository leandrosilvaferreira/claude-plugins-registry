---
description: Next.js coding standards and anti-patterns
paths:
  - "**/*.ts"
  - "**/*.tsx"
---

# Next.js — Coding Standards

**Sources:** Vercel/Next.js official docs · nextjs.org

## Anti-patterns

| Forbidden | Alternative |
|-----------|-------------|
| Unnecessary `"use client"` at the top | Server Components by default; client only for interactivity |
| Native HTML `<img>` | `next/image` for automatic optimization |
| Fonts without `next/font` | `next/font` eliminates layout shift and auto-optimizes |
| `fetch` without a cache policy | Explicitly define `cache: 'force-cache'`, `'no-store'` or `revalidate` |
| `useSearchParams` outside `<Suspense>` | Wrap in `<Suspense fallback={...}>` |
| Data fetched in a Client Component that could be a Server Component | Move fetch to a Server Component and pass as prop |
| Route Handler returning data that a Server Action would handle | Server Actions for mutations; Route Handlers for external APIs |
| `getServerSideProps` (Pages Router) in new code | App Router with Server Components |
| `cookies()`/`headers()` in the root layout component | Dynamic functions only where necessary |

## Conventions

- `app/` router (App Router) in new projects — not Pages Router
- Layout: shared `layout.tsx` · `page.tsx` per route · `loading.tsx` and `error.tsx` per segment
- Metadata: `export const metadata` or `generateMetadata()` in each `page.tsx`
- Images: always define `width` and `height` on `<Image>` or use `fill` with a positioned container
- Environment variables: `NEXT_PUBLIC_` only for what must reach the client; others remain server-only
- Middleware in `middleware.ts` at the root — not inside `app/`

## Tooling

- `next lint` (built-in ESLint config) in the pipeline
- `@next/bundle-analyzer` to inspect the bundle
- Vercel Speed Insights + Web Analytics for production metrics
