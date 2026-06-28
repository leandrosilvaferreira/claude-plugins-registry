---
description: ConfigModule, env validation, and no-raw-process.env rules for NestJS
paths:
  - "src/**/*.ts"
---

# Config & Environment

**Applies to**: Config and environment access across the app

## ConfigModule

Register in `app.module.ts`:

```ts
ConfigModule.forRoot({
  isGlobal: true,
  cache: true,
  validate: validateEnv,
})
```

Never read raw `process.env` in app code. Inject `ConfigService<Env, true>` and use:

```ts
this.config.get('DATABASE_URL', { infer: true })
```

## Env validation (`src/config/env.ts`)

Single zod `envSchema` is the source of truth. `validateEnv` parses `process.env` at boot and **crashes the app** on invalid or missing vars (fail fast, not fail silently).

Add a new env var: add it to `envSchema` → available via `ConfigService` with full type inference.

```ts
const envSchema = z.object({
  DATABASE_URL: z.string().url(),
  JWT_SECRET: z.string().min(16),
  JWT_EXPIRES_IN: z.string().default('1d'),
  PORT: z.coerce.number().default(3000),
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
});
```

## Rules

- Never `process.env.X` directly in app code.
- Never default a secret in code (e.g., `process.env.JWT_SECRET ?? 'fallback'`).
- Required secrets must crash boot when missing.
- `z.coerce.number()` for numeric vars, `z.enum()` for `NODE_ENV`.

## Only exception

`drizzle.config.ts` may use `process.env.DATABASE_URL!` directly — it runs outside Nest DI, loaded via dotenv, before the app boots.
