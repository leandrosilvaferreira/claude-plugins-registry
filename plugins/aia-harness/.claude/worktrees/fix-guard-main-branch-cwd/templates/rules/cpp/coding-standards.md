---
description: C++ coding standards and anti-patterns
paths:
  - "**/*.cpp"
  - "**/*.cc"
  - "**/*.h"
  - "**/*.hpp"
---

# C++ — Coding Standards

**Sources:** isocpp/CppCoreGuidelines (Stroustrup + Sutter) · Google C++ Style Guide

## Anti-patterns

| Forbidden | Alternative |
| --------- | ----------- |
| Manual `new`/`delete` | RAII + `std::unique_ptr` / `std::shared_ptr` |
| Raw pointers for ownership | `unique_ptr`; raw pointer only for non-owning observation |
| C-style arrays `T arr[N]` | `std::array<T, N>` (fixed size) or `std::vector<T>` |
| `NULL` or `0` for null pointer | `nullptr` |
| `#define` for constants | `constexpr` |
| `using namespace std` in headers | Explicit `std::` qualification |
| C-style cast `(int)x` | `static_cast<int>(x)`, `reinterpret_cast`, `const_cast` per semantics |
| Exception in destructor | `noexcept` on destructors; catch exceptions internally |
| Accidental copy of large objects | Pass by `const&`; move semantics where ownership transfers |
| `std::endl` in performance-sensitive code | `'\n'` — `std::endl` causes unnecessary flush |

## Conventions

- Naming: `PascalCase` classes · `snake_case` functions/variables · `kPascalCase` constants (Google) or `UPPER_SNAKE_CASE` (isocpp)
- Prefer `const` and `constexpr` — immutability by default
- Rule of zero: if you don't need a custom destructor/copy/move, don't declare them
- Rule of five: if you need one, declare all five (`destructor`, `copy ctor`, `copy assign`, `move ctor`, `move assign`)
- Headers: include guards with `#pragma once` or `#ifndef`; never define variables in headers
- Include ordering: own headers · third-party libraries · STL (Google style)
- `[[nodiscard]]` on functions whose return value must not be ignored

## Tooling

- `clang-format` with team configuration
- `clang-tidy` for static analysis
- AddressSanitizer (`-fsanitize=address`) in test builds
- `valgrind` or `heaptrack` for memory profiling
- CMake as build system; never commit generated files
