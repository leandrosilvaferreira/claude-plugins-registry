---
description: Dart/Flutter coding standards and anti-patterns
paths:
  - "**/*.dart"
---

# Dart / Flutter — Coding Standards

**Sources:** dart.dev/effective-dart · flutter.dev/docs/development/style · Flutter repo style guide

## Anti-patterns

| Forbidden | Alternative |
| --------- | ----------- |
| `dynamic` without reason | Explicit types |
| `setState` for complex business logic | Provider / Riverpod / Bloc |
| `print()` in production | `debugPrint()` (respected by the framework) or logger |
| Monolithic widget of 300+ lines | Extract into smaller widgets with single responsibility |
| `FutureBuilder` without loading/error state | Handle `ConnectionState.waiting` and error explicitly |
| `!` (null assertion) without prior check | `?.` safe call or `if (x != null)` |
| Importing `dart:io` directly in a widget | Abstract behind an interface/service |
| `const` omitted where possible | Always use `const` for immutable widgets (improves performance) |
| `context.read()` in build | `context.read()` only in callbacks; `context.watch()` in build |

## Conventions (Dart)

- `lowerCamelCase` functions/variables · `UpperCamelCase` types · `lowercase_with_underscores` files and packages
- Prefer `final` over `var` — immutability by default
- `late` only when lazy initialization is required and the value will never be null
- `extension` to add methods to existing types without inheritance
- Docstrings with `///` for all public APIs

## Conventions (Flutter)

- Structure: `lib/features/<feature>/{presentation,domain,data}/`
- Widgets: `StatelessWidget` by default; `StatefulWidget` only when local state is unavoidable
- `Key` on dynamic widget lists
- `Theme.of(context)` for colors and styles — never hard-code
- Images: `assets/images/` declared in `pubspec.yaml`

## Tooling

- `dart format` (official formatter, zero config)
- `dart analyze` with strict `analysis_options.yaml`
- `flutter_lints` or `very_good_analysis` as base
- `flutter test` + `integration_test` package
