# Coding Standards Rules por Stack — Plano de Implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Adicionar ao plugin regras de coding standards por linguagem/stack que são aplicadas automaticamente ao projeto-alvo de acordo com a stack detectada, com `paths:` no frontmatter limitando a ativação aos tipos de arquivo correspondentes.

**Architecture:** As regras ficam em `templates/rules/<stack>/coding-standards.md`. O pipeline existente (`selectProjectAssets` → `plan.mjs` → `applyPlan`) já suporta caminhos com subdiretório — a única mudança de código necessária é estender `PROJECT_BY_STACK` em `project-catalog.mjs`. Todo o restante é criação de conteúdo.

**Tech Stack:** Node ≥18, ESM `.mjs`, `node --test`, JSDoc. Nenhuma nova dependência.

## Global Constraints

- Arquivos de regra devem usar frontmatter `paths:` (não `globs:`) — consistente com `templates/rules/01-ddd.md`
- Stack keys são os mesmos de `lib/data/stack-keys.mjs` — nunca inventar novos
- `contextCost: 0` para todas as regras de stack (lazy/path-scoped)
- `defaultSelected: true` para todas
- Nunca modificar `plan.mjs` ou `apply.mjs` — o pipeline já suporta subdiretórios em `rules`
- Tabela "Proibido → Alternativa" é obrigatória em todo arquivo de regra
- Conteúdo em português (exceto termos técnicos e nomes de API)
- Cada arquivo de regra é **auto-contido** — sem herança entre stacks; se java-quarkus precisa de regras java, inclui ambas

---

## Mapa de Arquivos

### Criados (conteúdo)
- `templates/rules/typescript/coding-standards.md` — paths: `**/*.ts`, `**/*.tsx`
- `templates/rules/react/coding-standards.md` — paths: `**/*.tsx`, `**/*.jsx`
- `templates/rules/next/coding-standards.md` — paths: `**/*.ts`, `**/*.tsx`
- `templates/rules/vue/coding-standards.md` — paths: `**/*.vue`, `**/*.ts`
- `templates/rules/go/coding-standards.md` — paths: `**/*.go`
- `templates/rules/rust/coding-standards.md` — paths: `**/*.rs`
- `templates/rules/java/coding-standards.md` — paths: `**/*.java`
- `templates/rules/java-spring/coding-standards.md` — paths: `**/*.java`
- `templates/rules/java-quarkus/coding-standards.md` — paths: `**/*.java`
- `templates/rules/kotlin/coding-standards.md` — paths: `**/*.kt`, `**/*.kts`
- `templates/rules/python/coding-standards.md` — paths: `**/*.py`
- `templates/rules/django/coding-standards.md` — paths: `**/*.py`
- `templates/rules/fastapi/coding-standards.md` — paths: `**/*.py`
- `templates/rules/php/coding-standards.md` — paths: `**/*.php`
- `templates/rules/php-laravel/coding-standards.md` — paths: `**/*.php`
- `templates/rules/php-adianti/coding-standards.md` — paths: `**/*.php`
- `templates/rules/csharp/coding-standards.md` — paths: `**/*.cs`
- `templates/rules/cpp/coding-standards.md` — paths: `**/*.cpp`, `**/*.cc`, `**/*.h`, `**/*.hpp`
- `templates/rules/dart/coding-standards.md` — paths: `**/*.dart`

### Modificados
- `lib/data/project-catalog.mjs` — `PROJECT_BY_STACK`: adicionar `rules` para cada stack acima

### Testes
- `tests/project-catalog.test.mjs` — criar (ou estender se existir) com cobertura de `selectProjectAssets` para cada stack

---

## Task 1: Estender `project-catalog.mjs` + testes unitários

**Files:**
- Modify: `lib/data/project-catalog.mjs`
- Create/Modify: `tests/project-catalog.test.mjs`

**Interfaces:**
- Consumes: `stackKeys(profile)` de `stack-keys.mjs` — já existente
- Produces: `selectProjectAssets(profile).rules` inclui `"<stack>/coding-standards.md"` quando a stack for detectada

- [ ] **Passo 1: Verificar se test file existe**

```bash
ls tests/project-catalog.test.mjs 2>/dev/null && echo "existe" || echo "nao existe"
```

- [ ] **Passo 2: Escrever testes falhando**

Criar (ou substituir) `tests/project-catalog.test.mjs`:

```javascript
import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { selectProjectAssets } from '../lib/data/project-catalog.mjs';

/** @param {Partial<import('../lib/profile.mjs').ProjectProfile>} overrides */
function profile(overrides) {
  return {
    languages: [],
    packageManagers: [],
    frameworks: [],
    isMonorepo: false,
    hasVcs: true,
    commands: {},
    architecture: {},
    existing: {},
    ...overrides,
  };
}

describe('selectProjectAssets — coding standards rules', () => {
  it('typescript project includes typescript coding standards', () => {
    const result = selectProjectAssets(profile({ languages: ['typescript'] }));
    assert.ok(result.rules.includes('typescript/coding-standards.md'), `rules: ${result.rules}`);
  });

  it('react project includes react coding standards', () => {
    const result = selectProjectAssets(profile({ frameworks: ['react'] }));
    assert.ok(result.rules.includes('react/coding-standards.md'), `rules: ${result.rules}`);
  });

  it('next project includes next coding standards', () => {
    const result = selectProjectAssets(profile({ frameworks: ['next'] }));
    assert.ok(result.rules.includes('next/coding-standards.md'), `rules: ${result.rules}`);
  });

  it('vue project includes vue coding standards', () => {
    const result = selectProjectAssets(profile({ frameworks: ['vue'] }));
    assert.ok(result.rules.includes('vue/coding-standards.md'), `rules: ${result.rules}`);
  });

  it('go project includes go coding standards', () => {
    const result = selectProjectAssets(profile({ languages: ['go'] }));
    assert.ok(result.rules.includes('go/coding-standards.md'), `rules: ${result.rules}`);
  });

  it('rust project includes rust coding standards', () => {
    const result = selectProjectAssets(profile({ languages: ['rust'] }));
    assert.ok(result.rules.includes('rust/coding-standards.md'), `rules: ${result.rules}`);
  });

  it('java project includes java coding standards', () => {
    const result = selectProjectAssets(profile({ languages: ['java'] }));
    assert.ok(result.rules.includes('java/coding-standards.md'), `rules: ${result.rules}`);
  });

  it('java-spring project includes java-spring coding standards', () => {
    const result = selectProjectAssets(profile({ languages: ['java'], frameworks: ['spring-boot'] }));
    assert.ok(result.rules.includes('java-spring/coding-standards.md'), `rules: ${result.rules}`);
  });

  it('java-quarkus project includes java-quarkus coding standards', () => {
    const result = selectProjectAssets(profile({ languages: ['java'], frameworks: ['quarkus'] }));
    assert.ok(result.rules.includes('java-quarkus/coding-standards.md'), `rules: ${result.rules}`);
  });

  it('kotlin project includes kotlin coding standards', () => {
    const result = selectProjectAssets(profile({ languages: ['kotlin'] }));
    assert.ok(result.rules.includes('kotlin/coding-standards.md'), `rules: ${result.rules}`);
  });

  it('python project includes python coding standards', () => {
    const result = selectProjectAssets(profile({ languages: ['python'] }));
    assert.ok(result.rules.includes('python/coding-standards.md'), `rules: ${result.rules}`);
  });

  it('django project includes django coding standards', () => {
    const result = selectProjectAssets(profile({ languages: ['python'], frameworks: ['django'] }));
    assert.ok(result.rules.includes('django/coding-standards.md'), `rules: ${result.rules}`);
  });

  it('fastapi project includes fastapi coding standards', () => {
    const result = selectProjectAssets(profile({ languages: ['python'], frameworks: ['fastapi'] }));
    assert.ok(result.rules.includes('fastapi/coding-standards.md'), `rules: ${result.rules}`);
  });

  it('php project includes php coding standards', () => {
    const result = selectProjectAssets(profile({ languages: ['php'] }));
    assert.ok(result.rules.includes('php/coding-standards.md'), `rules: ${result.rules}`);
  });

  it('php-laravel project includes php-laravel coding standards', () => {
    const result = selectProjectAssets(profile({ languages: ['php'], frameworks: ['laravel'] }));
    assert.ok(result.rules.includes('php-laravel/coding-standards.md'), `rules: ${result.rules}`);
  });

  it('php-adianti project includes php-adianti coding standards', () => {
    const result = selectProjectAssets(profile({ languages: ['php'], frameworks: ['adianti'] }));
    assert.ok(result.rules.includes('php-adianti/coding-standards.md'), `rules: ${result.rules}`);
  });

  it('csharp project includes csharp coding standards', () => {
    const result = selectProjectAssets(profile({ languages: ['csharp'] }));
    assert.ok(result.rules.includes('csharp/coding-standards.md'), `rules: ${result.rules}`);
  });

  it('cpp project includes cpp coding standards', () => {
    const result = selectProjectAssets(profile({ languages: ['cpp'] }));
    assert.ok(result.rules.includes('cpp/coding-standards.md'), `rules: ${result.rules}`);
  });

  it('dart project includes dart coding standards', () => {
    const result = selectProjectAssets(profile({ languages: ['dart'] }));
    assert.ok(result.rules.includes('dart/coding-standards.md'), `rules: ${result.rules}`);
  });

  it('common rules always present regardless of stack', () => {
    const result = selectProjectAssets(profile({}));
    assert.ok(result.rules.includes('01-ddd.md'));
    assert.ok(result.rules.includes('05-testing.md'));
  });

  it('rules are deduped when multiple stacks share same rule', () => {
    // typescript + react both active → typescript/coding-standards.md appears once
    const result = selectProjectAssets(profile({ languages: ['typescript'], frameworks: ['react'] }));
    const tsRules = result.rules.filter(r => r === 'typescript/coding-standards.md');
    assert.strictEqual(tsRules.length, 1);
  });
});
```

