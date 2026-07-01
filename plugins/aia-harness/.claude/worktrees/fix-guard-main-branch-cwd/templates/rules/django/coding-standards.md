---
description: Django coding standards and anti-patterns
paths:
  - "**/*.py"
---

# Python + Django — Coding Standards

**Sources:** JetBrains/junie-guidelines · Django official docs

## Anti-patterns

| Forbidden | Alternative |
|-----------|-------------|
| Business logic in the View | Model methods or separate Service layer |
| N+1 queries | `select_related()` for FK · `prefetch_related()` for M2M |
| Single `settings.py` for all environments | `django-environ` + `settings/base.py`, `settings/local.py`, `settings/prod.py` |
| Raw SQL without reason | Django ORM; SQL only when performance is critical and documented |
| `CharField` without `max_length` | Always define `max_length` |
| `BooleanField` with `null=True` | `default=False` without null |
| Logic in migrations | Migrations for schema only; data via isolated `RunPython` |
| `User` imported directly | `get_user_model()` for compatibility with custom user model |
| Serializer without explicit validation | `validate_<field>` and `validate()` on all DRF serializers |
| Views without permissions | Explicit `permission_classes` on every DRF view |

## Conventions

- Focused apps: each app has a clear domain responsibility
- `models.py` > 200 LOC: split into a `models/` package
- Signals only for cross-cutting concerns (auditing, cache invalidation) — not for business logic
- `Meta.ordering` on models that are always listed in a specific order
- `__str__` on every model
- Migrations: never edit a migration already applied in production; create a new one

## Tooling

- `django-debug-toolbar` in development
- `django-extensions` for shell_plus and other dev utilities
- `factory_boy` for test fixtures
- `pytest-django` instead of native `unittest`
