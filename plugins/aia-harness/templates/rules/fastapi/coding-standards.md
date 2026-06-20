---
description: FastAPI coding standards and anti-patterns
paths:
  - "**/*.py"
---

# Python + FastAPI — Coding Standards

**Fonte:** zhanymkanov/fastapi-best-practices

## Anti-padrões

| Proibido | Alternativa |
|----------|-------------|
| `time.sleep()` / I/O bloqueante em `async def` route | Route síncrona (`def`) — FastAPI roda em threadpool automaticamente |
| Trabalho CPU-intensivo em route | `multiprocessing` ou Celery/Arq fora do processo |
| SDK síncrono em route `async def` | `await run_in_threadpool(client.method, ...)` |
| `BaseSettings` monolítica para todos os domínios | `BaseSettings` por domínio, desacoplada |
| `BackgroundTasks` para trabalho longo ou crítico | Celery/Arq — se a perda seria incidente, não use BackgroundTasks |
| Swagger/OpenAPI em produção | `openapi_url = None` fora de local/staging |
| Lógica de negócio no router | Service layer separado; router só recebe → delega → retorna |
| Monkeypatch em testes | `app.dependency_overrides` |
| `async_asgi_testclient` | `httpx` + `ASGITransport` |
| Migrations sem nome descritivo | `2024-01-15_add_post_content_idx.py` (data + slug) |

## Estrutura de Projeto

```
src/
└── <domínio>/
    ├── router.py       # endpoints only
    ├── schemas.py      # Pydantic models
    ├── models.py       # DB models
    ├── dependencies.py # Depends()
    ├── service.py      # business logic
    ├── exceptions.py
    └── constants.py
```

## Convenções

- Imports entre módulos: `from src.auth import constants as auth_constants` (sempre qualificado)
- DB naming: `lower_case_snake` · tabelas no singular (`post`, `user_playlist`) · `_at` datetime · `_date` date
- SQLAlchemy 2.0 async (`AsyncSession`, `async_sessionmaker`) em projetos novos
- Alembic migrations: estáticas e reversíveis
- `MetaData(naming_convention=...)` explícito para índices e constraints
- Pydantic: `BaseModel` customizado herdado por todos os schemas para serialização centralizada
- `@field_validator` que lança `ValueError` → retorna `422 ValidationError` estruturado ao cliente
- SQL-first: joins e agregações no banco, não em Python

## Tooling

- Ruff para lint + format
- `httpx` + `ASGITransport` para testes desde o dia 0
- Alembic para migrations
