---
description: Python coding standards and anti-patterns
paths:
  - "**/*.py"
---

# Python — Coding Standards

**Sources:** Google Python Style Guide · antigravity.codes/rules · PEP 8

## Anti-patterns

| Forbidden | Alternative |
|-----------|-------------|
| `def f(x=[])` — mutable default argument | `def f(x=None): x = x or []` |
| `from module import *` | Explicit named imports |
| `except:` bare — catches everything including `KeyboardInterrupt` | `except SpecificException as e:` |
| Comparison with `is` for values (`x is 1`) | `==` for values; `is` only for identity (`None`, singletons) |
| String concatenation in loop (`s += x`) | `"".join(iterable)` |
| `type(x) == int` for type checking | `isinstance(x, int)` |
| Single-character variable names outside lambdas/short loops | Descriptive names |
| `print()` for debug in production | `logging` with appropriate level |
| Inline magic numbers | Named constants |

## Conventions

- PEP 8: `snake_case` functions/variables · `PascalCase` classes · `UPPER_SNAKE_CASE` constants
- f-strings for interpolation (Python 3.6+) — not `%` nor `.format()`
- Type hints on all public function signatures
- `pathlib.Path` instead of `os.path` for path manipulation
- Context managers (`with`) for resources — never close manually in `finally`
- List/dict/set comprehensions preferred over equivalent manual loops
- Docstrings on all public functions/classes (Google style or NumPy style)

## Tooling

- Ruff for lint + format (replaces black + isort + flake8)
- mypy or pyright for static typing
- pytest for tests
- `pyproject.toml` as the single tooling configuration file
