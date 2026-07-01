---
description: Spring Boot coding standards and anti-patterns
paths:
  - "**/*.java"
---

# Java + Spring Boot — Coding Standards

**Sources:** JetBrains/junie-guidelines · Spring official docs

## Anti-patterns

| Forbidden | Alternative |
| --------- | ----------- |
| `@Autowired` on a field | Constructor injection (testable + immutable) |
| Business logic in `@Controller` / `@RestController` | Move to `@Service` |
| `@Transactional` in Controller | Only in `@Service` |
| JPA entity exposed directly in the API | Response DTO + MapStruct/ModelMapper |
| JPQL in scattered string literals | Spring Data derived queries or centralized `@Query` |
| `@Value` injecting individual configs | `@ConfigurationProperties` by prefix |
| N+1 queries | `JOIN FETCH` or `EntityGraph` |
| `Optional.get()` without `isPresent()` | `orElseThrow()` / `orElse()` |
| `new` to create managed beans | Let the container create via `@Bean` / `@Component` |
| `HttpSession` for application state | Redis / stateless JWT |

## Conventions

- `@RestController` = routing only + input validation + delegation to service
- `@Service` = all business logic + transactions
- `@Repository` = persistence operations only
- Input validation with `@Valid` + Bean Validation (`@NotNull`, `@Size`, etc.)
- Profiles: `application.yml` base + `application-{env}.yml` per environment
- Never commit secrets — use `${ENV_VAR}` in `application.yml`
- Tests: `@SpringBootTest` for integration · `@WebMvcTest` for isolated web layer · `@DataJpaTest` for repositories

## Tooling

- Actuator enabled in production (health, metrics)
- Micrometer + Prometheus for metrics
- Flyway or Liquibase for migrations
