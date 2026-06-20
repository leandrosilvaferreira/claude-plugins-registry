---
description: Python coding standards and anti-patterns
paths:
  - "**/*.py"
---

# Python — Coding Standards

**Fontes:** Google Python Style Guide · antigravity.codes/rules · PEP 8

## Anti-padrões

| Proibido | Alternativa |
|----------|-------------|
| `def f(x=[])` — mutable default argument | `def f(x=None): x = x or []` |
| `from module import *` | Imports explícitos nomeados |
| `except:` bare — captura tudo incluindo `KeyboardInterrupt` | `except SpecificException as e:` |
| Comparação com `is` para valores (`x is 1`) | `==` para valores; `is` apenas para identidade (`None`, singletons) |
| Concatenação de string em loop (`s += x`) | `"".join(iterable)` |
| `type(x) == int` para checagem de tipo | `isinstance(x, int)` |
| Variáveis de nome único fora de lambdas/loops curtos | Nomes descritivos |
| `print()` para debug em produção | `logging` com nível apropriado |
| Magic numbers inline | Constantes nomeadas |

## Convenções

- PEP 8: `snake_case` funções/variáveis · `PascalCase` classes · `UPPER_SNAKE_CASE` constantes
- f-strings para interpolação (Python 3.6+) — não `%` nem `.format()`
- Type hints em todas as assinaturas de função pública
- `pathlib.Path` em vez de `os.path` para manipulação de caminhos
- Context managers (`with`) para recursos — nunca fechar manualmente em `finally`
- List/dict/set comprehensions preferidos a loops manuais equivalentes
- Docstrings em todas as funções/classes públicas (Google style ou NumPy style)

## Tooling

- Ruff para lint + format (substitui black + isort + flake8)
- mypy ou pyright para tipagem estática
- pytest para testes
- `pyproject.toml` como único arquivo de configuração de tooling
