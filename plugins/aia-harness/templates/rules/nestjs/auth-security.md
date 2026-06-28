---
description: JWT, bcrypt, guards, and ownership rules for NestJS auth
paths:
  - "src/auth/**"
  - "src/users/**"
---

# Auth & Security

**Applies to**: `src/auth/` and any endpoint handling user data

## Passwords

- Hash with `bcrypt.hash(plain, 10)` on register (cost factor ≥ 10 minimum).
- Verify with `bcrypt.compare` on login — never compare manually.
- DB column named `passwordHash`. Plaintext only in the DTO.
- Login failures throw `UnauthorizedException('Invalid credentials')` for both unknown email and wrong password (anti-enumeration — same message for both).

## JWT

- Sign via injected `JwtService`.
- Payload: `{ sub: userId, email }` — minimal, no sensitive fields.
- Secret from `ConfigService` (validated at boot, min 16 chars). Never hardcoded.
- `JwtStrategy` with `ignoreExpiration: false`. `validate()` re-loads the user from DB to reject deleted users — preserve that check.
- TTL from `JWT_EXPIRES_IN` env. Never issue non-expiring tokens.

## Guards & current user

- Protect routes with `@UseGuards(JwtAuthGuard)` + `@ApiBearerAuth()`. No silent public endpoints.
- Read the current user via `@CurrentUser()` decorator (typed `AuthUser`), not `request.user`.
- **Ownership check mandatory**: any handler reading or mutating a resource by id must verify it belongs to `CurrentUser`. Failure to check enables horizontal privilege escalation.

## DTOs

- Zod schemas in `dto/auth.dto.ts`. Password constraints: `min(8).max(72)` (72 is the bcrypt byte limit).

## Future: refresh tokens (not yet implemented)

When adding refresh tokens: rotate on every use, store only the hash, deliver via `httpOnly` cookie, use a separate secret, support server-side revocation. Design and document before implementing.
