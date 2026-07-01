---
description: Java coding standards and anti-patterns
paths:
  - "**/*.java"
---

# Java — Coding Standards

**Sources:** Google Java Style Guide · JetBrains/junie-guidelines

## Anti-patterns

| Forbidden | Alternative |
| --------- | ----------- |
| `null` as sentinel value | `Optional<T>` |
| `String` concatenation in a loop | `StringBuilder` |
| Generic `catch (Exception e)` | Catch specific exception |
| Public fields in classes | Properties with getter/setter |
| `instanceof` without safe cast | Pattern matching `instanceof Foo f` (Java 16+) |
| Mutable objects in `static final` | Immutable objects or `Collections.unmodifiable*` |
| Excessive `static import` | Explicit qualified import |
| Business logic in constructors | Factory methods or dependency injection |
| Comment that repeats the code | Comment that explains the WHY |
| Checked exceptions in public APIs | Unchecked exceptions with context |

## Conventions

- Naming: `PascalCase` classes · `camelCase` methods/variables · `UPPER_SNAKE_CASE` constants
- One file per top-level public class
- Interfaces should not have `I` prefix — use descriptive suffix (`Repository`, `Service`)
- Methods with more than 20 lines: candidate for extraction
- `final` on parameters and local variables when not reassigned
- Do not use raw types: `List` → `List<String>`
- Java Records (17+) for immutable data classes

## Tooling

- Checkstyle + PMD + SpotBugs in the pipeline
- OWASP Dependency-Check for CVEs
- `@SuppressWarnings` only with a justifying comment
