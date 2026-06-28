---
name: nestjs-pr-check
description: Local pre-PR gate for NestJS projects. Runs lint, typecheck, tests, and build, then triggers the appropriate reviewer agent. Use before opening a pull request.
---

# NestJS PR Check

Invoke when the branch should be verified as PR-ready. Substitutes for CI in projects that do not have it yet.

Find the exact commands in the root `CLAUDE.md`.

## Gate (stop at first failure, report PASS/FAIL per step)

1. **Lint**
   ```bash
   npm run lint
   ```

2. **Typecheck**
   ```bash
   npm run typecheck
   ```

3. **Tests**
   ```bash
   npm run test
   ```
   Flag if new business logic has no unhappy-path test coverage.

4. **Build**
   ```bash
   npm run build
   ```
   Catches issues that `--noEmit` misses.

5. **Review the diff** (`git diff main...HEAD`):
   - Touched `src/auth`, `src/users`, env handling, or any new endpoint → invoke `nestjs-security-reviewer`.
   - Other NestJS / Drizzle code → invoke `nestjs-code-reviewer`.
   - Resolve all Critical and High findings before opening the PR.

6. **Contract sync** — if a DTO or endpoint changed, confirm the zod schema and Swagger decorators were updated in the same diff.

## Output format

```
✅ lint      ✅ typecheck   ✅ test (N passed)
✅ build     ⚠️ review: 1 medium finding   ✅ contract
```

Lint / typecheck / test / build failures are hard FAILs — fix before PR.
Review findings: surface with `file:line`; the user decides whether to fix or accept.
Do not push or open the PR unless explicitly asked.
