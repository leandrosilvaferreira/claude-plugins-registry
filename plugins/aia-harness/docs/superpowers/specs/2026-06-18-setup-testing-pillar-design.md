# Pilar de Testes Unitários — detectar gap, sugerir e configurar por stack

**Data:** 2026-06-18
**Status:** Aprovado (design) — pendente plano de implementação
**Surface afetada:** engine (`lib/`), skill distribuída (`templates/skills/`), comandos (`init`, `doctor`)

## 1. Contexto e problema

O harness trata testes como pilar, mas hoje só sabe **rodar** testes, não **semeá-los**:

- `lib/detect/commands.mjs` deriva um comando `test` por ecossistema — porém retorna o **default do ecossistema mesmo sem framework instalado** (ex.: `pytest` sempre para Python, `go test ./...` sempre). Logo `commands.test != null` **não** significa que o projeto tem testes.
- `lib/data/frameworks.mjs` já classifica frameworks de teste (`category: "test"`: Vitest/Jest/Mocha/Pest/PHPUnit/Playwright/Cypress) — dá para saber se um framework de teste é dependência.
- Já existem: skill `run-tests` (roda o comando), regra `05-testing.md`, skill `pre-commit-verify`.
- `lib/detect/existing.mjs` detecta harness existente, **não** detecta presença de testes.

**Gap:** quando o harness é aplicado a um projeto **sem testes unitários**, nada detecta essa ausência, recomenda um framework por stack, nem oferece configurá-lo.

## 2. Objetivo

Ao aplicar o harness a um projeto sem testes unitários:

1. **Sugerir** (sempre): diagnosticar a ausência e nomear o framework recomendado para a stack — visível em `scan`, `doctor` e no `CLAUDE.md` gerado.
2. **Configurar** (com consentimento): instalar o framework, escrever **1 teste unitário real** em um módulo existente, fiar o script `test` e **rodar até passar verde**.

## 3. Decisões travadas (brainstorming)

| # | Decisão | Escolha |
|---|---|---|
| 1 | Teto de ação | **Scaffold + instalar + rodar verde** (testes que realmente rodam) |
| 2 | Entregável / o que é "verde" | **Infra + 1 teste real** em módulo existente bem escolhido; **fallback smoke** se nenhum módulo servir |
| 3 | Política de recomendação | **Default único por stack, overridável** (tabela §7) |

Decisões menores assumidas:

1. Skill `setup-testing` embarcada **sempre** (lazy, custo de contexto 0), como `run-tests`/`lint-fix` — não só quando há gap. Permite bootstrapar testes em pacote novo depois.
2. Oferta na `init` = **passo 5.7**, após o enrich (5.5), antes do review (6).
3. `CLAUDE.md`: nota **aditiva** após o bloco de comandos — não altera o comportamento atual de `commandsBlock`.

## 4. Abordagem escolhida (A) e rejeitadas

**A — Engine detecta+recomenda (determinístico), skill configura (agêntico).** Escolhida.
Divide na fronteira do determinismo, alinhado a "lib pura, IO nas bordas":
- Engine: detecção do gap + recomendação opinativa + surfacing em scan/doctor/CLAUDE.md/plan. Puro e testável.
- Skill `setup-testing`: instala + escreve teste real + itera até verde. Agência é intrínseca ("rodar até verde" não cabe em engine puro).

**B — Engine scaffolda configs templated por stack + script de install.** Rejeitada: configs estáticas quebram (paths, ESM/CJS, monorepo, versões); muitos templates para manter; "verde" ainda exige skill.

**C — Skill pura, zero engine.** Rejeitada: perde o pilar **sugerir** (gap some de scan/doctor/CLAUDE.md); sem catálogo opinativo consistente; duplica lógica de stack que o engine já tem.

## 5. Arquitetura — componentes

