---
paths:
  - "**/*"
---

# Code Quality

## Objective

Ensure code is readable, consistent, safe to maintain, and ready for review.

## Do

- Use clear, semantic, and specific names.
- Name functions by what they do.
- Name variables by what they represent.
- Prefer small, focused functions.
- Prefer explicit returns.
- Handle errors clearly and traceably.
- Include useful context in error messages.
- Use logs to diagnose important flows.
- Log relevant events, external failures, and critical decisions.
- Keep comments only when they explain intent, a decision, or a non-obvious rule.
- Remove obsolete comments.
- Remove dead code.
- Remove unused imports, dependencies, and variables.
- Keep formatting consistent with the project.
- Keep files organized by responsibility.
- Avoid functions with too many parameters.
- Use named objects, types, or structures when parameters become ambiguous.
- Prefer explicit types when they improve clarity.
- Validate inputs at system boundaries.
- Keep behavior predictable and easy to debug.
- Update inline documentation when changing relevant behavior.
- Ensure the code is ready for code review.

## Don't

- Do not use generic names like data, info, item, obj, or manager without clear context.
- Do not write overly clever code.
- Do not suppress errors with an empty catch.
- Do not return null, false, or an empty string for an error without context.
- Do not use comments to explain confusing code that should be rewritten instead.
- Do not leave vague TODOs.
- Do not leave temporary console logs, prints, or debug statements.
- Do not mix formatting changes with functional changes.
- Do not create large files with multiple responsibilities.
- Do not create long functions with many levels of indentation.
- Do not duplicate significant blocks of logic.
- Do not introduce a heavy dependency to solve a simple problem.
- Do not perform critical parsing, validation, or transformation silently.
- Do not ignore relevant warnings.
- Do not change the project style without need.
- Do not leave code in a partially migrated state.
- Do not leave important behavior untested when a test policy exists.

## Acceptance criteria

- The code is readable and straightforward.
- Names reveal intent.
- Errors are handled explicitly.
- Logs help diagnose without generating excessive noise.
- There is no dead code, temporary debug output, or obsolete comments.
- The change is ready for review.
