---
description: Vue/Nuxt coding standards and anti-patterns
paths:
  - "**/*.vue"
  - "**/*.ts"
---

# Vue / Nuxt — Coding Standards

**Fonte:** JetBrains/junie-guidelines (vue/nuxt) · Vue 3 official docs

## Anti-padrões

| Proibido | Alternativa |
|----------|-------------|
| Options API em código novo | Composition API com `<script setup>` |
| `$emit` sem definição tipada | `defineEmits<{ 'event': [payload: Type] }>()` |
| Props sem tipos | `defineProps<{ nome: string; ativo: boolean }>()` |
| Mutação direta de prop | Emit evento de mudança para o pai |
| `v-if` + `v-for` no mesmo elemento | `v-if` no elemento pai ou computed para filtrar |
| `ref` para objetos complexos reativos | `reactive()` para objetos; `ref()` para primitivos e quando precisa de `.value` explícito |
| Lógica de negócio no componente | Composable `use<Nome>.ts` |
| `any` em `defineProps` / `defineEmits` | Tipos explícitos TypeScript |
| `watch` para efeitos síncronos derivados | `computed` |

## Convenções (Nuxt)

- `pages/` para rotas; `components/` para reutilizáveis; `composables/` para lógica compartilhada
- Auto-import: Nuxt importa automaticamente de `composables/` e `components/` — não precisam de import manual
- `useFetch` / `useAsyncData` para data fetching em SSR — não `fetch` manual em `onMounted`
- `useState` do Nuxt para estado compartilhado entre server e client
- Server routes em `server/api/` — não misturar com lógica de componente
- `app.config.ts` para configuração pública; `runtimeConfig` para segredos

## Tooling

- Volar (Vue Language Features) no editor
- `vue-tsc` para typecheck de `.vue`
- ESLint + `eslint-plugin-vue` com config `vue3-recommended`
