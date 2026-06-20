---
description: Spring Boot coding standards and anti-patterns
paths:
  - "**/*.java"
---

# Java + Spring Boot — Coding Standards

**Fontes:** JetBrains/junie-guidelines · Spring official docs

## Anti-padrões

| Proibido | Alternativa |
|----------|-------------|
| `@Autowired` em campo | Constructor injection (testável + imutável) |
| Lógica de negócio em `@Controller` / `@RestController` | Mover para `@Service` |
| `@Transactional` em Controller | Apenas em `@Service` |
| Entidade JPA exposta diretamente na API | DTO de resposta + MapStruct/ModelMapper |
| JPQL em strings literais espalhadas | Spring Data derived queries ou `@Query` centralizado |
| `@Value` injetando configs individuais | `@ConfigurationProperties` por prefixo |
| Consultas N+1 | `JOIN FETCH` ou `EntityGraph` |
| `Optional.get()` sem `isPresent()` | `orElseThrow()` / `orElse()` |
| `new` para criar beans gerenciados | Deixar o container criar via `@Bean` / `@Component` |
| `HttpSession` para estado de aplicação | Redis / stateless JWT |

## Convenções

- `@RestController` = apenas roteamento + validação de entrada + delegação ao service
- `@Service` = toda lógica de negócio + transações
- `@Repository` = apenas operações de persistência
- Validação de input com `@Valid` + Bean Validation (`@NotNull`, `@Size`, etc.)
- Profiles: `application.yml` base + `application-{env}.yml` por ambiente
- Nunca commitar secrets — usar `${ENV_VAR}` no `application.yml`
- Testes: `@SpringBootTest` para integração · `@WebMvcTest` para camada web isolada · `@DataJpaTest` para repositórios

## Tooling

- Actuator habilitado em produção (health, metrics)
- Micrometer + Prometheus para métricas
- Flyway ou Liquibase para migrations
