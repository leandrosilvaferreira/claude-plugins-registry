---
description: Jest unit test conventions for NestJS services — layout, mocking, and coverage bar
paths:
  - "src/**/*.spec.ts"
---

# Testing — Jest

**Applies to**: Unit tests in `*.spec.ts` next to source files

## Layout

- Spec files: `*.spec.ts` co-located with source (`src/<feature>/<feature>.service.spec.ts`).
- Jest config: `testRegex: .*\.spec\.ts$`, `rootDir: src`. Path alias `@/` → `src/` if configured.

## Wiring DI

Use `@nestjs/testing`:

```ts
const moduleRef = await Test.createTestingModule({
  providers: [
    SomeService,
    { provide: DRIZZLE, useValue: mockDb },
    { provide: JwtService, useValue: mockJwt },
  ],
}).compile();
const service = moduleRef.get(SomeService);
```

Never hit real infrastructure (DB, external APIs, JWT signing) in unit tests.

## Mocking Drizzle

Override the `DRIZZLE` symbol token with a plain object exposing the methods the unit calls:

```ts
const mockDb = {
  query: { users: { findFirst: jest.fn().mockResolvedValue(undefined) } },
  insert: jest.fn().mockReturnThis(),
  values: jest.fn().mockReturnThis(),
  returning: jest.fn().mockResolvedValue([{ id: '1' }]),
};
```

## One behavior per test

Cover success AND failure paths:

- Invalid credentials → `UnauthorizedException`
- Duplicate email → `ConflictException`
- Missing record → `NotFoundException`
- Expired / malformed token → rejection

## What to test

- Services' business logic and every thrown exception branch.
- Skip framework glue (module wiring, DI configuration itself).
- New business logic ships with at least unhappy-path tests before commit.

## Coverage bar

Grow coverage with each change rather than in a big later pass. If you add a new exception branch, add the test that triggers it in the same diff.
