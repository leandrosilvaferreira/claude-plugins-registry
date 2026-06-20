---
description: React coding standards and anti-patterns
paths:
  - "**/*.tsx"
  - "**/*.jsx"
---

# React — Coding Standards

**Fontes:** Airbnb React Style Guide · antigravity.codes · React official docs

## Anti-padrões

| Proibido | Alternativa |
|----------|-------------|
| Inline functions em JSX em componentes que re-renderizam muito | Extrair + `useCallback` quando há dependentes do referencial |
| `key={index}` em listas dinâmicas | IDs estáveis do dado |
| `useEffect` para lógica síncrona derivada de estado | Estado derivado calculado inline ou `useMemo` |
| Prop drilling > 2 níveis | Context, Zustand, ou Jotai |
| Estado duplicado (mesmo dado em dois `useState`) | Fonte única de verdade; derivar o restante |
| Mutação direta de estado | Sempre criar novo objeto/array |
| Componente > 250 LOC | Extrair sub-componentes ou custom hooks |
| `any` nos tipos de props | Interfaces explícitas |
| Lógica de negócio dentro do componente | Custom hook (`use<Nome>`) |
| `document.querySelector` em componente React | `useRef` |

## Convenções

- Componentes: `PascalCase` · Custom hooks: `useCamelCase`
- Props interface nomeada `<ComponentName>Props`
- `export default` apenas para componentes de página; demais: named exports
- Composição sobre herança — nunca `extends` em componentes
- `memo()` apenas quando profiling confirmar problema de re-render
- Acessibilidade: todo elemento interativo tem `aria-label` ou texto visível

## Tooling

- `eslint-plugin-react` + `eslint-plugin-react-hooks`
- `eslint-plugin-jsx-a11y` para acessibilidade
- React DevTools Profiler para medir antes de otimizar
