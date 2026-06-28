---
description: Zod DTO validation and global pipe conventions for NestJS
paths:
  - "src/**/*.ts"
---

# Validation — Zod

**Applies to**: Request validation across `src/`

## DTOs are zod schemas

```ts
import { z } from 'zod';
import { createZodDto } from 'nestjs-zod';

const createUserSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8).max(72),
});

export class CreateUserDto extends createZodDto(createUserSchema) {}
```

## Global pipe

`ZodValidationPipe` is registered via `APP_PIPE` in `app.module.ts`. Type a `@Body()` / `@Param()` / `@Query()` parameter as the DTO class and validation runs automatically.

**Do NOT** add `@UsePipes(ZodValidationPipe)` per handler — redundant and misleading.

## Where to validate

- Every request body, param, and query carrying user input has a zod schema.
- No unvalidated `any` reaches a service.
- Validate at the HTTP boundary only. Once inside a service, trust the typed DTO.

## Constraints belong in the schema

Use `.email()`, `.min()`, `.max()`, `.uuid()`, enums, `.regex()` — not scattered conditionals in service methods.

## Schema accuracy feeds Swagger

Zod DTOs generate OpenAPI schema via `cleanupOpenApiDoc` in `main.ts`. Keep schemas accurate — inaccurate schema = inaccurate Swagger docs.