| Módulo | Responsabilidade | Natureza |
|---|---|---|
| `lib/detect/testing.mjs` (novo) | `detectTesting(profile, files)` → `TestingInfo`. Decide se o projeto **já usa testes**. | puro (lê a lista de arquivos já coletada + profile; zero IO novo) |
| `lib/data/testing-catalog.mjs` (novo) | `recommendTesting(profile)` → `TestingRecipe \| null`. Tabela opinativa única (framework/install/config/glob/alternativas). | puro |
| `lib/profile.mjs` | `+TestingInfo` typedef; `+testing` em `ProjectProfile`. | type-only |
| `lib/detect/index.mjs` | chama `detectTesting(...)` e anexa ao profile. | borda (já lê) |
| `lib/generate/claude-md.mjs` | quando `!configured`: nota aditiva após comandos recomendando framework + `/setup-testing`. | puro |
| `lib/plan.mjs` | `notes.push(...)` quando há gap. | puro |
| `bin/harness.mjs` (scan report) | linha "Unit tests: ✓ Pest" ou "✗ none — recomendado: Pest". | borda |
| `templates/skills/setup-testing/SKILL.md` (novo) | **o doer** agêntico: install + teste real + verde. | skill distribuída |
| `lib/data/project-catalog.mjs` | registra `setup-testing` em `PROJECT_COMMON.skills` (obrigatório por CLAUDE.md). | catálogo |
| `commands/init.md` | passo 5.7: oferta pós-apply quando gap. | comando |
| `commands/doctor.md` | menciona o gap no relatório (detecção via scan já cobre). | comando |

> `testing-catalog.mjs` é catálogo de **decisão** (como `mcp-catalog`/`frameworks`/`languages`), **não** catálogo de asset distribuível → **não** entra no barrel `asset-catalog.mjs`. Apenas a skill `setup-testing` (sob `templates/`) entra em `project-catalog.mjs` (regra de manutenção do CLAUDE.md).

## 6. Tipos de dados

`lib/profile.mjs`:

```js
/**
 * @typedef {Object} TestingInfo
 * @property {boolean} configured     Projeto já usa testes (framework dep OU arquivos OU script declarado).
 * @property {string|null} framework  Framework de teste detectado (nome de frameworks.mjs category "test"), ou null.
 * @property {boolean} hasTestFiles   Arquivos de teste encontrados via glob por ecossistema.
 * @property {boolean} hasTestScript  Script `test` DECLARADO (não o default do ecossistema).
 * @property {string|null} recommended Framework recomendado quando !configured (de testing-catalog), ou null.
 * @property {boolean} installNeeded  Recomendado exige instalar dep (false p/ built-in: go/rust/node:test).
 * @property {string} evidence        Texto curto explicando a conclusão.
 */
```

`lib/data/testing-catalog.mjs`:

```js
/**
 * @typedef {Object} TestingRecipe
 * @property {string} framework        Nome canônico (ex.: "Vitest", "Pest", "pytest").
 * @property {string} ecosystem        js|php|python|go|rust|jvm|ruby|dotnet
 * @property {string[]} installDeps    Dev-deps a instalar ([] quando built-in).
 * @property {boolean} installNeeded   false quando built-in/já-no-starter.
 * @property {string|null} install     Comando de install já resolvido com o PM do profile.
 * @property {string|null} configFile  Arquivo de config esperado (ex.: "vitest.config.ts"), ou null.
 * @property {string} testGlob         Convenção de localização/nomenclatura dos testes.
 * @property {string[]} alternatives   Alternativas overridáveis (ex.: ["Jest","node:test"]).
 * @property {string} notes            Observações p/ a skill (ex.: "jsdom p/ componentes").
 */
```

## 7. Catálogo de recomendação (`TESTING_BY_STACK`)

Chaveado por stack-key (reusa `stackKeys(profile)`), com fallback por ecossistema. **Default único** (negrito); `alternatives` alimenta o override.

