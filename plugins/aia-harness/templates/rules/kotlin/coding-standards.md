---
description: Kotlin coding standards and anti-patterns
paths:
  - "**/*.kt"
  - "**/*.kts"
---

# Kotlin — Coding Standards

**Fontes:** kotlinlang.org/docs/coding-conventions · Android Kotlin Style Guide

## Anti-padrões

| Proibido | Alternativa |
|----------|-------------|
| `!!` (not-null assertion) | Elvis `?:` ou safe call `?.` + tratamento explícito |
| Getters/setters estilo Java | Properties Kotlin (`val`/`var`) |
| Funções utility `static` em companion object | Extension functions |
| `if-else` como statement de atribuição | Expression form: `val x = if (...) a else b` |
| `for (i in 0..n-1)` | `for (i in 0 until n)` |
| `it` em lambdas com mais de uma linha | Parâmetro nomeado explícito |
| Data classes com campos mutáveis (`var`) | `val` + `copy()` para variantes |
| `when` sem `else` em sealed classes | Sempre cobrir todos os casos (o compilador exige em expression) |
| `lateinit var` para tipos primitivos | `var` com valor inicial ou `by lazy` |

## Convenções

- Nomenclatura: `PascalCase` classes · `camelCase` funções/variáveis · `UPPER_SNAKE_CASE` constantes
- Preferir `val` a `var` — imutabilidade por padrão
- `data class` para holders de dados; `sealed class` para ADTs
- Extension functions para funcionalidade utilitária — não polui a API do tipo original
- Corrotinas: `suspend fun` na camada de negócio; `viewModelScope`/`lifecycleScope` na camada de apresentação
- `object` para singletons — não `companion object` com estado
- KDoc em todas as funções públicas de API pública de biblioteca

## Tooling

- ktlint para formatação e estilo
- Detekt para análise estática
- `kotlinOptions { jvmTarget = "17" }` no build
