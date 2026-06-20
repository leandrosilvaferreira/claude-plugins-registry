---
description: C# .NET coding standards and anti-patterns
paths:
  - "**/*.cs"
---

# C# / .NET — Coding Standards

**Fonte:** Microsoft .NET Coding Conventions · docs.microsoft.com

## Anti-padrões

| Proibido | Alternativa |
|----------|-------------|
| `var` para tipos não-óbvios na inicialização | Tipo explícito para clareza |
| `catch (Exception e)` genérico | Capturar exceção específica |
| Campos públicos em classes | Propriedades com getter/setter |
| `String.Format("x={0}", x)` | String interpolation `$"x={x}"` |
| Evento invocado sem verificação null | Operador null-conditional `evento?.Invoke(...)` |
| `Task` não aguardado (`async void` sem motivo) | `async Task` e sempre `await` |
| `if (x == null)` para tipos de referência modernos | Pattern matching `if (x is null)` |
| LINQ com side effects em predicados | Side effects fora do LINQ |
| `Thread.Sleep()` em async code | `await Task.Delay()` |
| Dispor objetos `IDisposable` manualmente | `using` statement / `using` declaration |

## Convenções

- Nomenclatura: `PascalCase` classes/métodos/propriedades · `camelCase` variáveis locais/parâmetros · `_camelCase` campos privados · `I<Nome>` interfaces
- `readonly` para campos que não mudam após construção
- `record` para data classes imutáveis (C# 9+)
- Nullable reference types habilitado (`<Nullable>enable</Nullable>`)
- `async`/`await` até a raiz — nunca `.Result` ou `.Wait()` em código async (deadlock)
- LINQ: preferencialmente syntax de método; query syntax para joins complexos

## Tooling

- Roslyn Analyzers na pipeline (`<TreatWarningsAsErrors>true</TreatWarningsAsErrors>`)
- StyleCop.Analyzers para estilo
- `dotnet format` para formatação
- `dotnet test` com cobertura via `coverlet`
