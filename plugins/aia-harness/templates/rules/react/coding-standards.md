---
description: React coding standards and anti-patterns
paths:
  - "**/*.tsx"
  - "**/*.jsx"
---

# React — Coding Standards

**Sources:** Airbnb React Style Guide · antigravity.codes · React official docs

## Anti-patterns

| Forbidden | Alternative |
|-----------|-------------|
| Inline functions in JSX on components that re-render frequently | Extract + `useCallback` when referential stability matters to dependents |
| `key={index}` on dynamic lists | Stable IDs from the data |
| `useEffect` for synchronous logic derived from state | Derived state calculated inline or with `useMemo` |
| Prop drilling > 2 levels | Context, Zustand, or Jotai |
| Duplicated state (same data in two `useState`) | Single source of truth; derive the rest |
| Direct state mutation | Always create a new object/array |
| Component > 250 LOC | Extract sub-components or custom hooks |
| `any` in prop types | Explicit interfaces |
| Business logic inside the component | Custom hook (`use<Name>`) |
| `document.querySelector` in a React component | `useRef` |

## Conventions

- Components: `PascalCase` · Custom hooks: `useCamelCase`
- Props interface named `<ComponentName>Props`
- `export default` only for page-level components; all others: named exports
- Composition over inheritance — never `extends` on components
- `memo()` only when profiling confirms a re-render problem
- Accessibility: every interactive element has an `aria-label` or visible text

## Tooling

- `eslint-plugin-react` + `eslint-plugin-react-hooks`
- `eslint-plugin-jsx-a11y` for accessibility
- React DevTools Profiler to measure before optimizing