- [ ] **Passo 3: Executar testes — verificar que FALHAM**

```bash
cd /path/to/aia_harness && node --test tests/project-catalog.test.mjs 2>&1 | head -50
```

Esperado: todos os testes falhando com `AssertionError` (rules não incluem os novos arquivos ainda).

- [ ] **Passo 4: Estender `PROJECT_BY_STACK` em `lib/data/project-catalog.mjs`**

Substituir o bloco `PROJECT_BY_STACK` (linhas 43-45) por:

```javascript
/**
 * First-party per-stack skills and rules. Key = stack key from stack-keys.mjs.
 * Skills must exist under templates/skills/<name>/.
 * Rules must exist under templates/rules/<path>.
 * @type {Record<string, AssetSet>}
 */
export const PROJECT_BY_STACK = {
  "typescript":    { agents: [], skills: [], rules: ["typescript/coding-standards.md"] },
  "react":         { agents: [], skills: [], rules: ["react/coding-standards.md"] },
  "vue":           { agents: [], skills: [], rules: ["vue/coding-standards.md"] },
  "go":            { agents: [], skills: [], rules: ["go/coding-standards.md"] },
  "rust":          { agents: [], skills: [], rules: ["rust/coding-standards.md"] },
  "java":          { agents: [], skills: [], rules: ["java/coding-standards.md"] },
  "java-spring":   { agents: [], skills: [], rules: ["java-spring/coding-standards.md"] },
  "java-quarkus":  { agents: [], skills: [], rules: ["java-quarkus/coding-standards.md"] },
  "kotlin":        { agents: [], skills: [], rules: ["kotlin/coding-standards.md"] },
  "python":        { agents: [], skills: [], rules: ["python/coding-standards.md"] },
  "django":        { agents: [], skills: [], rules: ["django/coding-standards.md"] },
  "fastapi":       { agents: [], skills: [], rules: ["fastapi/coding-standards.md"] },
  "php":           { agents: [], skills: [], rules: ["php/coding-standards.md"] },
  "php-laravel":   { agents: [], skills: [], rules: ["php-laravel/coding-standards.md"] },
  "php-adianti":   { agents: [], skills: ["adianti-framework"], rules: ["php-adianti/coding-standards.md"] },
  "csharp":        { agents: [], skills: [], rules: ["csharp/coding-standards.md"] },
  "cpp":           { agents: [], skills: [], rules: ["cpp/coding-standards.md"] },
  "dart":          { agents: [], skills: [], rules: ["dart/coding-standards.md"] },
};
```

> **Nota:** `next` não tem stack key própria em `stack-keys.mjs` — projetos Next.js retornam `typescript` + `react`. Portanto não há entrada `next` separada. Verificar `stack-keys.mjs` antes de prosseguir; se existir key `next`, adicionar entrada correspondente.

- [ ] **Passo 5: Executar testes — verificar que PASSAM**

```bash
node --test tests/project-catalog.test.mjs 2>&1
```

Esperado: todos os testes `ok`. Se algum falhar, o profile mock não está gerando o stack key correto — verificar `stack-keys.mjs` para entender quais campos do profile disparam cada key.

- [ ] **Passo 6: Executar suite completa**

```bash
npm test 2>&1 | tail -20
```

Esperado: typecheck + lint + unit passando. Se lint falhar por estilo, corrigir formatação.

- [ ] **Passo 7: Commit**

```bash
git add lib/data/project-catalog.mjs tests/project-catalog.test.mjs
git commit -m "feat(catalog): register coding-standards rules per stack in PROJECT_BY_STACK"
```

---

## Task 2: Regras JVM — Java, Java-Spring, Java-Quarkus, Kotlin

**Files:**
- Create: `templates/rules/java/coding-standards.md`
- Create: `templates/rules/java-spring/coding-standards.md`
- Create: `templates/rules/java-quarkus/coding-standards.md`
- Create: `templates/rules/kotlin/coding-standards.md`

**Sources:** Google Java Style Guide · JetBrains/junie-guidelines · andredesousa/quarkus-best-practices · quarkus.io/standards · kotlinlang.org/docs/coding-conventions

- [ ] **Passo 1: Criar `templates/rules/java/coding-standards.md`**

