---
description: Django coding standards and anti-patterns
paths:
  - "**/*.py"
---

# Python + Django — Coding Standards

**Fontes:** JetBrains/junie-guidelines · Django official docs

## Anti-padrões

| Proibido | Alternativa |
|----------|-------------|
| Lógica de negócio na View | Model methods ou Service layer separado |
| Consultas N+1 | `select_related()` para FK · `prefetch_related()` para M2M |
| `settings.py` único para todos os ambientes | `django-environ` + `settings/base.py`, `settings/local.py`, `settings/prod.py` |
| SQL raw sem motivo | ORM Django; SQL apenas quando performance é crítica e documentado |
| `CharField` sem `max_length` | Sempre definir `max_length` |
| `BooleanField` com `null=True` | `default=False` sem null |
| Lógica em migrations | Migrations apenas para schema; dados via `RunPython` isolado |
| `User` importado diretamente | `get_user_model()` para compatibilidade com modelo customizado |
| Serializer sem validação explícita | `validate_<field>` e `validate()` em todos os serializadores DRF |
| Views sem permissão | `permission_classes` explícito em toda view DRF |

## Convenções

- Apps focados: cada app tem uma responsabilidade de domínio clara
- `models.py` > 200 LOC: dividir em `models/` package
- Signals apenas para cross-cutting concerns (auditoria, cache invalidation) — não para lógica de negócio
- `Meta.ordering` em modelos que sempre são listados em ordem específica
- `__str__` em todo modelo
- Migrations: nunca editar migration já aplicada em produção; criar nova

## Tooling

- `django-debug-toolbar` em desenvolvimento
- `django-extensions` para shell_plus e outros utilitários de dev
- `factory_boy` para fixtures de teste
- `pytest-django` em vez de `unittest` nativo
