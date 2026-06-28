---
description: NestJS module, controller, service, and DI conventions
paths:
  - "src/**/*.ts"
---

# NestJS Architecture

**Applies to**: `src/` — all controllers, services, modules

## Modules

- **Feature-first**: one folder per feature (`src/<feature>/`) containing controller, service, DTO, and any decorators or guards.
- Module exports only what other modules need to inject. Do not export everything.
- `AppModule` stays lean: imports feature modules + global config only. No business logic in `AppModule`.
- Cross-cutting infra (DB, config) uses `@Global()` modules so they do not need to be re-imported per feature.

## Controllers

- Thin HTTP layer only: route binding, DTO binding, delegate to service, return result.
- No business logic, no DB access in controllers.
- Responsibility: translate HTTP request → service call → HTTP response.

## Services

- All `@Injectable()` with dependencies via constructor (`private readonly dep: DepClass`).
- Never `new` a service — always inject.
- Throw NestJS HTTP exceptions (`ConflictException`, `UnauthorizedException`, `NotFoundException`, etc.) for expected failures. Never return null or a hand-crafted error object.
- Reserve raw `Error` for true bugs (500s).

## Dependency Injection

- Inject by class token for most dependencies.
- Inject DB via the `DRIZZLE` symbol token: `constructor(@Inject(DRIZZLE) private readonly db: DrizzleDB) {}`.
- Never call `drizzle()` or `new Pool()` inside a service — the pool is created once in the DB module's `useFactory`.

## Cross-cutting concerns

| Mechanism | Use for |
|-----------|---------|
| Guard | Authentication / authorization (allow or deny before handler runs) |
| Interceptor | Logging, caching, timeout, response shaping (wraps handler) |
| Exception filter | Custom error envelope shape (catches errors after handler throws) |

Prefer the built-in NestJS exception → HTTP status mapping before adding a custom exception filter.

## Bootstrap (`main.ts`)

- Owns: global prefix (`/api`), CORS config, Swagger setup, `app.listen(PORT)`.
- Apply global pipe (`ZodValidationPipe`) via `APP_PIPE` in `app.module.ts`, not in `main.ts`.