```markdown
---
description: Java coding standards and anti-patterns
paths:
  - "**/*.java"
---

# Java — Coding Standards

**Fontes:** Google Java Style Guide · JetBrains/junie-guidelines

## Anti-padrões

| Proibido | Alternativa |
|----------|-------------|
| `null` como valor sentinela | `Optional<T>` |
| Concatenação de `String` em loop | `StringBuilder` |
| `catch (Exception e)` genérico | Capturar exceção específica |
| Campos públicos em classes | Propriedades com getter/setter |
| `instanceof` sem cast seguro | Pattern matching `instanceof Foo f` (Java 16+) |
| Objetos mutáveis em `static final` | Objetos imutáveis ou `Collections.unmodifiable*` |
| `static import` excessivo | Import qualificado explícito |
| Lógica de negócio em construtores | Métodos factory ou injeção de dependência |
| Comentário que repete o código | Comentário que explica o POR QUÊ |
| Checked exceptions em APIs públicas | Unchecked exceptions com contexto |

## Convenções

- Nomenclatura: `PascalCase` classes · `camelCase` métodos/variáveis · `UPPER_SNAKE_CASE` constantes
- Um arquivo por classe pública de nível superior
- Interfaces não devem ter prefixo `I` — use sufixo descritivo (`Repository`, `Service`)
- Métodos com mais de 20 linhas: candidato a extração
- `final` em parâmetros e variáveis locais quando não reatribuídos
- Não usar raw types: `List` → `List<String>`
- Records Java (17+) para data classes imutáveis

## Tooling

- Checkstyle + PMD + SpotBugs na pipeline
- OWASP Dependency-Check para CVEs
- `@SuppressWarnings` apenas com comentário justificando
```

- [ ] **Passo 2: Criar `templates/rules/java-spring/coding-standards.md`**

```markdown
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
```

- [ ] **Passo 3: Criar `templates/rules/java-quarkus/coding-standards.md`**

```markdown
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
```

- [ ] **Passo 4: Criar `templates/rules/kotlin/coding-standards.md`**

```markdown
---
description: Kotlin coding standards and anti-patterns
paths:
  - "**/*.kt"
  - "**/*.kts"
---

# Kotlin — Coding Standards

**Fontes:** kotlinlang.org/docs/coding-conventions · Android Kotlin Style Guide

## Anti-padrões

| Proibido | Alternativa |
|----------|-------------|
| `!!` (not-null assertion) | Elvis `?:` ou safe call `?.` + tratamento explícito |
| Getters/setters estilo Java | Properties Kotlin (`val`/`var`) |
| Funções utility `static` em companion object | Extension functions |
| `if-else` como statement de atribuição | Expression form: `val x = if (...) a else b` |
| `for (i in 0..n-1)` | `for (i in 0 until n)` |
| `it` em lambdas com mais de uma linha | Parâmetro nomeado explícito |
| Data classes com campos mutáveis (`var`) | `val` + `copy()` para variantes |
| `when` sem `else` em sealed classes | Sempre cobrir todos os casos (o compilador exige em expression) |
| `lateinit var` para tipos primitivos | `var` com valor inicial ou `by lazy` |

## Convenções

- Nomenclatura: `PascalCase` classes · `camelCase` funções/variáveis · `UPPER_SNAKE_CASE` constantes
- Preferir `val` a `var` — imutabilidade por padrão
- `data class` para holders de dados; `sealed class` para ADTs
- Extension functions para funcionalidade utilitária — não polui a API do tipo original
- Corrotinas: `suspend fun` na camada de negócio; `viewModelScope`/`lifecycleScope` na camada de apresentação
- `object` para singletons — não `companion object` com estado
- KDoc em todas as funções públicas de API pública de biblioteca

## Tooling

- ktlint para formatação e estilo
- Detekt para análise estática
- `kotlinOptions { jvmTarget = "17" }` no build
```

- [ ] **Passo 5: Verificar que os arquivos existem**

```bash
ls templates/rules/java/coding-standards.md \
   templates/rules/java-spring/coding-standards.md \
   templates/rules/java-quarkus/coding-standards.md \
   templates/rules/kotlin/coding-standards.md
```

Esperado: todos os 4 listados sem erro.

- [ ] **Passo 6: Executar suite completa**

```bash
npm test 2>&1 | tail -10
```

Esperado: todos passando (typecheck ignora `templates/`).

- [ ] **Passo 7: Commit**

```bash
git add templates/rules/java/ templates/rules/java-spring/ templates/rules/java-quarkus/ templates/rules/kotlin/
git commit -m "feat(rules): add JVM coding standards (java, spring, quarkus, kotlin)"
```

---

## Task 3: Regras Python — Python, Django, FastAPI

**Files:**
- Create: `templates/rules/python/coding-standards.md`
- Create: `templates/rules/django/coding-standards.md`
- Create: `templates/rules/fastapi/coding-standards.md`

**Sources:** Google Python Style Guide · antigravity.codes/rules/python · JetBrains/junie-guidelines · zhanymkanov/fastapi-best-practices

- [ ] **Passo 1: Criar `templates/rules/python/coding-standards.md`**

```markdown
---
description: Python coding standards and anti-patterns
paths:
  - "**/*.py"
---

# Python — Coding Standards

**Fontes:** Google Python Style Guide · antigravity.codes/rules · PEP 8

## Anti-padrões

| Proibido | Alternativa |
|----------|-------------|
| `def f(x=[])` — mutable default argument | `def f(x=None): x = x or []` |
| `from module import *` | Imports explícitos nomeados |
| `except:` bare — captura tudo incluindo `KeyboardInterrupt` | `except SpecificException as e:` |
| Comparação com `is` para valores (`x is 1`) | `==` para valores; `is` apenas para identidade (`None`, singletons) |
| Concatenação de string em loop (`s += x`) | `"".join(iterable)` |
| `type(x) == int` para checagem de tipo | `isinstance(x, int)` |
| Variáveis de nome único fora de lambdas/loops curtos | Nomes descritivos |
| `print()` para debug em produção | `logging` com nível apropriado |
| Magic numbers inline | Constantes nomeadas |

## Convenções

- PEP 8: `snake_case` funções/variáveis · `PascalCase` classes · `UPPER_SNAKE_CASE` constantes
- f-strings para interpolação (Python 3.6+) — não `%` nem `.format()`
- Type hints em todas as assinaturas de função pública
- `pathlib.Path` em vez de `os.path` para manipulação de caminhos
- Context managers (`with`) para recursos — nunca fechar manualmente em `finally`
- List/dict/set comprehensions preferidos a loops manuais equivalentes
- Docstrings em todas as funções/classes públicas (Google style ou NumPy style)

## Tooling

- Ruff para lint + format (substitui black + isort + flake8)
- mypy ou pyright para tipagem estática
- pytest para testes
- `pyproject.toml` como único arquivo de configuração de tooling
```

- [ ] **Passo 2: Criar `templates/rules/django/coding-standards.md`**

```markdown
---
description: Django coding standards and anti-patterns
paths:
  - "**/*.py"
---

# Python + Django — Coding Standards

**Fontes:** JetBrains/junie-guidelines · Django official docs

## Anti-padrões

| Proibido | Alternativa |
|----------|-------------|
| Lógica de negócio na View | Model methods ou Service layer separado |
| Consultas N+1 | `select_related()` para FK · `prefetch_related()` para M2M |
| `settings.py` único para todos os ambientes | `django-environ` + `settings/base.py`, `settings/local.py`, `settings/prod.py` |
| SQL raw sem motivo | ORM Django; SQL apenas quando performance é crítica e documentado |
| `CharField` sem `max_length` | Sempre definir `max_length` |
| `BooleanField` com `null=True` | `default=False` sem null |
| Lógica em migrations | Migrations apenas para schema; dados via `RunPython` isolado |
| `User` importado diretamente | `get_user_model()` para compatibilidade com modelo customizado |
| Serializer sem validação explícita | `validate_<field>` e `validate()` em todos os serializadores DRF |
| Views sem permissão | `permission_classes` explícito em toda view DRF |

## Convenções

- Apps focados: cada app tem uma responsabilidade de domínio clara
- `models.py` > 200 LOC: dividir em `models/` package
- Signals apenas para cross-cutting concerns (auditoria, cache invalidation) — não para lógica de negócio
- `Meta.ordering` em modelos que sempre são listados em ordem específica
- `__str__` em todo modelo
- Migrations: nunca editar migration já aplicada em produção; criar nova

## Tooling

- `django-debug-toolbar` em desenvolvimento
- `django-extensions` para shell_plus e outros utilitários de dev
- `factory_boy` para fixtures de teste
- `pytest-django` em vez de `unittest` nativo
```

