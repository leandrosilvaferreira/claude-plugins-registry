---
description: Logging, secret redaction, and graceful shutdown rules for NestJS
paths:
  - "src/**/*.ts"
---

# Observability

**Applies to**: `main.ts`, DB provider, and any service that logs

## Logging

Use NestJS `Logger` (never `console.log`). Give each logger a context:

```ts
private readonly logger = new Logger(MyService.name);

this.logger.log('User registered', { userId });
this.logger.error('DB connection failed', error.stack);
```

Log levels mean what they say: `error` for failures, `warn` for degraded state, `log` for significant events, `debug` for development detail.

## Redact secrets — hard rule

Never log:
- `password` or `passwordHash`
- `Authorization` headers or JWT tokens
- `JWT_SECRET` or any secret env var
- Any sensitive field from request payloads

Plaintext passwords exist only in request DTOs and must never travel beyond the password-hashing step.

## Structured logging (recommended target, not yet wired)

Add `nestjs-pino` for structured JSON logs. Use `nestjs-cls` for request correlation (request ID + user ID on every log line from the same request).

## Graceful shutdown (recommended target, not yet wired)

Enable `app.enableShutdownHooks()` in `main.ts` (handles SIGTERM / SIGINT). Close the DB pool on shutdown via `OnModuleDestroy` / `onApplicationShutdown` so `pg` Pool connections drain cleanly. Goal: zero-downtime deploys.
