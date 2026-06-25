---
paths:
  - “**/*”
---

# Design Patterns

## Objective

Use design patterns only when they reduce real complexity, improve extensibility, or decrease coupling.

## Do

- Prefer straightforward code when the problem is simple.
- Use patterns only when there is a concrete need.
- Let the problem structure implicitly justify the pattern.
- Use Strategy when there are interchangeable variations of behavior.
- Use Factory when object creation involves a rule, variation, or complexity.
- Use Adapter when you need to isolate an external API, SDK, framework, or service.
- Use Repository to abstract persistence, not to hide business rules.
- Use Dependency Injection to reduce coupling and improve testability.
- Use Observer or events when multiple parts need to react to an occurrence.
- Use Specification when combinable rules become complex.
- Use Decorator when you need to add behavior without modifying the original object.
- Use Facade when you need to simplify a complex integration.
- Use Command when an action needs to be represented, validated, queued, or audited.
- Keep the pattern implementation simple and readable.
- Use explicit names that reveal the pattern's intent.
- Prefer composition over inheritance when possible.
- Preserve consistency with the patterns already used in the project.
- Remove patterns that no longer deliver benefit.

## Don't

- Do not apply a pattern in anticipation of future needs.
- Do not use a pattern just to make the code look “more architectural”.
- Do not create interfaces with a single implementation without a clear reason.
- Do not create factories for simple constructors.
- Do not create generic abstractions before real variation exists.
- Do not use deep inheritance to solve simple problems.
- Do not hide execution flow behind too many layers.
- Do not use Repository as a place for business rules.
- Do not use Service as a generic dump for any logic.
- Do not create generic managers, helpers, or utils without clear responsibility.
- Do not use events when a direct call is clearer.
- Do not use Strategy when a simple conditional is sufficient and stable.
- Do not complicate tests because of an unnecessary pattern.
- Do not modify the entire architecture to fit a pattern.
- Do not mix multiple patterns without need.
- Do not sacrifice readability to follow a theoretical structure.

## Acceptance criteria

- The pattern solves a real problem in the current code.
- The solution became simpler to maintain, test, or extend.
- The flow remains easy to understand.
- No unnecessary layers, interfaces, or classes were created.
- There is consistency with the rest of the project.
