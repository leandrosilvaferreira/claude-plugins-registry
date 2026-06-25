---
description: PHP coding standards and anti-patterns
paths:
  - "**/*.php"
---

# PHP — Coding Standards

**Source:** PSR-12 (PHP-FIG) · PHP 8.x official docs

## Anti-patterns

| Forbidden | Alternative |
|-----------|-------------|
| Closing tag `?>` in pure PHP files | Omit — avoids accidental whitespace |
| Mix of tabs and spaces | 4 spaces (PSR-12) |
| `array()` syntax | Short syntax `[]` (PHP 5.4+) |
| Functions without type hints | Type hints on parameters and return (PHP 8+) |
| `isset()` to check array key in a loop | `array_key_exists()` when `null` is a valid value |
| `@` to suppress errors | Handle the error properly |
| String concatenation in loop (`$s .= $x`) | `implode()` or array + final join |
| `extract()` | Explicit destructuring or key-based access |
| `global $var` | Dependency injection |
| Long functions (> 30 lines) without extraction | Smaller methods with single responsibility |

## Conventions

- PSR-12: `PascalCase` classes · `camelCase` methods · `snake_case` variables · `UPPER_SNAKE_CASE` constants
- `declare(strict_types=1)` at the top of every file
- `readonly` for immutable properties (PHP 8.1+)
- Named arguments for clarity in calls with many parameters
- `match` instead of `switch` for expressions (PHP 8.0+)
- Native enums (PHP 8.1+) instead of constant classes

## Tooling

- PHP-CS-Fixer or Pint (Laravel) for formatting
- PHPStan (level 8+) or Psalm for static analysis
- Composer for dependency management