- [ ] **Passo 3: Criar `templates/rules/fastapi/coding-standards.md`**

```markdown
---
description: FastAPI coding standards and anti-patterns
paths:
  - "**/*.py"
---

# Python + FastAPI — Coding Standards

**Fonte:** zhanymkanov/fastapi-best-practices

## Anti-padrões

| Proibido | Alternativa |
|----------|-------------|
| `time.sleep()` / I/O bloqueante em `async def` route | Route síncrona (`def`) — FastAPI roda em threadpool automaticamente |
| Trabalho CPU-intensivo em route | `multiprocessing` ou Celery/Arq fora do processo |
| SDK síncrono em route `async def` | `await run_in_threadpool(client.method, ...)` |
| `BaseSettings` monolítica para todos os domínios | `BaseSettings` por domínio, desacoplada |
| `BackgroundTasks` para trabalho longo ou crítico | Celery/Arq — se a perda seria incidente, não use BackgroundTasks |
| Swagger/OpenAPI em produção | `openapi_url = None` fora de local/staging |
| Lógica de negócio no router | Service layer separado; router só recebe → delega → retorna |
| Monkeypatch em testes | `app.dependency_overrides` |
| `async_asgi_testclient` | `httpx` + `ASGITransport` |
| Migrations sem nome descritivo | `2024-01-15_add_post_content_idx.py` (data + slug) |

## Estrutura de Projeto

```
src/
└── <domínio>/
    ├── router.py       # endpoints only
    ├── schemas.py      # Pydantic models
    ├── models.py       # DB models
    ├── dependencies.py # Depends()
    ├── service.py      # business logic
    ├── exceptions.py
    └── constants.py
```

## Convenções

- Imports entre módulos: `from src.auth import constants as auth_constants` (sempre qualificado)
- DB naming: `lower_case_snake` · tabelas no singular (`post`, `user_playlist`) · `_at` datetime · `_date` date
- SQLAlchemy 2.0 async (`AsyncSession`, `async_sessionmaker`) em projetos novos
- Alembic migrations: estáticas e reversíveis
- `MetaData(naming_convention=...)` explícito para índices e constraints
- Pydantic: `BaseModel` customizado herdado por todos os schemas para serialização centralizada
- `@field_validator` que lança `ValueError` → retorna `422 ValidationError` estruturado ao cliente
- SQL-first: joins e agregações no banco, não em Python

## Tooling

- Ruff para lint + format
- `httpx` + `ASGITransport` para testes desde o dia 0
- Alembic para migrations
```

- [ ] **Passo 4: Verificar arquivos**

```bash
ls templates/rules/python/coding-standards.md \
   templates/rules/django/coding-standards.md \
   templates/rules/fastapi/coding-standards.md
```

- [ ] **Passo 5: Executar suite completa**

```bash
npm test 2>&1 | tail -10
```

- [ ] **Passo 6: Commit**

```bash
git add templates/rules/python/ templates/rules/django/ templates/rules/fastapi/
git commit -m "feat(rules): add Python ecosystem coding standards (python, django, fastapi)"
```

---

## Task 4: Regras JS/TS — TypeScript, React, Vue

**Files:**
- Create: `templates/rules/typescript/coding-standards.md`
- Create: `templates/rules/react/coding-standards.md`
- Create: `templates/rules/vue/coding-standards.md`

**Sources:** Google TypeScript Style Guide · google/gts · antigravity.codes · JetBrains/junie-guidelines (vue/nuxt) · Vercel/Next.js docs

> **Nota sobre Next.js:** Verificar se `stack-keys.mjs` retorna key `next` separada. Se retornar, criar `templates/rules/next/coding-standards.md` com as regras abaixo. Se Next.js retornar apenas `typescript`+`react`, omitir arquivo `next/` separado (regras já estarão nos outros dois).

- [ ] **Passo 1: Criar `templates/rules/typescript/coding-standards.md`**

```markdown
---
description: TypeScript coding standards and anti-patterns
paths:
  - "**/*.ts"
  - "**/*.tsx"
---

# TypeScript — Coding Standards

**Fontes:** Google TypeScript Style Guide · google/gts · antigravity.codes

## Anti-padrões

| Proibido | Alternativa |
|----------|-------------|
| `any` | Tipos explícitos, `unknown` com narrowing, generics |
| `Record<string, any>` | Interfaces específicas do domínio |
| Type assertion `as Foo` sem narrowing | Type guard `isFoo(x)` ou narrowing com `instanceof`/`in` |
| `// @ts-ignore` | `// @ts-expect-error` com comentário obrigatório |
| `==` para comparação | `===` sempre |
| `!` non-null assertion sem justificativa | Verificação explícita ou `?.` |
| Arquivo > 350 LOC | Dividir em módulos menores por responsabilidade |
| Magic strings repetidos | Constantes ou `as const` enum objects |
| `namespace` | Módulos ES (`import`/`export`) |
| `enum` numérico | `const` object com `as const` ou string union |

## Convenções

- `strict: true` no `tsconfig.json` — nunca desativar
- Path alias `@/*` para todos os imports internos
- `type` para unions/intersections · `interface` para objetos extensíveis
- Tipos derivados: `ReturnType<typeof fn>`, `Parameters<typeof fn>`, `Awaited<T>`
- Zod para validação runtime em boundaries externos (input de usuário, APIs externas)
- Funções públicas: sempre tipar return type explicitamente
- Generics: nome descritivo quando não óbvio (`TEntity`, não `T` para múltiplos type params)

## Tooling

- `tsc --noEmit` na pipeline (sem build step = verificação pura)
- ESLint + `@typescript-eslint` com config strict
- Prettier ou Biome para formatação
```

- [ ] **Passo 2: Criar `templates/rules/react/coding-standards.md`**

```markdown
---
description: React coding standards and anti-patterns
paths:
  - "**/*.tsx"
  - "**/*.jsx"
---

# React — Coding Standards

**Fontes:** Airbnb React Style Guide · antigravity.codes · React official docs

## Anti-padrões

| Proibido | Alternativa |
|----------|-------------|
| Inline functions em JSX em componentes que re-renderizam muito | Extrair + `useCallback` quando há dependentes do referencial |
| `key={index}` em listas dinâmicas | IDs estáveis do dado |
| `useEffect` para lógica síncrona derivada de estado | Estado derivado calculado inline ou `useMemo` |
| Prop drilling > 2 níveis | Context, Zustand, ou Jotai |
| Estado duplicado (mesmo dado em dois `useState`) | Fonte única de verdade; derivar o restante |
| Mutação direta de estado | Sempre criar novo objeto/array |
| Componente > 250 LOC | Extrair sub-componentes ou custom hooks |
| `any` nos tipos de props | Interfaces explícitas |
| Lógica de negócio dentro do componente | Custom hook (`use<Nome>`) |
| `document.querySelector` em componente React | `useRef` |

