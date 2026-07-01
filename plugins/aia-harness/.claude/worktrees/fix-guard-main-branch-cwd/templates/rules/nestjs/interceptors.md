---
description: When and how to use NestJS interceptors vs guards vs exception filters
paths:
  - "src/**/*.ts"
---

# Interceptors

**Applies to**: Cross-cutting concerns across `src/`

## When to use interceptors

- Logging and timing (measure handler duration)
- Response shaping (wrap output in a consistent envelope)
- Request timeout (cancel slow handlers)
- Caching (return cached response before handler runs)

Interceptors wrap handler execution and have access to both request and response.

## Interceptor vs guard vs exception filter

| Mechanism | When it runs | Use for |
|-----------|-------------|---------|
| Guard | Before handler (allow / deny) | Authentication, authorization |
| Interceptor | Around handler (before + after) | Logging, caching, shaping, timeout |
| Exception filter | After handler throws | Custom error response shape |

Pick the right one for the job. Mixing concerns (e.g., business logic in an interceptor) makes the system harder to reason about.

## Registration

App-wide via `app.module.ts`:

```ts
{ provide: APP_INTERCEPTOR, useClass: LoggingInterceptor }
```

Scoped to a controller or handler via `@UseInterceptors(SomeInterceptor)`.

## Keep interceptors stateless and light

Interceptors run on every wrapped request. Never hold mutable state in interceptor instances. Keep processing fast — they add overhead to every call they wrap.
