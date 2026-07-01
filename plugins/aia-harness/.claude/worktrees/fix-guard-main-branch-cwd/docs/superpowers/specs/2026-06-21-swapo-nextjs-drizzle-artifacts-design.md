# Design — Artefatos Next/Drizzle/shadcn extraídos do swapo

**Data:** 2026-06-21
**Status:** Aprovado (design), pendente plano de implementação

## Objetivo

Extrair artefatos de alta qualidade do harness do projeto swapo (`/Users/leandrosilvaferreira/Projetos/swapo/swapo-app/.claude`)
e adaptá-los de forma **genérica e portável** para a stack de harness que o plugin `aia-harness` instala em projetos futuros.

O harness do swapo foi construído sem pensar em portabilidade — fortemente acoplado a JavaScript/Node, Next 16, React 19,
Postgres + Drizzle, e a regras de negócio fintech (Inngest, CurrencyMath, PIX, Blnk, Stark Bank). Este trabalho destila as
partes reutilizáveis em rules path-scoped, um hook de guarda, e três skills agênticas, removendo todo acoplamento swapo.

## Escopo

### Incluído (10 entregas)

| # | Artefato | Tipo | Stack-key alvo |
|---|----------|------|----------------|
| 1 | `templates/rules/next/api-security.md` | rule | `next` |
| 2 | `templates/rules/drizzle/db-schema.md` | rule | `drizzle` |
| 3 | `templates/rules/drizzle/db-access.md` | rule | `drizzle` |
| 4 | `templates/rules/shadcn/tsx-screen.md` | rule | `shadcn` |
| 5 | `templates/rules/shadcn/mobile-first.md` | rule | `shadcn` |
| 6 | `templates/rules/react/form-validation.md` | rule | `react` |
| 7 | `templates/hooks/block-drizzle-direct.mjs` | hook | `drizzle` |
| 8 | `templates/skills/drizzle-migration-system/` | skill | `drizzle` |
| 9 | `templates/skills/nextjs-eslint-rules/` | skill | `next` |
| 10 | `templates/skills/structured-logging-pino/` | skill | `typescript` |

### Fora de escopo (não portável — acoplamento swapo)

- Regras ESLint acopladas a Inngest/fintech: `no-hardcoded-step-names`, `no-step-passthrough`, `no-magic-strings`, `no-db-transaction`.
- Rules swapo: `inngest-ledger.md`, `design-system.md`, `admin-architecture.md`, `obsidian.md`, `i18n.md`, `data-table.md`, `caveman.md`, `conventions.md` (CurrencyMath/proxy), etc.
- Agentes, comandos PM, scripts Python de vault Obsidian, `pm-config.json`.
- Ponytail/rtk/caveman (já existem no aia-harness via `tools-catalog`).

## Decisões tomadas (brainstorming)

1. **Hook `block-drizzle-direct`:** hard-block (exit 2) em `drizzle-kit push`/`drop` e scripts npm equivalentes; **permite** `migrate`/`generate`. Razão: `migrate` aplica migration files versionados (seguro); `push`/`drop` alteram o schema direto no DB sem histórico (risco de perda de dados em prod).
2. **`structured-logging-pino`:** vinculada à stack-key `typescript` (presente em todo projeto JS/TS). Skill é lazy (contextCost 0), então disponibilidade ampla tem custo desprezível.
3. **`nextjs-eslint-rules`:** plugin custom **portado** — porta as regras custom reais do swapo (apenas as genéricas) como plugin ESLint local no projeto-alvo, fiel 1:1, não aproximações via `no-restricted-*`.

## Arquitetura

O aia-harness flui por `scan → plan → apply`. Catálogos (`lib/data/*`) decidem **o que** se aplica por stack-key;
geradores/`copyFrom` produzem o **conteúdo**. Toda nova distribuição precisa ser registrada no catálogo de proveniência
correto — aqui, sempre `project-catalog.mjs` (first-party). Regra obrigatória do CLAUDE.md.

Duas camadas de condicionalidade, independentes:
- **Stack-key** decide se o artefato é **instalado** (via `PROJECT_BY_STACK` / `PROJECT_HOOK_BY_STACK`).
- **`paths:` frontmatter** (rules) decide quando o arquivo já instalado **carrega** em contexto.

### Parte A — Detecção (pré-requisito)

