---
description: Swagger / OpenAPI decorator conventions for NestJS controllers and routes
paths:
  - "src/**/*.controller.ts"
---

# Swagger / OpenAPI

**Applies to**: API documentation via `@nestjs/swagger`

## Per controller

```ts
@ApiTags('users')
@Controller('users')
export class UsersController {}
```

## Per route

```ts
@ApiOperation({ summary: 'Get current user profile' })
@Get('me')
getMe() { ... }
```

Summary: short, action-oriented (verb + noun). Avoid repeating the HTTP method.

## Protected routes

```ts
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Get('me')
getMe() { ... }
```

## Non-200 success codes

Set explicitly so docs and runtime agree:

```ts
@HttpCode(204)
@Delete(':id')
remove() { ... }
```

## Error responses

Document meaningful failures:

```ts
@ApiResponse({ status: 401, description: 'Not authenticated' })
@ApiResponse({ status: 409, description: 'Email already registered' })
```

## Schema accuracy

Zod DTOs generate request/response schemas via `cleanupOpenApiDoc` in `main.ts`. Do not hand-maintain `@ApiProperty()` on fields the zod schema already describes — they stay in sync automatically.

Update both the zod schema and Swagger decorators when the contract changes.
