---
description: HTTP exception handling, global filter, and no-leak rules for NestJS
paths:
  - "src/**/*.ts"
---

# Error Handling

**Applies to**: Controllers, services, and bootstrap error handling

## Throw, don't hand-format

Services throw NestJS HTTP exceptions for expected failures. The framework maps them to status codes automatically:

```ts
// Correct
throw new ConflictException('Email already registered');
throw new NotFoundException('User not found');
throw new UnauthorizedException('Invalid credentials');
```

Never `try/catch` expected failures in controllers and build the error response by hand. Reserve raw `Error` for true bugs (500s).

## Async errors

Every promise must be `await`ed or explicitly `void`ed (enforced by the `no-floating-promises` lint rule). Do not wrap in bare `catch {}` — handle meaningfully or let it bubble to the global handler.

## Global exception filter (recommended target, not required)

Add via `APP_FILTER` in `app.module.ts` for a consistent error envelope:

```ts
{ provide: APP_FILTER, useClass: GlobalExceptionFilter }
```

Target error shape: `{ statusCode, message, error, timestamp, path }`. Log server-side; never send stack traces, DB errors, or internal messages to the client.

Prefer the built-in exception → status mapping until the custom envelope is genuinely needed.

## Never leak internals

- No stack traces in responses.
- No DB error messages (e.g., Postgres constraint violations) forwarded to clients.
- No internal implementation details in error messages.
