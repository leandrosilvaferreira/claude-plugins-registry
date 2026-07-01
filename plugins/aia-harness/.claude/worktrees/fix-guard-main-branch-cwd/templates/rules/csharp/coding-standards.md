---
description: C# .NET coding standards and anti-patterns
paths:
  - "**/*.cs"
---

# C# / .NET — Coding Standards

**Source:** Microsoft .NET Coding Conventions · docs.microsoft.com

## Anti-patterns

| Forbidden | Alternative |
| --------- | ----------- |
| `var` for non-obvious types at initialization | Explicit type for clarity |
| Generic `catch (Exception e)` | Catch specific exception |
| Public fields in classes | Properties with getter/setter |
| `String.Format("x={0}", x)` | String interpolation `$"x={x}"` |
| Event invoked without null check | Null-conditional operator `event?.Invoke(...)` |
| Unawaited `Task` (`async void` without reason) | `async Task` and always `await` |
| `if (x == null)` for modern reference types | Pattern matching `if (x is null)` |
| LINQ with side effects in predicates | Side effects outside LINQ |
| `Thread.Sleep()` in async code | `await Task.Delay()` |
| Manually disposing `IDisposable` objects | `using` statement / `using` declaration |

## Conventions

- Naming: `PascalCase` classes/methods/properties · `camelCase` local variables/parameters · `_camelCase` private fields · `I<Name>` interfaces
- `readonly` for fields that do not change after construction
- `record` for immutable data classes (C# 9+)
- Nullable reference types enabled (`<Nullable>enable</Nullable>`)
- `async`/`await` all the way to the root — never `.Result` or `.Wait()` in async code (deadlock)
- LINQ: prefer method syntax; query syntax for complex joins

## Tooling

- Roslyn Analyzers in the pipeline (`<TreatWarningsAsErrors>true</TreatWarningsAsErrors>`)
- StyleCop.Analyzers for style
- `dotnet format` for formatting
- `dotnet test` with coverage via `coverlet`
