# Design: instalar `uncle-bob-craft` como skill padrão + citação em code review

**Data:** 2026-07-01
**Status:** aprovado para planejamento
**Fonte:** `/Users/leandrosilvaferreira/Projetos/swapo/swapo-app/.claude/skills/uncle-bob-craft/` (skill local de outro projeto do usuário — cópia manual, não vendoring via GitHub)

## Contexto e objetivo

O usuário tem uma skill `uncle-bob-craft` num projeto separado (`swapo-app`) que aplica os
critérios de Robert C. Martin (Clean Code, Clean Architecture, The Clean Coder, Clean Agile,
uso vs. mau uso de design patterns) durante **code review** e **escrita/refatoração de
código**. É complementar a uma skill `@clean-code` (não vendorizada aqui) e explicitamente não
substitui linter/formatter/testes do projeto.

Objetivo: trazer essa skill para o `aia-harness`, torná-la **padrão em todo projeto-alvo**
(qualquer stack, sem condicional), e **citá-la explicitamente** nos pontos do harness gerado
que já governam o processo de code review — não apenas deixá-la disponível para
auto-descoberta por descrição.

## Princípios herdados (invariantes a não regredir)

- `templates/` fora de lint/typecheck; `lib/` puro e testável.
- Todo artefato em `templates/` precisa estar registrado no catálogo correspondente
  (`lib/data/*-catalog.mjs`) na mesma mudança — regra `CLAUDE.md` "Asset catalog — mandatory
  maintenance".
- Seções `## Engineering rules` / `## Rules` marcadas `aia-harness:fixed` no CLAUDE.md gerado
  nunca são reescritas pelo enrichment por IA — é o lugar certo para uma citação garantida.
- Agentes `*-reviewer` de stack (go/rust/typescript/react/vue/java/kotlin/php/python/django/
  fastapi/csharp/cpp/flutter) vêm todos do `ecc-catalog.mjs` (vendored, MIT © Affaan Mustafa);
  `nestjs-code-reviewer`/`nestjs-security-reviewer` são first-party (`project-catalog.mjs`).
  Arquivo vendorizado nunca é editado à mão — `npm run sync:ecc` sobrescreve.

## 1. Cópia da skill (`templates/skills/uncle-bob-craft/`)

Copiar os 8 arquivos verbatim:

```
templates/skills/uncle-bob-craft/
├── SKILL.md
├── README.md
├── reference.md
├── examples/code-review-checklist.md
└── references/
    ├── clean-agile.md
    ├── clean-architecture.md
    ├── clean-coder.md
    └── design-patterns.md
```

**Única mudança:** frontmatter do `SKILL.md` normalizado para o padrão de casa observado em
todo `templates/skills/*/SKILL.md` first-party (`pre-commit-verify`, `lint-fix`, `run-tests`,
`setup-testing`, `nestjs-*`) — só `name` + `description`. Campos do upstream
(`category`, `risk`, `source`, `date_added`, `author`, `tags`, `tools`) são descartados; não
são lidos pelo Claude Code e não têm equivalente nos outros skills first-party.

`description` original já é boa e fica como está (já tem o formato "Use when…" que o Claude
Code usa pra trigger):

> "Use when performing code review, writing or refactoring code, or discussing architecture;
> complements clean-code and does not replace project linter/formatter."

Atribuição a Robert C. Martin (Clean Code 2008, Clean Architecture 2017, The Clean Coder 2011,
Clean Agile 2019) já está no corpo de `reference.md` ("Scope and attribution") — permanece
intacta, verbatim. Não é criada nenhuma atribuição nova nem entrada em `skills-lock.json`
(esse lock é do instalador de skills via GitHub do próprio Claude Code — não se aplica a uma
cópia manual local; ver "Fora de escopo").

## 2. Instalação (`lib/data/project-catalog.mjs`)

`PROJECT_COMMON.skills` ganha `"uncle-bob-craft"`:

```js
skills: ["run-tests", "lint-fix", "pre-commit-verify", "setup-testing", "goal-builder", "uncle-bob-craft"],
```