| stack-key | framework | installDeps | installNeeded | configFile | testGlob | alternatives |
|---|---|---|---|---|---|---|
| `typescript` (Vite presente) | **Vitest** | `vitest` | sim | `vitest.config.ts` | `src/**/*.test.ts` | Jest, node:test |
| `typescript` (sem Vite) | **node:test** | — | não | — | `test/**/*.test.mjs` | Vitest, Jest |
| `react` | **Vitest + Testing Library** | `vitest @testing-library/react @testing-library/jest-dom jsdom` | sim | `vitest.config.ts` (env jsdom) | `src/**/*.test.tsx` | Jest+RTL |
| `vue` | **Vitest + @vue/test-utils** | `vitest @vue/test-utils jsdom` | sim | `vitest.config.ts` | `src/**/*.test.ts` | — |
| `php-laravel` | **Pest** | `pestphp/pest` (+ `php artisan pest:install`) | sim | (Pest scaffolda) | `tests/` | PHPUnit |
| `php`, `php-adianti` | **PHPUnit** | `phpunit/phpunit` | sim | `phpunit.xml` | `tests/**/*Test.php` | Pest |
| `python` | **pytest** | `pytest` | sim | `pytest.ini` ou `[tool.pytest]` | `test_*.py` / `*_test.py` | unittest |
| `django` | **pytest + pytest-django** | `pytest pytest-django` | sim | `pytest.ini` (DJANGO_SETTINGS_MODULE) | `tests/test_*.py` | Django TestCase |
| `fastapi` | **pytest + httpx** | `pytest httpx` | sim | `pytest.ini` | `test_*.py` | — |
| `go` | **testing (built-in)** | — | não | — | `*_test.go` | testify |
| `rust` | **built-in `#[test]`** | — | não | — | `#[cfg(test)]` / `tests/` | — |
| `java-spring` | **JUnit 5** (spring-boot-starter-test) | (normalmente já presente) | não* | — | `src/test/java/**/*Test.java` | — |
| `java-quarkus` | **JUnit 5 + @QuarkusTest** (quarkus-junit5) | (normalmente já presente) | não* | — | `src/test/java/**/*Test.java` | — |
| `csharp` | **xUnit** | `xunit xunit.runner.visualstudio` | sim | — | `*Tests.cs` | NUnit |
| ruby (rails) | **RSpec** | `rspec-rails` (+ `rails g rspec:install`) | sim | `.rspec` / `spec/` | `spec/**/*_spec.rb` | Minitest |

`*` JVM: a skill verifica se a dependência de teste já existe (starter); só adiciona se faltar.

**Resolução do framework (js):** dentro do stack-key `typescript`, `recommendTesting` inspeciona `profile.frameworks` — Vite presente → Vitest; React/Vue → Vitest + libs respectivas; nenhum bundler → node:test. Demais ecossistemas resolvem direto pelo stack-key.

**Resolução do comando de install:** `recommendTesting` monta `install` a partir de `installDeps` + PM do profile:
- js: `npm i -D <deps>` / `pnpm add -D` / `yarn add -D` / `bun add -d` (reusa a lógica de `jsRunner`/install de `commands.mjs`).
- php: `composer require --dev <deps>`. python: `pip install -U <deps>` (ou adicionar a `pyproject`/`requirements`). ruby: `bundle add ... --group "development, test"`. dotnet: `dotnet add package <deps>`.
- built-in → `install = null`, `installNeeded = false`.

## 8. Detecção (`detectTesting`)

Assinatura: `detectTesting(profile, files)` — recebe o profile já montado (sem o campo `testing`) e a lista de arquivos coletada por `lib/util/fs.mjs`. Lê `profile.frameworks`/`profile.commands`/`profile.primaryLanguage`. Puro e unit-testável.

```
hasFrameworkDep = frameworks.some(f => f.category === "test")
hasTestScript   = !!commands.raw?.test          // script DECLARADO, não o default do ecossistema
hasTestFiles    = files.some(matchesTestGlob)    // glob por ecossistema (abaixo)
configured      = hasFrameworkDep || hasTestFiles || hasTestScript
framework       = primeiro frameworks test (nome), senão null
recommended/installNeeded = !configured ? recommendTesting(profile) : (null/false)
```

