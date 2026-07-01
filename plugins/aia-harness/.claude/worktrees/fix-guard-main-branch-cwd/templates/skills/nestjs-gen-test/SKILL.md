---
name: nestjs-gen-test
description: Guides writing Jest unit tests for NestJS services and controllers using @nestjs/testing and mocked Drizzle DB. Use when adding or expanding unit tests.
---

# NestJS Generate Test

Invoke when writing or expanding Jest unit tests for NestJS services or controllers.

## Conventions

- Test files: `*.spec.ts` next to the source file (`src/<feature>/<feature>.service.spec.ts`).
- Use `@nestjs/testing` `Test.createTestingModule` to wire DI — never construct services with `new`.
- Mock the Drizzle DB by overriding the `DRIZZLE` symbol token (from `src/database/database.module`).
- Mock `bcrypt` and `@nestjs/jwt` in auth tests — never hash or sign for real in tests.
- One behavior per `it`. Cover success AND failure paths: invalid credentials, duplicate user, missing record, expired token.

## Template

```ts
import { Test } from '@nestjs/testing';
import { DRIZZLE } from './database/database.module';
import { SomeService } from './some.service';

describe('SomeService', () => {
  let service: SomeService;
  const db = {
    query: { users: { findFirst: jest.fn().mockResolvedValue(undefined) } },
    insert: jest.fn().mockReturnThis(),
    values: jest.fn().mockReturnThis(),
    returning: jest.fn().mockResolvedValue([{ id: '1' }]),
  };

  beforeEach(async () => {
    const moduleRef = await Test.createTestingModule({
      providers: [
        SomeService,
        { provide: DRIZZLE, useValue: db },
      ],
    }).compile();
    service = moduleRef.get(SomeService);
  });

  it('does the thing', async () => {
    await expect(service.doThing()).resolves.toBeDefined();
  });
});
```

For services with additional dependencies (e.g., `JwtService`, `ConfigService`), add each as `{ provide: Token, useValue: mockValue }` in the providers array.

## What to test

- Services' business logic and every thrown exception branch.
- Skip framework glue (module wiring, DI configuration itself).
- New business logic ships with at least unhappy-path tests before commit.
