---
description: Kotlin coding standards and anti-patterns
paths:
  - "**/*.kt"
  - "**/*.kts"
---

# Kotlin — Coding Standards

**Sources:** kotlinlang.org/docs/coding-conventions · Android Kotlin Style Guide

## Anti-patterns

| Forbidden | Alternative |
| --------- | ----------- |
| `!!` (not-null assertion) | Elvis `?:` or safe call `?.` + explicit handling |
| Java-style getters/setters | Kotlin properties (`val`/`var`) |
| `static` utility functions in companion object | Extension functions |
| `if-else` as assignment statement | Expression form: `val x = if (...) a else b` |
| `for (i in 0..n-1)` | `for (i in 0 until n)` |
| `it` in lambdas with more than one line | Explicit named parameter |
| Data classes with mutable fields (`var`) | `val` + `copy()` for variants |
| `when` without `else` in sealed classes | Always cover all cases (compiler requires it in expression form) |
| `lateinit var` for primitive types | `var` with initial value or `by lazy` |

## Conventions

- Naming: `PascalCase` classes · `camelCase` functions/variables · `UPPER_SNAKE_CASE` constants
- Prefer `val` over `var` — immutability by default
- `data class` for data holders; `sealed class` for ADTs
- Extension functions for utility functionality — does not pollute the original type's API
- Coroutines: `suspend fun` in the business layer; `viewModelScope`/`lifecycleScope` in the presentation layer
- `object` for singletons — not `companion object` with state
- KDoc on all public functions of a library's public API

## Tooling

- ktlint for formatting and style
- Detekt for static analysis
- `kotlinOptions { jvmTarget = "17" }` in the build
