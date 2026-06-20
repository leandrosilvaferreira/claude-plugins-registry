---
description: Dart/Flutter coding standards and anti-patterns
paths:
  - "**/*.dart"
---

# Dart / Flutter — Coding Standards

**Fontes:** dart.dev/effective-dart · flutter.dev/docs/development/style · Flutter repo style guide

## Anti-padrões

| Proibido | Alternativa |
|----------|-------------|
| `dynamic` sem motivo | Tipos explícitos |
| `setState` para lógica de negócio complexa | Provider / Riverpod / Bloc |
| `print()` em produção | `debugPrint()` (respeitado pelo framework) ou logger |
| Widget monolítico de 300+ linhas | Extrair em widgets menores com responsabilidade única |
| `FutureBuilder` sem estado de loading/error | Tratar `ConnectionState.waiting` e erro explicitamente |
| `!` (null assertion) sem verificação prévia | `?.` safe call ou `if (x != null)` |
| Importar `dart:io` diretamente em widget | Abstrair atrás de interface/service |
| `const` omitido onde possível | Sempre usar `const` para widgets imutáveis (melhora performance) |
| `context.read()` no build | `context.read()` apenas em callbacks; `context.watch()` no build |

## Convenções (Dart)

- `lowerCamelCase` funções/variáveis · `UpperCamelCase` tipos · `lowercase_with_underscores` arquivos e pacotes
- Preferir `final` a `var` — imutabilidade por padrão
- `late` apenas quando inicialização lazy é necessária e valor nunca será null
- `extension` para adicionar métodos a tipos existentes sem herança
- Docstrings com `///` para toda API pública

## Convenções (Flutter)

- Estrutura: `lib/features/<feature>/{presentation,domain,data}/`
- Widgets: `StatelessWidget` por padrão; `StatefulWidget` apenas quando estado local é inevitável
- `Key` em listas dinâmicas de widgets
- `Theme.of(context)` para cores e estilos — nunca hard-code
- Imagens: `assets/images/` com `pubspec.yaml` declarando assets

## Tooling

- `dart format` (formatador oficial, zero config)
- `dart analyze` com `analysis_options.yaml` rigoroso
- `flutter_lints` ou `very_good_analysis` como base
- `flutter test` + `integration_test` package