## Convenções

- Componentes: `PascalCase` · Custom hooks: `useCamelCase`
- Props interface nomeada `<ComponentName>Props`
- `export default` apenas para componentes de página; demais: named exports
- Composição sobre herança — nunca `extends` em componentes
- `memo()` apenas quando profiling confirmar problema de re-render
- Acessibilidade: todo elemento interativo tem `aria-label` ou texto visível

## Tooling

- `eslint-plugin-react` + `eslint-plugin-react-hooks`
- `eslint-plugin-jsx-a11y` para acessibilidade
- React DevTools Profiler para medir antes de otimizar
```

- [ ] **Passo 3: Criar `templates/rules/vue/coding-standards.md`**

```markdown
---
description: Vue/Nuxt coding standards and anti-patterns
paths:
  - "**/*.vue"
  - "**/*.ts"
---

# Vue / Nuxt — Coding Standards

**Fonte:** JetBrains/junie-guidelines (vue/nuxt) · Vue 3 official docs

## Anti-padrões

| Proibido | Alternativa |
|----------|-------------|
| Options API em código novo | Composition API com `<script setup>` |
| `$emit` sem definição tipada | `defineEmits<{ 'event': [payload: Type] }>()` |
| Props sem tipos | `defineProps<{ nome: string; ativo: boolean }>()` |
| Mutação direta de prop | Emit evento de mudança para o pai |
| `v-if` + `v-for` no mesmo elemento | `v-if` no elemento pai ou computed para filtrar |
| `ref` para objetos complexos reativos | `reactive()` para objetos; `ref()` para primitivos e quando precisa de `.value` explícito |
| Lógica de negócio no componente | Composable `use<Nome>.ts` |
| `any` em `defineProps` / `defineEmits` | Tipos explícitos TypeScript |
| `watch` para efeitos síncronos derivados | `computed` |

## Convenções (Nuxt)

- `pages/` para rotas; `components/` para reutilizáveis; `composables/` para lógica compartilhada
- Auto-import: Nuxt importa automaticamente de `composables/` e `components/` — não precisam de import manual
- `useFetch` / `useAsyncData` para data fetching em SSR — não `fetch` manual em `onMounted`
- `useState` do Nuxt para estado compartilhado entre server e client
- Server routes em `server/api/` — não misturar com lógica de componente
- `app.config.ts` para configuração pública; `runtimeConfig` para segredos

## Tooling

- Volar (Vue Language Features) no editor
- `vue-tsc` para typecheck de `.vue`
- ESLint + `eslint-plugin-vue` com config `vue3-recommended`
```

- [ ] **Passo 4: Verificar se stack key `next` existe e criar arquivo se necessário**

```bash
grep -n "next\|Next" /path/to/aia_harness/lib/data/stack-keys.mjs
```

Se retornar um stack key `"next"`, criar `templates/rules/next/coding-standards.md`:

```markdown
---
description: Next.js coding standards and anti-patterns
paths:
  - "**/*.ts"
  - "**/*.tsx"
---

# Next.js — Coding Standards

**Fontes:** Vercel/Next.js official docs · nextjs.org

## Anti-padrões

| Proibido | Alternativa |
|----------|-------------|
| `"use client"` desnecessário no topo | Server Components por padrão; client apenas para interatividade |
| `<img>` HTML nativo | `next/image` para otimização automática |
| Fontes sem `next/font` | `next/font` elimina layout shift e auto-otimiza |
| `fetch` sem política de cache | Definir `cache: 'force-cache'`, `'no-store'` ou `revalidate` explicitamente |
| `useSearchParams` fora de `<Suspense>` | Envolver em `<Suspense fallback={...}>` |
| Dados buscados em Client Component que poderiam ser Server | Mover fetch para Server Component e passar como prop |
| Route Handler retornando dados que uma Server Action faria | Server Actions para mutações; Route Handlers para APIs externas |
| `getServerSideProps` (Pages Router) em código novo | App Router com Server Components |
| `cookies()`/`headers()` em componente de layout raiz | Dynamic functions apenas onde necessário |

## Convenções

- `app/` router (App Router) em projetos novos — não Pages Router
- Layout: `layout.tsx` compartilhado · `page.tsx` por rota · `loading.tsx` e `error.tsx` por segmento
- Metadata: `export const metadata` ou `generateMetadata()` em cada `page.tsx`
- Imagens: sempre definir `width` e `height` no `<Image>` ou usar `fill` com container posicionado
- Variáveis de ambiente: `NEXT_PUBLIC_` apenas para o que deve ir ao client; demais ficam server-only
- Middleware em `middleware.ts` na raiz — não em `app/`

## Tooling

- `next lint` (ESLint config embutida) na pipeline
- `@next/bundle-analyzer` para inspecionar bundle
- Vercel Speed Insights + Web Analytics para métricas de produção
```

- [ ] **Passo 5: Verificar arquivos**

```bash
ls templates/rules/typescript/coding-standards.md \
   templates/rules/react/coding-standards.md \
   templates/rules/vue/coding-standards.md
```

- [ ] **Passo 6: Suite completa**

```bash
npm test 2>&1 | tail -10
```

- [ ] **Passo 7: Commit**

```bash
git add templates/rules/typescript/ templates/rules/react/ templates/rules/vue/
git commit -m "feat(rules): add JS/TS ecosystem coding standards (typescript, react, vue)"
```

---

## Task 5: Regras Systems — Go, Rust, C++

**Files:**
- Create: `templates/rules/go/coding-standards.md`
- Create: `templates/rules/rust/coding-standards.md`
- Create: `templates/rules/cpp/coding-standards.md`

**Sources:** uber-go/guide · mre/idiomatic-rust · Rust RFC 2436 · isocpp/CppCoreGuidelines · Google C++ Style Guide

- [ ] **Passo 1: Criar `templates/rules/go/coding-standards.md`**

```markdown
---
description: Go coding standards and anti-patterns
paths:
  - "**/*.go"
---

# Go — Coding Standards

**Fontes:** uber-go/guide · Google Go Style Guide

## Anti-padrões

| Proibido | Alternativa |
|----------|-------------|
| `panic` em código de negócio | Retornar `error` |
| Erros sem contexto (`return err`) | `fmt.Errorf("operation X: %w", err)` |
| Ponteiro quando valor zero tem semântica útil | Tipo por valor; ponteiro apenas quando nil tem significado |
| Mutex sem os campos que protege | Agrupar mutex + campos em struct dedicada |
| Goroutine sem rastreamento de lifecycle | `sync.WaitGroup` ou canal de sinalização |
| `init()` com lógica complexa ou efeitos colaterais | Injeção de dependência explícita |
| Nomes abreviados ilegíveis (`rdr`, `mgr`) | Nomes claros; abreviações padrão OK (`buf`, `err`, `id`) |
| `interface{}` / `any` onde tipo concreto serve | Tipo concreto; `any` só em boundaries genéricos reais |
| Copiar struct com Mutex | Passar ponteiro para struct com Mutex |
| Goroutine leak (goroutine sem forma de parar) | Context com cancel; select com done channel |

## Convenções

