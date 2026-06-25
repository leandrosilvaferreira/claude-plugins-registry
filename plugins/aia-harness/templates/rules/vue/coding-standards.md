---
description: Vue/Nuxt coding standards and anti-patterns
paths:
  - "**/*.vue"
  - "**/*.ts"
---

# Vue / Nuxt — Coding Standards

**Source:** JetBrains/junie-guidelines (vue/nuxt) · Vue 3 official docs

## Anti-patterns

| Forbidden | Alternative |
|-----------|-------------|
| Options API in new code | Composition API with `<script setup>` |
| `$emit` without typed definition | `defineEmits<{ 'event': [payload: Type] }>()` |
| Props without types | `defineProps<{ name: string; active: boolean }>()` |
| Direct prop mutation | Emit a change event to the parent |
| `v-if` + `v-for` on the same element | `v-if` on the parent element or computed to filter |
| `ref` for complex reactive objects | `reactive()` for objects; `ref()` for primitives and when explicit `.value` is needed |
| Business logic in the component | Composable `use<Name>.ts` |
| `any` in `defineProps` / `defineEmits` | Explicit TypeScript types |
| `watch` for synchronous derived effects | `computed` |

## Conventions (Nuxt)

- `pages/` for routes; `components/` for reusables; `composables/` for shared logic
- Auto-import: Nuxt automatically imports from `composables/` and `components/` — no manual imports needed
- `useFetch` / `useAsyncData` for data fetching in SSR — not manual `fetch` in `onMounted`
- Nuxt's `useState` for state shared between server and client
- Server routes in `server/api/` — do not mix with component logic
- `app.config.ts` for public configuration; `runtimeConfig` for secrets

## Tooling

- Volar (Vue Language Features) in the editor
- `vue-tsc` for `.vue` typecheck
- ESLint + `eslint-plugin-vue` with `vue3-recommended` config