shadcn/ui já é detectado (`lib/data/frameworks.mjs:80`, marker `components.json` / dep `@shadcn/ui`).
Drizzle **não** existe no catálogo. Stack-keys `drizzle` e `shadcn` **não** existem.

**`lib/data/frameworks.mjs`** — adicionar entrada:
```js
{ name: "Drizzle", category: "meta", ecosystem: "js", deps: ["drizzle-orm", "drizzle-kit"] }
```

**`lib/data/stack-keys.mjs`** — no `case "TypeScript"/"JavaScript"`, após os pushes existentes:
```js
if (has("Drizzle")) keys.push("drizzle");
if (has("shadcn/ui")) keys.push("shadcn");
```

`stackKeys()` lê `profile.frameworks[].name`; o detector empurra `fw.name` exato, então `has("Drizzle")` e
`has("shadcn/ui")` casam. Em projeto Next, a key `react` já é empurrada junto — logo `react/form-validation.md`
cobre projetos Next também.

**Por que keys separadas `drizzle`/`shadcn` em vez de dobrar em `next`:** precisão cirúrgica. Next sem Drizzle não recebe
regras de schema Drizzle; React+Vite com shadcn (sem Next) recebe `tsx-screen`/`mobile-first`. Mesmo padrão de
`java-spring`/`php-laravel`.

### Parte B — Rules (6 arquivos)

Formato: markdown com frontmatter `description` (opcional) + `paths:` (array de globs). `copyFrom` estático de
`templates/rules/<path>` para `.claude/rules/<path>`. contextCost 0 (path-scoped, lazy). Caminhos swapo-específicos
(`src/domains/`, `src/app/api/v1/`) traduzidos para convenções genéricas (`app/`, `db/schema/`, `*-repository.ts`).

| Arquivo | `paths:` | Conteúdo (destilado do swapo, genérico) |
|---------|----------|------------------------------------------|
| `next/api-security.md` | `**/app/**/route.ts`, `**/app/api/**/*.ts`, `**/middleware.ts` | Validação Zod por campo; SELECT/colunas explícitas (nunca `*`); acesso a DB só via repository; wrapper de auth em rotas; anti mass-assignment |
| `drizzle/db-schema.md` | `**/db/schema/**/*.ts`, `**/schema.ts`, `**/schema/**/*.ts` | `$inferSelect`/`$inferInsert`; enums; timestamps em toda tabela; PKs (uuid/serial); índices; `relations()` |
| `drizzle/db-access.md` | `**/*-repository.ts`, `**/db/**/*.ts`, `**/repositories/**/*.ts` | Queries só via repository; paginação limit+offset+count; anti-N+1; joins via Drizzle relations |
| `shadcn/tsx-screen.md` | `**/app/**/page.tsx`, `**/*.tsx` | Thin pages; colocation em `_components/`; estados loading/error/empty/data; componentes shadcn |
| `shadcn/mobile-first.md` | `**/*.tsx` | Mobile-first; breakpoints Tailwind (sm/md/lg/xl); touch targets |
| `react/form-validation.md` | `**/*.tsx` | Zod + React Hook Form (`zodResolver`); validação front + back; exibição de erros |

### Parte C — Hook

**`templates/hooks/block-drizzle-direct.mjs`** — PreToolUse, matcher `Bash`. Padrão do `guard-main-branch.mjs`
(lê stdin, parseia JSON, fail-open). Diferença: hard-block via **exit 2** (não ask).

Lógica:
1. Lê stdin → JSON. Parse falha / vazio → exit 0.
2. `command = event.tool_input.command`. Ausente → exit 0.
3. Match perigoso: regex `\bdrizzle-kit\s+(push|drop)\b` OU `\b(db:push|db:drop)\b` (scripts npm/pnpm/yarn).
4. Sem match → exit 0 (inclui `drizzle-kit migrate`, `db:migrate`, `db:generate`, qualquer não-drizzle).
5. Match → stderr explicando o risco + fluxo correto (`db:generate` → `db:migrate`), **exit 2**.

**Registro** em `project-catalog.mjs`:
```js
const DRIZZLE_HOOKS = [{ file: "block-drizzle-direct.mjs", event: "PreToolUse", matcher: "Bash", timeout: 10 }];
export const PROJECT_HOOK_BY_STACK = {
  "php": PHP_HOOKS, "php-laravel": PHP_HOOKS, "php-adianti": PHP_HOOKS,
  "drizzle": DRIZZLE_HOOKS,
};
```
`selectProjectHooks` (já existente) faz o wiring no settings.json via `node-run.sh`.