- Erros: valores sentinela (`var ErrNotFound = errors.New(...)`) para erros esperados; tipos de erro para contexto rico
- Nomeação: `MixedCaps`; interfaces de um método: sufixo `-er` (`Reader`, `Stringer`)
- Pacotes: nome curto, singular, sem underscore (`userservice` não `user_service`)
- Testes em mesmo pacote com sufixo `_test.go`; testes de integração em `_test` package separado
- `defer` para cleanup de recursos sempre
- Estrutura de projeto: `cmd/` binários · `internal/` código não-exportável · `pkg/` biblioteca pública

## Tooling

- `gofmt` / `goimports` obrigatório (sem exceção)
- `golangci-lint` com configuração de equipe
- `go vet` na pipeline
- `go test -race ./...` para detectar race conditions
```

- [ ] **Passo 2: Criar `templates/rules/rust/coding-standards.md`**

```markdown
---
description: Rust coding standards and anti-patterns
paths:
  - "**/*.rs"
---

# Rust — Coding Standards

**Fontes:** mre/idiomatic-rust · Rust API Guidelines · Rust RFC 2436

## Anti-padrões

| Proibido | Alternativa |
|----------|-------------|
| `unwrap()` / `expect()` em código de produção | `?` operator + tratamento explícito de erro |
| `clone()` desnecessário | Referências / lifetimes corretos |
| `String` em parâmetros que não precisam de ownership | `&str` — mais flexível e sem alocação |
| Loops manuais onde iterators resolvem | Iterators + combinators (`map`, `filter`, `collect`) |
| `match` com braço `_` cobrindo variantes não examinadas | Cobrir variantes explicitamente; `_` apenas com comentário |
| `pub` em campos de struct sem invariante clara | Métodos de acesso; `pub` em campos apenas em data structs simples |
| Panic em bibliotecas | `Result<T, E>` em toda função que pode falhar em lib |
| `Box<dyn Error>` para erros em biblioteca | Tipo de erro customizado ou `thiserror` |
| Tipos `Arc<Mutex<T>>` em código single-thread | `Rc<RefCell<T>>` ou reestruturar para evitar interior mutability |

## Convenções

- Nomeação: `snake_case` funções/variáveis · `PascalCase` tipos/traits · `UPPER_SNAKE_CASE` constantes
- `clippy` é a lei — warnings do clippy são erros na pipeline
- Erros: `thiserror` para bibliotecas · `anyhow` para binários/aplicações
- Traits: implementar `Debug`, `Display`, `Clone`, `PartialEq` onde faz sentido
- Lifetimes: nomear lifetimes descritivamente em APIs públicas complexas (`'a` apenas em casos simples)
- Documentação: `///` em toda função pública; exemplos que compilam em `/// # Examples`
- `#[must_use]` em funções que retornam `Result` ou valores que não devem ser ignorados

## Tooling

- `rustfmt` obrigatório (sem exceção — config em `rustfmt.toml`)
- `clippy -- -D warnings` na pipeline
- `cargo test` + `cargo test --doc` (testa exemplos de documentação)
- `cargo audit` para CVEs nas dependências
```

- [ ] **Passo 3: Criar `templates/rules/cpp/coding-standards.md`**

```markdown
---
description: C++ coding standards and anti-patterns
paths:
  - "**/*.cpp"
  - "**/*.cc"
  - "**/*.h"
  - "**/*.hpp"
---

# C++ — Coding Standards

**Fontes:** isocpp/CppCoreGuidelines (Stroustrup + Sutter) · Google C++ Style Guide

## Anti-padrões

| Proibido | Alternativa |
|----------|-------------|
| `new`/`delete` manual | RAII + `std::unique_ptr` / `std::shared_ptr` |
| Raw pointers para ownership | `unique_ptr`; raw pointer apenas para observação não-owning |
| Arrays C-style `T arr[N]` | `std::array<T, N>` (tamanho fixo) ou `std::vector<T>` |
| `NULL` ou `0` para ponteiro nulo | `nullptr` |
| `#define` para constantes | `constexpr` |
| `using namespace std` em headers | Qualificação explícita `std::` |
| Cast C-style `(int)x` | `static_cast<int>(x)`, `reinterpret_cast`, `const_cast` conforme semântica |
| Exceção em destrutor | `noexcept` em destructors; capturar exceções internamente |
| Cópia acidental de objetos grandes | Passar por `const&`; move semantics onde ownership transfere |
| `std::endl` em performance-sensitive code | `'\n'` — `std::endl` faz flush desnecessário |

## Convenções

- Nomeação: `PascalCase` classes · `snake_case` funções/variáveis · `kPascalCase` constantes (Google) ou `UPPER_SNAKE_CASE` (isocpp)
- Prefer `const` e `constexpr` — imutabilidade por padrão
- Regra dos zero: se não precisa de destrutor/cópia/move customizados, não declare
- Regra dos cinco: se precisa de um, declare todos os cinco (`destrutor`, `copy ctor`, `copy assign`, `move ctor`, `move assign`)
- Headers: include guards com `#pragma once` ou `#ifndef`; nunca definir variáveis em headers
- Ordenação de includes: próprios · bibliotecas de terceiros · STL (Google style)
- `[[nodiscard]]` em funções cujo retorno não deve ser ignorado

## Tooling

- `clang-format` com configuração de equipe
- `clang-tidy` para análise estática
- AddressSanitizer (`-fsanitize=address`) em builds de teste
- `valgrind` ou `heaptrack` para profiling de memória
- CMake como build system; nunca commitar arquivos gerados
```

- [ ] **Passo 4: Verificar e rodar testes**

```bash
ls templates/rules/go/coding-standards.md \
   templates/rules/rust/coding-standards.md \
   templates/rules/cpp/coding-standards.md && npm test 2>&1 | tail -10
```

- [ ] **Passo 5: Commit**

```bash
git add templates/rules/go/ templates/rules/rust/ templates/rules/cpp/
git commit -m "feat(rules): add systems languages coding standards (go, rust, cpp)"
```

---

## Task 6: Regras Restantes — PHP, C#, Dart

**Files:**
- Create: `templates/rules/php/coding-standards.md`
- Create: `templates/rules/php-laravel/coding-standards.md`
- Create: `templates/rules/php-adianti/coding-standards.md`
- Create: `templates/rules/csharp/coding-standards.md`
- Create: `templates/rules/dart/coding-standards.md`

**Sources:** PSR-12 (PHP-FIG) · Laravel docs · templates/skills/adianti-framework/SKILL.md (anti-patterns já extraídos) · Microsoft .NET Coding Conventions · dart.dev/effective-dart · Flutter style guide

- [ ] **Passo 1: Criar `templates/rules/php/coding-standards.md`**

```markdown
---
description: PHP coding standards and anti-patterns
paths:
  - "**/*.php"
---

# PHP — Coding Standards

**Fonte:** PSR-12 (PHP-FIG) · PHP 8.x official docs

## Anti-padrões

| Proibido | Alternativa |
|----------|-------------|
| Tag de fechamento `?>` em arquivo PHP puro | Omitir — evita whitespace acidental |
| Mix de tabs e espaços | 4 espaços (PSR-12) |
| `array()` syntax | Sintaxe curta `[]` (PHP 5.4+) |
| Funções sem type hints | Type hints em parâmetros e retorno (PHP 8+) |
| `isset()` para verificar array key em loop | `array_key_exists()` quando `null` é valor válido |
| `@` para suprimir erros | Tratar o erro corretamente |
| String concatenation em loop (`$s .= $x`) | `implode()` ou array + join final |
| `extract()` | Desestruturação explícita ou acesso por chave |
| `global $var` | Injeção de dependência |
| Funções longas (> 30 linhas) sem extração | Métodos menores com responsabilidade única |

