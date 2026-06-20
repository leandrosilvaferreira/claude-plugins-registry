---
description: Java coding standards and anti-patterns
paths:
  - "**/*.java"
---

# Java — Coding Standards

**Fontes:** Google Java Style Guide · JetBrains/junie-guidelines

## Anti-padrões

| Proibido | Alternativa |
|----------|-------------|
| `null` como valor sentinela | `Optional<T>` |
| Concatenação de `String` em loop | `StringBuilder` |
| `catch (Exception e)` genérico | Capturar exceção específica |
| Campos públicos em classes | Propriedades com getter/setter |
| `instanceof` sem cast seguro | Pattern matching `instanceof Foo f` (Java 16+) |
| Objetos mutáveis em `static final` | Objetos imutáveis ou `Collections.unmodifiable*` |
| `static import` excessivo | Import qualificado explícito |
| Lógica de negócio em construtores | Métodos factory ou injeção de dependência |
| Comentário que repete o código | Comentário que explica o POR QUÊ |
| Checked exceptions em APIs públicas | Unchecked exceptions com contexto |

## Convenções

- Nomenclatura: `PascalCase` classes · `camelCase` métodos/variáveis · `UPPER_SNAKE_CASE` constantes
- Um arquivo por classe pública de nível superior
- Interfaces não devem ter prefixo `I` — use sufixo descritivo (`Repository`, `Service`)
- Métodos com mais de 20 linhas: candidato a extração
- `final` em parâmetros e variáveis locais quando não reatribuídos
- Não usar raw types: `List` → `List<String>`
- Records Java (17+) para data classes imutáveis

## Tooling

- Checkstyle + PMD + SpotBugs na pipeline
- OWASP Dependency-Check para CVEs
- `@SuppressWarnings` apenas com comentário justificando