### Parte D — Skills (3 dirs)

Padrão `setup-testing`: `SKILL.md` (frontmatter `name`+`description`, instruções "faça X no projeto real, confirme antes
de ações de máquina, rode até verde, mostre saída"), + arquivos `reference/` que a skill lê e adapta. Skills são copiadas
como diretório (`copyFrom` de `templates/skills/<name>`), invocáveis como `/<name>`.

**1. `drizzle-migration-system/`** (stack `drizzle`)
- `SKILL.md` — ao rodar: detecta driver (node-postgres / Neon HTTP / postgres.js), adapta paths e nomes de env var,
  escreve os 3 arquivos no diretório `db/` do projeto, fia scripts `db:generate`/`db:migrate`/`db:patch` no manifesto,
  roda para validar. Confirma antes de instalar deps.
- `reference/migrate.ts` — entry: load de env, retry de conexão, pre-exec de enums fora da transação, chama o runner, reporta summary.
- `reference/migration-runner.ts` — runner hash-based puro/testável: aplica qualquer migration cujo hash não está registrado, ordenado por `folderMillis`, dentro de transação, erro tipado.
- `reference/patch-migrations.ts` — pós-processa SQL do `drizzle-kit generate` para idempotente (`IF NOT EXISTS`, enum guards via `DO $$`), protegendo migrations já commitadas (detecção via git).
- Fonte: `swapo-app/src/db/{migrate,migration-runner,patch-migrations}.ts` — desacoplar de logger/env swapo.

**2. `nextjs-eslint-rules/`** (stack `next`)
- `SKILL.md` — ao rodar: instala as regras custom como plugin ESLint local no projeto e faz merge no `eslint.config.js` (flat config).
- `reference/rules/*.mjs` — regras portadas (só genéricas): `require-types-filename`, `max-lines-clean-code`,
  `no-direct-console`, `no-native-input-elements`, `require-input-maxlength`, `no-direct-db-access`, `require-auth-wrapper`.
- `reference/eslint.config.snippet.js` — exemplo de wiring flat-config.
- Fonte: `swapo-app/eslint.config.js` (bloco `swapo-rules`) — portar implementação 1:1, remover regras Inngest/fintech, renomear de `swapo-*` para genérico.

**3. `structured-logging-pino/`** (stack `typescript`)
- `SKILL.md` — ao rodar: instala `pino`+`pino-pretty`, cria módulo logger, guia substituição de `console.*`. Confirma antes de instalar deps.
- `reference/logger.ts` — `createModuleLogger(name)` com redação de `password`/`token`/`secret`/`authorization`, nível por `LOG_LEVEL`, JSON em prod / pretty em dev.
- Fonte: módulo logger do swapo (`src/lib/logger`).

### Parte E — Registro no catálogo (`project-catalog.mjs`)

```js
export const PROJECT_BY_STACK = {
  // ...existentes...
  "react":   { agents: [], skills: [],                          rules: ["react/coding-standards.md", "react/form-validation.md"] },
  "next":    { agents: [], skills: ["nextjs-eslint-rules"],     rules: ["next/coding-standards.md", "next/api-security.md"] },
  "typescript": { agents: [], skills: ["structured-logging-pino"], rules: ["typescript/coding-standards.md"] },
  "drizzle": { agents: [], skills: ["drizzle-migration-system"], rules: ["drizzle/db-schema.md", "drizzle/db-access.md"] },
  "shadcn":  { agents: [], skills: [],                          rules: ["shadcn/tsx-screen.md", "shadcn/mobile-first.md"] },
};
```

### Parte F — Sugestão na instalação (`lib/plan.mjs` `notes[]`)

Mecanismo existente (igual ao `setup-testing`). Na seção de notes do `buildPlan`, computar as skills instaladas e empurrar
sugestões gated:
```js
const installedSkills = selectProjectAssets(profile).skills;
if (installedSkills.includes("drizzle-migration-system"))
  notes.push("Drizzle detectado — rode /drizzle-migration-system para instalar o runner de migração idempotente hash-based.");
if (installedSkills.includes("nextjs-eslint-rules"))
  notes.push("Next.js detectado — rode /nextjs-eslint-rules para regras de fronteira/qualidade (tamanho de arquivo, logging estruturado, DB só via repository, rotas com auth-wrapper).");
if (installedSkills.includes("structured-logging-pino"))
  notes.push("Rode /structured-logging-pino para logging estruturado com redação de segredos.");
```

## Testes (CLAUDE.md — obrigatórios)

- **`tests/hook-block-drizzle-direct.test.mjs`** (obrigatório p/ todo hook em `templates/hooks/`): importa `validatePreToolUseOutput`, cobre todos os caminhos de saída:
  - empty stdin → exit 0, schema-valid, stdout vazio
  - invalid JSON → exit 0
  - non-bash / sem command → exit 0
  - `npm run build` → exit 0
  - `drizzle-kit migrate`, `npm run db:migrate`, `db:generate` → exit 0 (seguros, passam)
  - `drizzle-kit push` → exit 2
  - `drizzle-kit drop` → exit 2
  - `npm run db:push` / `pnpm db:push` → exit 2
- **`tests/project-catalog.test.mjs`** — casos novos:
  - projeto Drizzle (TS + frameworks `["Drizzle"]`) inclui `drizzle/db-schema.md`, `drizzle/db-access.md`, skill `drizzle-migration-system`; `selectProjectHooks` wira `block-drizzle-direct.mjs` em PreToolUse/Bash
  - projeto shadcn inclui `shadcn/tsx-screen.md`, `shadcn/mobile-first.md`
  - projeto Next inclui `next/api-security.md` + skill `nextjs-eslint-rules`
  - projeto React inclui `react/form-validation.md`
  - projeto TS inclui skill `structured-logging-pino`
  - projeto sem a lib NÃO recebe os assets correspondentes
  - `block-drizzle-direct.mjs` existe sob `templates/hooks/` (já coberto pelo teste genérico de `PROJECT_HOOK_BY_STACK`)
- **`tests/detect-stacks.test.mjs`** — keys `drizzle`/`shadcn` resolvidas quando os frameworks estão presentes; ausentes quando não.
- `npm test` (typecheck + lint + unit) verde antes de fechar.

## Riscos / cuidados

- **Arquivos `.ts` de referência** sob `templates/skills/*/reference/` são conteúdo scaffold (como `templates/ecc/`), não engine — `templates/` já é excluído de lint/typecheck. OK.
- **Regras ESLint portadas** devem ser lidas 1:1 do `eslint.config.js` real do swapo na implementação; remover qualquer dependência de constantes/imports swapo.
- **Migration system** deve desacoplar do logger swapo (usar `console` ou o logger pino se a skill de logging também rodar) e dos nomes de env var específicos.
- **Idempotência apply**: todo path em `PROJECT_BY_STACK` precisa de arquivo existente, senão `applyPlan` falha. Criar todos os arquivos antes de registrar.

## Arquivos

```
Novos:
  templates/rules/next/api-security.md
  templates/rules/drizzle/db-schema.md
  templates/rules/drizzle/db-access.md
  templates/rules/shadcn/tsx-screen.md
  templates/rules/shadcn/mobile-first.md
  templates/rules/react/form-validation.md
  templates/hooks/block-drizzle-direct.mjs
  templates/skills/drizzle-migration-system/SKILL.md
  templates/skills/drizzle-migration-system/reference/migrate.ts
  templates/skills/drizzle-migration-system/reference/migration-runner.ts
  templates/skills/drizzle-migration-system/reference/patch-migrations.ts
  templates/skills/nextjs-eslint-rules/SKILL.md
  templates/skills/nextjs-eslint-rules/reference/rules/*.mjs
  templates/skills/nextjs-eslint-rules/reference/eslint.config.snippet.js
  templates/skills/structured-logging-pino/SKILL.md
  templates/skills/structured-logging-pino/reference/logger.ts
  tests/hook-block-drizzle-direct.test.mjs
Editados:
  lib/data/frameworks.mjs        (+ Drizzle)
  lib/data/stack-keys.mjs        (+ drizzle, shadcn keys)
  lib/data/project-catalog.mjs   (registrar rules/skills/hook)
  lib/plan.mjs                   (notes de sugestão)
  tests/project-catalog.test.mjs (casos novos)
  tests/detect-stacks.test.mjs   (casos novos)
```