## Convenções

- PSR-12: `PascalCase` classes · `camelCase` métodos · `snake_case` variáveis · `UPPER_SNAKE_CASE` constantes
- `declare(strict_types=1)` no topo de todo arquivo
- `readonly` para propriedades imutáveis (PHP 8.1+)
- Named arguments para clareza em chamadas com muitos parâmetros
- `match` em vez de `switch` para expressões (PHP 8.0+)
- Enums nativos (PHP 8.1+) em vez de classes de constantes

## Tooling

- PHP-CS-Fixer ou Pint (Laravel) para formatação
- PHPStan (nível 8+) ou Psalm para análise estática
- Composer para gerenciamento de dependências
```

- [ ] **Passo 2: Criar `templates/rules/php-laravel/coding-standards.md`**

```markdown
---
description: Laravel coding standards and anti-patterns
paths:
  - "**/*.php"
---

# PHP + Laravel — Coding Standards

**Fontes:** Laravel official docs · laravel-best-practices community

## Anti-padrões

| Proibido | Alternativa |
|----------|-------------|
| Lógica de negócio em Route closure | Controller dedicado |
| `DB::table()` direto onde Eloquent resolve | Eloquent Model |
| Controller gordo com validação inline | Form Request (`php artisan make:request`) para validação |
| Autorização inline no controller | Policies (`php artisan make:policy`) |
| SQL hard-coded em string | Query Builder ou Eloquent |
| `dd()` / `dump()` commitado | Nunca commitar debug helpers |
| `->get()` sem eager loading em loop | `->with('relation')` antes do `->get()` |
| Config hard-coded no código | `config('app.valor')` + `.env` |
| Sem Factory para models de teste | `php artisan make:factory` para todos os models |
| `User::all()` em contexto paginado | `User::paginate()` |

## Convenções

- Artisan: usar make commands para tudo — nunca criar classe manualmente
- Eloquent: `$fillable` ou `$guarded` explícito em todo model
- Relacionamentos: nomear métodos em camelCase (`hasMany`, `belongsTo`)
- Observers para lógica reativa a eventos de model
- Jobs para trabalho assíncrono; Queues para processamento em background
- Events + Listeners para desacoplamento entre domínios
- `__()` / `trans()` para todas as strings visíveis ao usuário (i18n desde o início)

## Tooling

- Laravel Pint (zero-config) para formatação
- Larastan (PHPStan para Laravel) nível 8+ na pipeline
- `php artisan test` ou Pest para testes
```

- [ ] **Passo 3: Criar `templates/rules/php-adianti/coding-standards.md`**

Conteúdo extraído diretamente de `templates/skills/adianti-framework/SKILL.md`:

```markdown
---
description: Adianti Framework PHP coding standards and anti-patterns
paths:
  - "**/*.php"
---

# PHP + Adianti Framework — Coding Standards

**Fonte:** aia-harness/templates/skills/adianti-framework (first-party)

## Anti-padrões

| Proibido | Alternativa |
|----------|-------------|
| Acesso a model fora de transação | Sempre envolver em `TTransaction::open/close` |
| `SELECT *` via PDO raw | `TRecord::getObjects()` ou `TRepository::load()` |
| Não chamar `addAttribute()` para uma coluna | Coluna não persiste — registrar todos os atributos |
| `new TMessage()` em catch sem rollback | Sempre chamar `TTransaction::rollback()` no catch |
| Esquecer `$this->form->validate()` antes de salvar | Salva dados inválidos/incompletos |
| Nome de database hard-coded | `$this->setDatabase('name')` / config-driven |
| Lógica de negócio na classe de view/form | Métodos de model ou service classes |
| AJAX callbacks como métodos de instância | Devem ser `public static` para AJAX |
| Não chamar `$this->datagrid->createModel()` | DataGrid não renderiza colunas |
| Esquecer `parent::add($container)` | Página renderiza em branco |
| Classe não registrada em menu.xml ou allowed classes | Página não acessível |

## Padrões por objetivo

| Objetivo | Padrão |
|----------|--------|
| Listar registros com busca + paginação | `TStandardList` trait em `TPage` |
| Criar/Editar/Excluir um registro | `TStandardForm` trait em `TPage` |
| Lista + formulário na mesma página | `TStandardFormList` trait em `TPage` |
| Registro master + linhas de detalhe inline | Master-detail manual em `TPage` |
| Popup lookup/busca | Classe `TWindow` seek com `TForm::sendData()` |
| Detalhe read-only em painel lateral | `setTargetContainer('adianti_right_panel')` |
| Formulário em modal | Estender `TWindow`, encapsular classe de form |
| Many-to-many tags | `TDBCheckGroup` + `saveAggregate()` |
| Linhas inline dinâmicas | `TFieldList` + `saveComposite()` |
| Combos em cascata | `setChangeAction()` + `TCombo::reload()` |
| Upload de arquivo | `TFile` + `AdiantiFileSaveTrait::saveFile()` |

## Convenções

- Todo controller estende `TPage`; janelas estendem `TWindow`
- Ações referenciadas em `TAction` devem ser `public`; callbacks AJAX devem ser `public static`
- `TAction`: `['ClassName', 'methodName']` para static · `[$this, 'methodName']` para instance
- Models: sempre definir `TABLENAME`, `PRIMARYKEY`, `IDPOLICY` como constantes
- `addAttribute()` obrigatório para todo campo que deve ser persistido
```

- [ ] **Passo 4: Criar `templates/rules/csharp/coding-standards.md`**

```markdown
---
description: C# .NET coding standards and anti-patterns
paths:
  - "**/*.cs"
---

# C# / .NET — Coding Standards

**Fonte:** Microsoft .NET Coding Conventions · docs.microsoft.com

## Anti-padrões

| Proibido | Alternativa |
|----------|-------------|
| `var` para tipos não-óbvios na inicialização | Tipo explícito para clareza |
| `catch (Exception e)` genérico | Capturar exceção específica |
| Campos públicos em classes | Propriedades com getter/setter |
| `String.Format("x={0}", x)` | String interpolation `$"x={x}"` |
| Evento invocado sem verificação null | Operador null-conditional `evento?.Invoke(...)` |
| `Task` não aguardado (`async void` sem motivo) | `async Task` e sempre `await` |
| `if (x == null)` para tipos de referência modernos | Pattern matching `if (x is null)` |
| LINQ com side effects em predicados | Side effects fora do LINQ |
| `Thread.Sleep()` em async code | `await Task.Delay()` |
| Dispor objetos `IDisposable` manualmente | `using` statement / `using` declaration |

## Convenções

