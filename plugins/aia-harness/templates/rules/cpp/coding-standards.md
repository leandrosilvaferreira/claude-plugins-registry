---
description: C++ coding standards and anti-patterns
paths:
  - "**/*.cpp"
  - "**/*.cc"
  - "**/*.h"
  - "**/*.hpp"
---

# C++ — Coding Standards

**Fontes:** isocpp/CppCoreGuidelines (Stroustrup + Sutter) · Google C++ Style Guide

## Anti-padrões

| Proibido | Alternativa |
|----------|-------------|
| `new`/`delete` manual | RAII + `std::unique_ptr` / `std::shared_ptr` |
| Raw pointers para ownership | `unique_ptr`; raw pointer apenas para observação não-owning |
| Arrays C-style `T arr[N]` | `std::array<T, N>` (tamanho fixo) ou `std::vector<T>` |
| `NULL` ou `0` para ponteiro nulo | `nullptr` |
| `#define` para constantes | `constexpr` |
| `using namespace std` em headers | Qualificação explícita `std::` |
| Cast C-style `(int)x` | `static_cast<int>(x)`, `reinterpret_cast`, `const_cast` conforme semântica |
| Exceção em destrutor | `noexcept` em destructors; capturar exceções internamente |
| Cópia acidental de objetos grandes | Passar por `const&`; move semantics onde ownership transfere |
| `std::endl` em performance-sensitive code | `'\n'` — `std::endl` faz flush desnecessário |

## Convenções

- Nomeação: `PascalCase` classes · `snake_case` funções/variáveis · `kPascalCase` constantes (Google) ou `UPPER_SNAKE_CASE` (isocpp)
- Prefer `const` e `constexpr` — imutabilidade por padrão
- Regra dos zero: se não precisa de destrutor/cópia/move customizados, não declare
- Regra dos cinco: se precisa de um, declare todos os cinco (`destrutor`, `copy ctor`, `copy assign`, `move ctor`, `move assign`)
- Headers: include guards com `#pragma once` ou `#ifndef`; nunca definir variáveis em headers
- Ordenação de includes: próprios · bibliotecas de terceiros · STL (Google style)
- `[[nodiscard]]` em funções cujo retorno não deve ser ignorado

## Tooling

- `clang-format` com configuração de equipe
- `clang-tidy` para análise estática
- AddressSanitizer (`-fsanitize=address`) em builds de teste
- `valgrind` ou `heaptrack` para profiling de memória
- CMake como build system; nunca commitar arquivos gerados
