---
paths:
  - "**/*"
---

# Domain-Driven Design

## Objective

Apply DDD pragmatically, keeping business rules isolated from frameworks, databases, external APIs, and infrastructure details.

## Do

- Model code using real concepts from the business domain.
- Use names that make sense to both business people and developers.
- Separate domain, application, infrastructure, and interface.
- Keep business rules inside the domain layer.
- Use entities when there is identity and lifecycle.
- Use Value Objects for immutable values with meaning in the domain.
- Use Aggregates to protect business invariants.
- Use Domain Services only when a rule does not naturally belong to an entity or Value Object.
- Use Application Services or Use Cases to orchestrate flows.
- Use Repositories as a persistence abstraction.
- Make the domain layer depend on abstractions, not implementations.
- Keep databases, ORMs, queues, HTTP, cache, and external services in the infrastructure layer.
- Keep business rule validations in the domain.
- Keep format, transport, and input validations in the interface or application layer.
- Prefer commands and methods that express business intent.
- Protect invariants inside the domain model itself.
- Use domain events when something relevant has happened in the business.
- Keep the domain testable without a database, network, framework, or container.
- Create factories only when object creation involves a relevant rule.
- Make the code reflect the language used in the business.

## Don't

- Do not put business rules in controllers, routes, resolvers, HTTP handlers, or visual components.
- Do not put business rules in repositories.
- Do not couple entities to ORMs, databases, frameworks, or serialization.
- Do not use generic technical names when a better domain name exists.
- Do not create anemic entities that only carry data and leave all rules in services.
- Do not create Domain Services for any simple function.
- Do not create Aggregates that are too large.
- Do not expose public setters that allow invariants to be broken.
- Do not let infrastructure directly call internal domain details.
- Do not model the domain based solely on database tables.
- Do not mix DTOs, domain entities, and persistence models without a clear need.
- Do not use DDD to create artificial layers in simple CRUDs.
- Do not create domain abstractions without real business rules.
- Do not duplicate business rules across domain, application, and interface.
- Do not treat external integration as part of the domain.
- Do not let use cases depend directly on framework details.

## Acceptance criteria

- The main business rule is outside controllers, routes, and repositories.
- The domain can be tested without a database or external services.
- Names represent real business concepts.
- Invariants are protected inside the domain.
- Infrastructure can be replaced with minimal impact on the domain.
- There are no extra layers without a concrete need.
