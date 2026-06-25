---
description: Quarkus coding standards and anti-patterns
paths:
  - "**/*.java"
---

# Java + Quarkus — Coding Standards

**Sources:** andredesousa/quarkus-best-practices · quarkus.io/standards · Red Hat Developer docs

## Anti-patterns

| Forbidden | Alternative |
| --------- | ----------- |
| Business logic in `@Path` resource | Delegate 100% to `@ApplicationScoped` service |
| JPA entity exposed in the REST endpoint | Separate DTO + MapStruct for mapping |
| DB access outside a repository | Repository via `PanacheRepository<Entity>` |
| Secrets in committed `application.properties` | Vault in production; local `.env` not versioned |
| Global `mvn`/`gradle` in CI | Always use wrapper (`mvnw`/`gradlew`) |
| Mutable state in CDI beans | `private final`, no setters, `@ApplicationScoped` |
| Raw 500 on unhandled exceptions | Centralized `ExceptionMapper<Exception>` with `@Provider` |
| Manual DDL on the database | Flyway or Liquibase for migrations |
| RESTEasy blocking | `quarkus-resteasy-reactive` + Vert.x |

## Conventions

- Packages: `entity` · `repository` · `service` · `resource` · `config` · `mapper` · `exception`
- `@ApplicationScoped` for services (CDI singleton — not `@RequestScoped` without reason)
- Validation: Hibernate Validator (`@NotNull`, `@NotBlank`, `@Size`, `@Email`) on input DTOs
- Caching: `@CacheResult` via `quarkus-cache`; Redis/Hazelcast for distributed caching
- Observability: SmallRye Health (liveness/readiness) + SmallRye Metrics → Prometheus
- API docs: `quarkus-smallrye-openapi` generates Swagger UI automatically
- Profiles: `%dev`, `%test`, `%prod` in `application.properties`

## Tooling

- JVM tests: `@QuarkusTest` · Native: `@QuarkusIntegrationTest`
- Continuous testing: `quarkus dev` detects changes and re-runs affected tests
- Checkstyle + SpotBugs + OWASP Dependency-Check in the pipeline
- Native build: GraalVM `./mvnw package -Pnative`

## Supported specifications (Quarkus 3.x LTS)

CDI 4.1 · Jakarta Validation 3.1 · Jakarta Persistence 3.2 · JAX-RS 3.1 · MicroProfile Config 3.1 · MicroProfile Health 4.0 · MicroProfile Fault Tolerance 4.1 · OpenTelemetry 1.39
