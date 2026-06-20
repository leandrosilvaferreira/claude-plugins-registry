---
description: Quarkus coding standards and anti-patterns
paths:
  - "**/*.java"
---

# Java + Quarkus — Coding Standards

**Fontes:** andredesousa/quarkus-best-practices · quarkus.io/standards · Red Hat Developer docs

## Anti-padrões

| Proibido | Alternativa |
|----------|-------------|
| Lógica de negócio em `@Path` resource | Delegar 100% ao `@ApplicationScoped` service |
| Entidade JPA exposta no endpoint REST | DTO separado + MapStruct para mapeamento |
| Acesso a DB fora de repositório | Repository via `PanacheRepository<Entity>` |
| Secrets em `application.properties` commitado | Vault em produção; `.env` local não versionado |
| `mvn`/`gradle` global no CI | Sempre usar wrapper (`mvnw`/`gradlew`) |
| Estado mutável em beans CDI | `private final`, sem setters, `@ApplicationScoped` |
| 500 raw em exceptions não tratadas | `ExceptionMapper<Exception>` centralizado com `@Provider` |
| DDL manual no banco | Flyway ou Liquibase para migrations |
| RESTEasy blocking | `quarkus-resteasy-reactive` + Vert.x |

## Convenções

- Pacotes: `entity` · `repository` · `service` · `resource` · `config` · `mapper` · `exception`
- `@ApplicationScoped` para services (singleton CDI — não `@RequestScoped` sem motivo)
- Validação: Hibernate Validator (`@NotNull`, `@NotBlank`, `@Size`, `@Email`) nos DTOs de input
- Caching: `@CacheResult` via `quarkus-cache`; Redis/Hazelcast para distribuído
- Observabilidade: SmallRye Health (liveness/readiness) + SmallRye Metrics → Prometheus
- API docs: `quarkus-smallrye-openapi` gera Swagger UI automaticamente
- Profiles: `%dev`, `%test`, `%prod` no `application.properties`

## Tooling

- Testes JVM: `@QuarkusTest` · Native: `@QuarkusIntegrationTest`
- Continuous testing: `quarkus dev` detecta mudanças e re-roda testes afetados
- Checkstyle + SpotBugs + OWASP Dependency-Check na pipeline
- Native build: GraalVM `./mvnw package -Pnative`

## Especificações suportadas (Quarkus 3.x LTS)

CDI 4.1 · Jakarta Validation 3.1 · Jakarta Persistence 3.2 · JAX-RS 3.1 · MicroProfile Config 3.1 · MicroProfile Health 4.0 · MicroProfile Fault Tolerance 4.1 · OpenTelemetry 1.39