- Nomenclatura: `PascalCase` classes/métodos/propriedades · `camelCase` variáveis locais/parâmetros · `_camelCase` campos privados · `I<Nome>` interfaces
- `readonly` para campos que não mudam após construção
- `record` para data classes imutáveis (C# 9+)
- Nullable reference types habilitado (`<Nullable>enable</Nullable>`)
- `async`/`await` até a raiz — nunca `.Result` ou `.Wait()` em código async (deadlock)
- LINQ: preferencialmente syntax de método; query syntax para joins complexos

## Tooling

- Roslyn Analyzers na pipeline (`<TreatWarningsAsErrors>true</TreatWarningsAsErrors>`)
- StyleCop.Analyzers para estilo
- `dotnet format` para formatação
- `dotnet test` com cobertura via `coverlet`
```

- [ ] **Passo 5: Criar `templates/rules/dart/coding-standards.md`**

```markdown
---
description: Dart/Flutter coding standards and anti-patterns
paths:
  - "**/*.dart"
---

# Dart / Flutter — Coding Standards

**Fontes:** dart.dev/effective-dart · flutter.dev/docs/development/style · Flutter repo style guide

## Anti-padrões

| Proibido | Alternativa |
|----------|-------------|
| `dynamic` sem motivo | Tipos explícitos |
| `setState` para lógica de negócio complexa | Provider / Riverpod / Bloc |
| `print()` em produção | `debugPrint()` (respeitado pelo framework) ou logger |
| Widget monolítico de 300+ linhas | Extrair em widgets menores com responsabilidade única |
| `FutureBuilder` sem estado de loading/error | Tratar `ConnectionState.waiting` e erro explicitamente |
| `!` (null assertion) sem verificação prévia | `?.` safe call ou `if (x != null)` |
| Importar `dart:io` diretamente em widget | Abstrair atrás de interface/service |
| `const` omitido onde possível | Sempre usar `const` para widgets imutáveis (melhora performance) |
| `context.read()` no build | `context.read()` apenas em callbacks; `context.watch()` no build |

## Convenções (Dart)

- `lowerCamelCase` funções/variáveis · `UpperCamelCase` tipos · `lowercase_with_underscores` arquivos e pacotes
- Preferir `final` a `var` — imutabilidade por padrão
- `late` apenas quando inicialização lazy é necessária e valor nunca será null
- `extension` para adicionar métodos a tipos existentes sem herança
- Docstrings com `///` para toda API pública

## Convenções (Flutter)

- Estrutura: `lib/features/<feature>/{presentation,domain,data}/`
- Widgets: `StatelessWidget` por padrão; `StatefulWidget` apenas quando estado local é inevitável
- `Key` em listas dinâmicas de widgets
- `Theme.of(context)` para cores e estilos — nunca hard-code
- Imagens: `assets/images/` com `pubspec.yaml` declarando assets

## Tooling

- `dart format` (formatador oficial, zero config)
- `dart analyze` com `analysis_options.yaml` rigoroso
- `flutter_lints` ou `very_good_analysis` como base
- `flutter test` + `integration_test` package
```

- [ ] **Passo 6: Verificar todos os arquivos**

```bash
ls templates/rules/php/coding-standards.md \
   templates/rules/php-laravel/coding-standards.md \
   templates/rules/php-adianti/coding-standards.md \
   templates/rules/csharp/coding-standards.md \
   templates/rules/dart/coding-standards.md
```

- [ ] **Passo 7: Suite completa**

```bash
npm test 2>&1 | tail -10
```

- [ ] **Passo 8: Commit**

```bash
git add templates/rules/php/ templates/rules/php-laravel/ templates/rules/php-adianti/ \
        templates/rules/csharp/ templates/rules/dart/
git commit -m "feat(rules): add PHP, C#, Dart/Flutter coding standards rules"
```

---

## Task 7: Teste de Integração end-to-end

**Files:**
- Test: `node bin/harness.mjs plan <dir>` em projetos reais/fixture

**Objetivo:** Verificar que o pipeline completo detecta stack → inclui regra de coding standards → plan inclui artifact correto.

- [ ] **Passo 1: Verificar fixtures de teste existentes**

```bash
ls tests/fixtures/ 2>/dev/null || echo "sem fixtures"
```

Se existirem fixtures, usá-las. Caso contrário, criar diretório temporário mínimo:

```bash
mkdir -p /tmp/test-ts-project && cat > /tmp/test-ts-project/package.json << 'EOF'
{ "name": "test", "dependencies": { "typescript": "^5.0.0" } }
EOF
touch /tmp/test-ts-project/tsconfig.json
```

- [ ] **Passo 2: Rodar plan em projeto TypeScript e verificar regra presente**

```bash
node bin/harness.mjs plan /tmp/test-ts-project --json 2>/dev/null \
  | node -e "const d=JSON.parse(require('fs').readFileSync(0,'utf8')); \
    const r = d.artifacts.find(a => a.relPath?.includes('typescript/coding-standards')); \
    console.log(r ? 'PASS: ' + r.relPath : 'FAIL: typescript/coding-standards.md nao encontrado')"
```

Esperado: `PASS: .claude/rules/typescript/coding-standards.md`

- [ ] **Passo 3: Rodar plan em projeto Python FastAPI e verificar ambas as regras**

```bash
mkdir -p /tmp/test-fastapi && cat > /tmp/test-fastapi/requirements.txt << 'EOF'
fastapi>=0.100.0
uvicorn
EOF
node bin/harness.mjs plan /tmp/test-fastapi --json 2>/dev/null \
  | node -e "const d=JSON.parse(require('fs').readFileSync(0,'utf8')); \
    const rules = d.artifacts.filter(a => a.relPath?.includes('coding-standards')).map(a=>a.relPath); \
    console.log('Rules:', rules)"
```

Esperado: lista incluindo `.claude/rules/python/coding-standards.md` e `.claude/rules/fastapi/coding-standards.md`

- [ ] **Passo 4: Verificar que regras comuns (01-ddd.md etc.) ainda estão presentes**

```bash
node bin/harness.mjs plan /tmp/test-ts-project --json 2>/dev/null \
  | node -e "const d=JSON.parse(require('fs').readFileSync(0,'utf8')); \
    const common = d.artifacts.filter(a => a.relPath?.match(/01-ddd|05-testing/)).map(a=>a.relPath); \
    console.log(common.length >= 2 ? 'PASS: common rules presentes' : 'FAIL: ' + JSON.stringify(common))"
```

- [ ] **Passo 5: Suite completa final**

```bash
npm test 2>&1
```

Esperado: typecheck ✓ lint ✓ unit tests (incluindo os novos de project-catalog) ✓

- [ ] **Passo 6: Commit final**

```bash
git add tests/
git commit -m "test(integration): verify coding-standards rules appear in plan output per stack"
```

---

## Self-Review

**Cobertura do spec:**
- ✅ Regras por linguagem com `paths:` no frontmatter — coberto em Tasks 2-6
- ✅ Catalog registration para cada stack — coberto em Task 1
- ✅ Seleção automática por stack detectada — via `selectProjectAssets` existente (sem mudança no pipeline)
- ✅ Aplicação no projeto-alvo — via `applyPlan` existente (sem mudança)
- ✅ Testes unitários — Task 1
- ✅ Teste de integração — Task 7

**Stacks sem cobertura (lacunas aceitas neste plano):**
- `mobile` (React Native/Expo) — sem fonte canônica identificada; omitido intencionalmente
- `games` (Unity/Godot/Unreal/Bevy) — sem fonte canônica; omitido intencionalmente

**Verificação `next` stack key:** Task 4 Passo 4 instrui verificar `stack-keys.mjs` antes de criar o arquivo — comportamento correto.

**Sem placeholders:** Cada arquivo de regra tem conteúdo completo com tabela de anti-padrões, convenções e tooling.