Globs de teste por ecossistema:

| Ecossistema | Padrões |
|---|---|
| js/ts | `*.test.{js,ts,jsx,tsx,mjs,cjs}`, `*.spec.*`, `__tests__/` |
| php | `*Test.php`, `tests/`, `phpunit.xml`(.dist) |
| python | `test_*.py`, `*_test.py`, `conftest.py`, `tests/` |
| go | `*_test.go` |
| jvm | `src/test/java/`, `*Test.java`, `*Tests.java`, `*Spec.groovy` |
| ruby | `spec/`, `*_spec.rb`, `test/`, `*_test.rb` |
| dotnet | `*Tests.cs`, `*Test.cs` |
| rust | `tests/`, `#[cfg(test)]` (limitação §12) |

Wiring em `lib/detect/index.mjs`: montar o profile **sem** `testing`, depois `profile.testing = detectTesting(profile, files)` antes do `return`. Como `detectTesting` recebe o profile montado, ele chama `recommendTesting(profile)` internamente quando `!configured` (stack-keys já resolvem — `primaryLanguage`/`frameworks` estão setados). Hoje `index.mjs` monta tudo num único `return`; trocar para `const profile = {...}` + atribuição de `testing` + `return profile`.

## 9. Surfacing (pilar "sugerir")

- **scan report** (`bin/harness.mjs`): linha de testes — `✓ <framework>` quando configurado, `✗ none — recomendado: <X>` quando não.
- **CLAUDE.md** (`renderRootClaudeMd`): quando `!configured`, **nota aditiva** após `commandsBlock`, ex.: `_Sem testes unitários ainda — recomendado: Vitest. Rode `/setup-testing` para semear._`. Não altera o `commandsBlock` existente.
- **plan notes** (`buildPlan`): `notes.push("Sem testes detectados — recomendado <X>; skill setup-testing embarcada.")` quando gap.
- **doctor**: relatório já roda scan; menciona o gap explicitamente.

## 10. Skill `setup-testing` (pilar "configurar")

`templates/skills/setup-testing/SKILL.md` — frontmatter `name: setup-testing`, `description` cobrindo gatilhos ("configurar testes", "setup tests", "semear testes", "não tem testes"). SKILL.md único com **tabela por-stack** (config + padrão de teste), espelhando a tabela de enrichment da `init`.

Passos:

1. **Determina o framework**: lê o recomendado do `CLAUDE.md` (ou arg explícito). Confirma com o dev — **overridável** (dev pode escolher alternativa).
2. **Instala** o framework (comando do catálogo; pula se built-in: go/rust/node:test). **Confirma antes de instalar** (ação de máquina, não só escrita de arquivo).
3. **Escreve config** (vitest.config / phpunit.xml / pytest.ini / etc.), adaptando ESM/CJS/paths reais.
4. **Escolhe 1 módulo puro/baixa-dependência** (util/helper/domínio determinístico, poucos imports, sem IO) e escreve **1 teste unitário genuíno** cobrindo seu comportamento. **Sem módulo adequado → smoke test** (piso garantido).
5. **Fia o script `test`** (`package.json`/`composer.json`) se faltar.
6. **Roda** o comando de teste. **Itera até verde** (corrige paths/config/imports). **Nunca alega verde sem rodar e ver a saída.**
7. **Reporta**: o que instalou, o arquivo de teste criado, e a saída verde.

Fronteira de autoridade: o **catálogo** decide "qual framework" (e o `CLAUDE.md` o carrega); a **skill** decide "como configurar" (conteúdo de config + padrão do teste). Sobreposição mínima (apenas o nome do framework).

## 11. Wiring na `init` (passo 5.7)