Stack-independente, sem condicional — instala em **todo** projeto-alvo. O teste genérico
existente `tests/project-catalog.test.mjs` ("selectProjectAssets always includes the common
skills") já cobre a presença via loop sobre `PROJECT_COMMON.skills`; nenhum teste novo
necessário só para o registro.

## 3. Citação no CLAUDE.md gerado — `codeReviewRule()`

`lib/generate/claude-md.mjs:142`, `codeReviewRule(agents)`, é a função que já compõe a frase
fixa "When performing a code review… always use `code-reviewer` [+ reviewers de stack]" —
vive em `## Engineering rules`, protegida por `FIXED_RULES_MARKER`, presente em **toda**
CLAUDE.md gerada independente de stack. É o ponto de citação central: como
`uncle-bob-craft` é `PROJECT_COMMON` (sempre instalada), a menção pode ser incondicional, sem
precisar checar `agents` ou receber um parâmetro novo.

Antes:

```js
return `When performing a code review (user requests it or a workflow triggers it), always use ${named}.`;
```

Depois:

```js
return `When performing a code review (user requests it or a workflow triggers it), always use ${named}, applying the \`uncle-bob-craft\` skill's criteria (Dependency Rule, SOLID in context, code smells) alongside their findings.`;
```

`all`/`named` nunca é vazio hoje (ECC_COMMON sempre contribui `code-reviewer` +
`security-reviewer` independente de stack) — nenhum caso de borda novo introduzido.

Cobertura: estender `tests/claude-md.test.mjs` com um teste que chama `codeReviewRule(...)`
com uma lista de agents qualquer e afirma que a saída contém `` `uncle-bob-craft` ``.

## 4. Citação em `templates/rules/04-code-quality.md`

Regra stack-independente (`paths: ["**/*"]`), carregada quando arquivo relevante é tocado —
canal complementar ao CLAUDE.md (sempre-on): aqui o gatilho é por edição, e dá espaço pra
detalhar o "o quê" (SOLID/Dependency Rule/smells) em vez de só "quem revisa".

Estende o bullet existente em vez de criar um novo (menor diff, zero redundância):

Antes:

```
- Ensure the code is ready for code review.
```

Depois:

```
- Ensure the code is ready for code review — apply the `uncle-bob-craft` skill (Dependency
  Rule, SOLID in context, code smells) as part of that check.
```

## 5. Dogfood no próprio `aia-harness`

Decisão do usuário: aplicar também no processo de review deste repo, não só nos alvos
gerados.

- **Copiar a skill também para `.claude/skills/uncle-bob-craft/`** (mesmos 8 arquivos, mesma
  normalização de frontmatter do item 1) — a sessão principal deste repo tem a tool `Skill` e
  passa a poder invocá-la diretamente.
- **`.claude/CLAUDE.md`** ganha uma seção nova, no mesmo padrão do bloco `# graphify` já
  existente:

  ```markdown
  # uncle-bob-craft
  - **uncle-bob-craft** (`.claude/skills/uncle-bob-craft/SKILL.md`) - Uncle Bob criteria
    (SOLID, Dependency Rule, code smells) for reviewing or writing this plugin's own code.
  When reviewing a diff, PR, or non-trivial implementation in this repo, invoke the Skill
  tool with `skill: "uncle-bob-craft"` before finishing.
  ```

- **`.claude/agents/aia-harness-code-reviewer.md`** ganha uma seção curta e condensada
  (Dependency Rule/boundaries, SOLID em contexto, os 7 smells, "sugira 1-2 refactors
  concretos") embutida diretamente no prompt — **não** uma instrução para invocar a skill,
  porque o `tools:` desse agent é `[Read, Grep, Glob, Bash]` e não inclui `Skill`; um subagent
  despachado via `Agent`/`Task` não consegue chamar `Skill` mesmo que o arquivo exista no
  projeto. A seção fica compacta (10-15 linhas), citando `uncle-bob-craft` pelo nome como
  referência para quem lê o arquivo, sem duplicar o conteúdo inteiro da skill.

## 6. Documentação

`README.md`: acrescentar `uncle-bob-craft` na lista curta (linha ~41), na lista de skills
operacionais (linha ~240) e na tabela de skills com descrição de uma linha (perto da linha
~278-282, mesmo formato das outras 5 entradas).

## Testes

- `tests/project-catalog.test.mjs` — já cobre via teste genérico existente (item 2); nenhuma
  mudança de código de teste necessária, só a adição ao array.
- `tests/claude-md.test.mjs` — novo teste (ou caso adicional em teste existente de
  `codeReviewRule`) afirmando que a string retornada contém `` `uncle-bob-craft` ``.
- Nenhum teste novo para o dogfood (`.claude/`) — não é código do engine, é conteúdo de
  projeto (mesma categoria de `.claude/agents/*.md` e `.claude/CLAUDE.md` já existentes, que
  não têm suíte própria).

## Decisões travadas

1. Profundidade: **Standard** — regra central (`codeReviewRule`) + bullet em
   `04-code-quality.md` + `PROJECT_COMMON` + dogfood. Rejeitadas: Minimal (só a regra
   central, sem reforço no rule file) e Maximal (edição de `nestjs-*-reviewer.md` +
   hook de lembrete a cada edit + toque em `07-subagent-dispatch.md`).
2. Frontmatter do `SKILL.md` normalizado para `name` + `description`, dropando metadados do
   upstream sem equivalente no padrão local.
3. Nenhum agent individual (first-party ou vendorizado) é editado — a citação vive só na
   função central `codeReviewRule()`, que já lista dinamicamente qualquer `*-reviewer`
   presente.
4. Dogfood cobre dois canais diferentes por causa da restrição de tools do agent: skill real
   (`.claude/skills/`) para a sessão principal, checklist inline pro subagent sem tool
   `Skill`.

## Fora de escopo

- **Hook novo** (ex.: `PostToolUse` lembrando da skill a cada `Edit`/`Write`) — rejeitado.
  Nenhum hook hoje neste repo é "lembrete de skill"; todos são safety/enforcement
  (`secret-scan`, `guard-main-branch`, `large-file-warning`, …). Um hook assim viraria ruído
  a cada edição e não tem precedente arquitetural.
- **Editar `templates/agents/nestjs-code-reviewer.md` / `nestjs-security-reviewer.md`
  individualmente** — redundante: quem lê o CLAUDE.md gerado já vê a citação central; evita
  duplicar a mesma frase em N arquivos.
- **Editar agentes ECC/ag-kit** (`flutter-reviewer`, `go-reviewer`, etc.) — impossível por
  arquitetura: são sobrescritos a cada `npm run sync:ecc`/`sync:agkit`.
- **`templates/rules/07-subagent-dispatch.md`** — não tocado; é sobre dispatch de subagent,
  não sobre critério de review em si.
- **`skills-lock.json`** — não ganha entrada; esse lock é do instalador de skills via GitHub
  do próprio Claude Code (source/sourceType/skillPath/computedHash), não se aplica a uma
  cópia manual de outro projeto local.
- **`@clean-code`** (skill relacionada citada pelo `uncle-bob-craft`) — não vendorizada nesta
  mudança; fora do pedido original, e o `uncle-bob-craft` já funciona de forma autônoma sem
  ela (apenas referencia onde ela ajudaria).
