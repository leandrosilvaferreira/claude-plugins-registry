---
paths:
  - "**/*"
---

# Testing

## Objective

Maintain a strong testing policy, ensuring safety to evolve the system without breaking existing behavior.

## Do

- Write tests for every relevant business rule.
- Write tests for every bug fixed.
- Write tests before or alongside the functional change.
- Prioritize unit tests for pure rules and domain decisions.
- Use integration tests for databases, queues, cache, simulated external APIs, and connected modules.
- Use end-to-end tests only for critical user or business flows.
- Keep tests fast, deterministic, and easy to run.
- Test behavior, not internal implementation details.
- Cover success, error, and edge cases.
- Cover validations, permissions, invalid states, and conditional rules.
- Use test names that describe the expected behavior.
- Use fixtures, builders, or test factories when they reduce repetition.
- Use mocks only for external boundaries or slow dependencies.
- Prefer explicit, easy-to-understand test data.
- Ensure isolation between tests.
- Avoid dependency on execution order.
- Avoid dependency on the current time, real network, or real external services.
- When you need the current time, use an injectable clock or equivalent mechanism.
- When you need external services, use a fake, stub, mock, or controlled environment.
- Update existing tests when the expected behavior changes.
- Remove or fix obsolete tests.
- Run the relevant suite before considering the task complete.
- If tests cannot be run, clearly state the reason and the risk.
- For critical code, include regression tests.
- For integrations, test failures, timeouts, invalid responses, and retries where applicable.

## Don't

- Don't deliver a functional change without a test when the project allows testing.
- Don't create brittle tests coupled to internal implementation.
- Don't test only the happy path.
- Don't mock everything.
- Don't make tests depend on a real database, network, or filesystem unnecessarily.
- Don't leave slow tests in the wrong layer.
- Don't ignore failing tests.
- Don't delete a failing test without understanding the behavior it protects.
- Don't reduce business rule coverage.
- Don't create generic assertions that don't validate real behavior.
- Don't share mutable state between tests.
- Don't leave intermittent (flaky) tests.
- Don't depend on fixed dates that break over time.
- Don't use sleeps in tests except under extreme necessity.
- Don't add large snapshots without clear value.
- Don't hide setup complexity that makes maintenance harder.

## Acceptance criteria

- Every changed business rule has a test.
- Every fixed bug has a regression test.
- Tests cover success, error, and relevant edge cases.
- Tests are deterministic and can run repeatedly.
- The relevant suite passes.
- Tests validate observable behavior, not internal details.