Entre 5.5 (enrich) e 6 (review), **se `profile.testing.configured === false`**:

- `AskUserQuestion` (single-select): _"Este projeto não tem testes unitários. Configurar agora? Recomendado: `<framework>`."_ — opções: **"Sim, configurar"** / **"Sim, mas escolher outro framework"** / **"Não, depois"**.
- "Sim" → invoca a skill `setup-testing` (que executa install+scaffold+verde, com a confirmação de install do passo 2).
- "Não" → skill permanece embarcada (dormant) para `/setup-testing` posterior.
- Se `configured === true`, pular o passo silenciosamente.

## 12. Escopo

**Dentro (v1):** unit testing; 1 teste real (fallback smoke); ecossistemas que o engine já detecta (js/ts, php, python, go, rust, jvm, ruby, dotnet); pacote raiz/primário.

**Fora (follow-up, declarado):**
- Seed por-pacote em monorepo (v1 mira raiz/primário).
- Adicionar o comando `test` ao Stop hook strict (mantém o Stop rápido e fail-open; tests podem ser lentos/flaky/precisar serviços).
- Suíte completa / threshold de coverage / wiring de CI.
- E2E/integração (Playwright/Cypress) — este pilar é **unit**.

## 13. Riscos e mitigações

| Risco | Mitigação |
|---|---|
| Teste "real" gerado incorreto/frágil | Escolher módulo puro/determinístico; rodar até verde; reportar o arquivo para revisão; fallback smoke. |
| Detecção de teste inline em Rust imperfeita (`#[cfg(test)]`) | Aceitar falso-negativo; detectar `tests/` quando presente; documentar limitação. |
| File-walk truncado (cap) pode perder arquivos de teste | Já existe `profile.truncated`; quando truncado, ser conservador na conclusão "sem testes" e sinalizar incerteza. |
| Install falha (rede/PM/permissões) | Skill confirma antes de instalar; em falha, reporta o comando exato para o dev rodar e segue sem alegar verde. |
| `commandsBlock` mostra default do ecossistema mesmo sem testes | Nota aditiva no CLAUDE.md esclarece "sem testes ainda — recomendado X". |
| Catálogo de framework desatualizar vs. realidade | Catálogo é fonte única; skill lê o nome do CLAUDE.md (gerado do catálogo) — sem tabela duplicada de escolha. |

## 14. Plano de testes (node --test)

- `tests/detect-testing.test.mjs`: fixtures por ecossistema cobrindo `configured` true/false (com framework dep; com arquivos; com script declarado; vazio → recomenda). Verifica que o default do ecossistema **não** marca `configured`.
- `tests/testing-catalog.test.mjs`: `recommendTesting` retorna o default correto por stack-key; resolve `install` conforme PM; `installNeeded=false` para built-ins; alternativas presentes.
- Extensão de `tests/plan-*.test.mjs`: nota de plano quando gap; `setup-testing` presente nos assets de skill.
- `tests/claude-md*.test.mjs` (se houver): nota aditiva aparece quando `!configured`, ausente quando configurado.

## 15. Sequência de implementação (sugerida ao plano)

1. `lib/profile.mjs`: typedef `TestingInfo` + campo `testing`.
2. `lib/data/testing-catalog.mjs`: `TESTING_BY_STACK` + `recommendTesting` (+ teste).
3. `lib/detect/testing.mjs`: `detectTesting` + globs (+ teste).
4. `lib/detect/index.mjs`: wiring `testing` no profile.
5. `bin/harness.mjs`: linha de testes no scan report.
6. `lib/generate/claude-md.mjs`: nota aditiva.
7. `lib/plan.mjs`: plan note.
8. `templates/skills/setup-testing/SKILL.md` + registro em `lib/data/project-catalog.mjs` (`PROJECT_COMMON.skills`).
9. `commands/init.md` (passo 5.7) + `commands/doctor.md` (menção).
10. `npm test` (typecheck + lint + unit) verde.
