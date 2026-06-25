---
paths:
  - "**/*"
---

# Coding Principles

## Objective

Keep code simple, cohesive, testable, predictable, and easy to evolve.

## Do

- Prefer the simplest solution that solves the current problem.
- Make the smallest change possible to fulfill the request.
- Preserve existing behavior when there is no explicit request for change.
- Apply KISS as the default.
- Apply YAGNI as the default.
- Apply DRY only for genuine duplication of a rule or concept.
- Apply the Single Responsibility Principle to functions, classes, modules, and files.
- Maintain low coupling and high cohesion.
- Separate domain, application, infrastructure, and interface responsibilities.
- Prefer composition over inheritance.
- Write explicit code instead of implicit or magic code.
- Use abstractions only when they reduce complexity.
- Follow the patterns already established in the project.
- Keep changes small and easy to review.
- Refactor only what is necessary to solve the problem.
- When refactoring, preserve observable behavior.
- Prefer inward-directed dependencies over external frameworks.
- Centralize business rules that represent the same concept.
- Remove dead code related to the change.
- Maintain compatibility with existing public contracts unless instructed otherwise.

## Don't

- Do not implement unsolicited future features.
- Do not create layers, interfaces, adapters, or factories without a concrete need.
- Do not apply DRY to code that merely looks similar but has different intent.
- Do not mix large refactoring with functional changes.
- Do not rewrite parts unrelated to the problem.
- Do not introduce a new pattern when the project already has a consistent solution.
- Do not create functions, classes, or modules with multiple responsibilities.
- Do not increase coupling between domain and infrastructure.
- Do not turn simple code into an overly generic structure.
- Do not hide important dependencies.
- Do not use global variables or shared state without a clear need.
- Do not duplicate business rules across multiple layers.
- Do not change public contracts without need or without updating usages.
- Do not ignore project conventions.
- Do not make premature optimizations.
- Do not leave important behavior implicit or hard to trace.

## Acceptance criteria

- The change is small, focused, and easy to review.
- The code follows the project's current style and architecture.
- The solution does not add complexity without a clear benefit.
- Each unit of code has a clear responsibility.
- Existing behavior has been preserved.
- The code can be understood by another developer without external explanation.
