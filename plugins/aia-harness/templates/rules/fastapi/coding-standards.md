---
description: FastAPI coding standards and anti-patterns
paths:
  - "**/*.py"
---

# Python + FastAPI — Coding Standards

**Source:** zhanymkanov/fastapi-best-practices

## Anti-patterns

| Forbidden | Alternative |
|-----------|-------------|
| `time.sleep()` / blocking I/O in `async def` route | Synchronous route (`def`) — FastAPI runs it in a threadpool automatically |
| CPU-intensive work in route | `multiprocessing` or Celery/Arq outside the process |
| Synchronous SDK in `async def` route | `await run_in_threadpool(client.method, ...)` |
| Monolithic `BaseSettings` for all domains | `BaseSettings` per domain, decoupled |
| `BackgroundTasks` for long or critical work | Celery/Arq — if loss would be an incident, do not use BackgroundTasks |
| Swagger/OpenAPI in production | `openapi_url = None` outside local/staging |
| Business logic in the router | Separate service layer; router only receives → delegates → returns |
| Monkeypatching in tests | `app.dependency_overrides` |
| `async_asgi_testclient` | `httpx` + `ASGITransport` |
| Migrations without a descriptive name | `2024-01-15_add_post_content_idx.py` (date + slug) |

## Project Structure

```
src/
└── <domain>/
    ├── router.py       # endpoints only
    ├── schemas.py      # Pydantic models
    ├── models.py       # DB models
    ├── dependencies.py # Depends()
    ├── service.py      # business logic
    ├── exceptions.py
    └── constants.py
```

## Conventions

- Cross-module imports: `from src.auth import constants as auth_constants` (always qualified)
- DB naming: `lower_case_snake` · singular tables (`post`, `user_playlist`) · `_at` datetime · `_date` date
- SQLAlchemy 2.0 async (`AsyncSession`, `async_sessionmaker`) in new projects
- Alembic migrations: static and reversible
- Explicit `MetaData(naming_convention=...)` for indexes and constraints
- Pydantic: custom `BaseModel` inherited by all schemas for centralized serialization
- `@field_validator` that raises `ValueError` → returns structured `422 ValidationError` to the client
- SQL-first: joins and aggregations in the database, not in Python

## Tooling

- Ruff for lint + format
- `httpx` + `ASGITransport` for tests from day 0
- Alembic for migrations
