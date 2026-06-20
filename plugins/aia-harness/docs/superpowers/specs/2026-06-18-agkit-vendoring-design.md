# Design: vendorizar ag-kit como segunda fonte de template

**Data:** 2026-06-18
**Status:** aprovado para planejamento
**Fonte upstream:** [vudovn/ag-kit](https://github.com/vudovn/ag-kit) @ `a909d03c808296b86cc124e09acf5f1c7efa4e49` — MIT © vudovn

## Contexto e objetivo

Hoje o `aia-harness` vendoriza ativos do **ECC** (`affaan-m/ECC`) — agentes, skills e
rules mapeados por stack — através de um pipeline puro `scan → plan → apply`. O objetivo
é adicionar o **ag-kit** como uma **segunda fonte de template**, espelhando exatamente o
padrão ECC.

O ag-kit é focado no **Antigravity**, não no Claude Code. Portanto os artefatos precisam
ser revisados/convertidos para o padrão Claude Code — principalmente os **frontmatters**.

Inventário upstream (em `.agents/`):

- **21 agentes** (`.agents/agent/*.md`)
- **~46 skills** (`.agents/skills/*/SKILL.md`)
- **14 workflows** = comandos (`.agents/workflows/*.md`)
- **4 scripts Python** (`.agents/scripts/*.py`)

## Princípios herdados (invariantes a não regredir)

- `lib/` puro e testável; IO só nas bordas (`detect` lê, `apply` escreve, `bin` orquestra).
- Transforms sem IO → unit-testáveis sem rede.
- Consent gate antes de escrever; diff antes de sobrescrever; nunca sobrescreve arquivo
  divergente sem `--force`.
- Provenance carimbada em cada arquivo vendorizado + `MANIFEST.json`. Atribuição mantida.
- `templates/` fora de lint/typecheck.

## 1. Arquitetura — módulo paralelo ao ECC

| ECC (existe) | ag-kit (novo) |
|---|---|
| `scripts/ecc-source.json` | `scripts/agkit-source.json` |
| `scripts/sync-ecc.mjs` (`npm run sync:ecc`) | `scripts/sync-agkit.mjs` (`npm run sync:agkit`) |
| `lib/ecc/transform.mjs` | `lib/agkit/transform.mjs` |
| `lib/data/ecc-catalog.mjs` | `lib/data/agkit-catalog.mjs` |
| `templates/ecc/` | `templates/ag-kit/` (+ `MANIFEST.json`, `LICENSE`) |

`scripts/agkit-source.json`:

```json
{
  "repo": "vudovn/ag-kit",
  "ref": "main",
  "commit": "a909d03c808296b86cc124e09acf5f1c7efa4e49",
  "rawBase": "https://raw.githubusercontent.com",
  "apiBase": "https://api.github.com",
  "attribution": "ag-kit by vudovn — https://github.com/vudovn/ag-kit — MIT License"
}
```

`sync-agkit.mjs` segue `sync-ecc.mjs`: resolve commit → 1 chamada `git/trees?recursive=1`
→ conteúdo via raw CDN (sem estourar rate limit) → aplica transforms → escreve em
`templates/ag-kit/` → grava `MANIFEST.json` com counts + assets + atribuição → pina commit.
Diretório de saída recriado do zero a cada sync.

## 2. Conversão de frontmatter (revisão p/ Claude Code)

Implementada em `lib/agkit/transform.mjs` (transforms puros), por tipo de ativo. Reusa
`splitFrontmatter`/`removeSection`/`stampProvenance` no espírito de `lib/ecc/transform.mjs`
(podem ser duplicados localmente ou extraídos — decisão de implementação; manter os módulos
de transform sem IO).

### Agentes (`.agents/agent/*.md` → `.claude/agents/<name>.md`)

Frontmatter upstream tem: `name`, `description`, `tools`, `model: inherit`, `skills:`.

Transform:
- **Remover** o campo `skills:` (específico do Antigravity; não existe no Claude Code).
- **Forçar `model: sonnet`** em todos os agentes (substitui `model: inherit`; mesma
  convenção dos agentes ECC vendorizados).
- **Reescrever `tools:`** mapeando/removendo ferramentas Antigravity:
  - `ViewCodeItem` → remover
  - `FindByName` → `Glob`
  - demais validadas contra o conjunto de tools do Claude Code; desconhecidas removidas.
- Manter `name` e `description`.
- Carimbar provenance após o frontmatter.

Frontmatter resultante: `name`, `description`, `tools`, `model: sonnet`.

### Workflows → commands (`.agents/workflows/*.md` → `.claude/commands/<name>.md`)

Frontmatter upstream: só `description`. Corpo usa `$ARGUMENTS` (idêntico ao Claude Code).

Transform: manter `description`; opcionalmente derivar `argument-hint`; carimbar provenance.
Nenhuma conversão estrutural necessária.

### Skills (`.agents/skills/<name>/SKILL.md` → `.claude/skills/<name>/`)

Frontmatter upstream: `name`, `description`, `when_to_use`, `allowed-tools`.

Transform:
- **Fundir `when_to_use` na `description`** — o Claude Code ignora `when_to_use`, mas é o
  texto que precisa estar na `description` para o trigger da skill funcionar. Remover a
  chave `when_to_use` após a fusão.
- Manter `name` e `allowed-tools`.
- Carimbar provenance.
- Copiar o diretório inteiro da skill (SKILL.md + arquivos de apoio), como o ECC faz.

## 3. Curadoria — subset único (dedup)

**Critério de exclusão:** um ativo ag-kit é excluído quando um de mesmo papel já chega ao
projeto-alvo via (a) skills superpowers, (b) catálogo ECC, ou (c) plugins default
(feature-dev, frontend-design, code-review, plugin-dev, geo, caveman).

### Skills

**Excluídas (duplicam):** brainstorming, systematic-debugging, tdd-workflow, plan-writing,
verify-changes, parallel-agents, simplify-code, frontend-design, mcp-builder, skillify,
code-review-checklist, api-patterns, nodejs-best-practices, python-patterns,
nextjs-react-expert, rust-pro, geo-fundamentals, seo-fundamentals.

**Mantidas (únicas do ag-kit):** behavioral-modes, coordinator-mode, intelligent-routing,
context-compression, memory-system, batch-operations, lint-and-validate,
deployment-procedures, documentation-templates, i18n-localization, performance-profiling,
server-management, tailwind-patterns, mobile-design, web-design-guidelines, architecture,
bash-linux, powershell-windows, app-builder, game-development, red-team-tactics,
vulnerability-scanner, code-review-graph, database-design, clean-code, testing-patterns.

### Agentes

**Excluídos** (redundantes com Explore/superpowers/ECC): explorer-agent, debugger,
test-engineer, security-auditor.

**Mantidos (role-based, complementam os reviewers do ECC):** backend-specialist,
frontend-specialist, mobile-developer, devops-engineer, database-architect, orchestrator,
project-planner, product-manager, product-owner, performance-optimizer,
qa-automation-engineer, penetration-tester, seo-specialist, game-developer,
documentation-writer, code-archaeologist.

### Commands (workflows)

**Regra:** só entram os comandos cujo nome **não colide** com (a) slash-command embutido
do Claude Code, nem (b) command/skill que o harness já instala no alvo. Comandos colidentes
são **descartados** (sem prefixo, sem renome).

Conjunto de colisão a verificar na implementação inclui (não exaustivo): `verify`
(skill `/verify`), `review`/`code-review`, `init`, `commit`, `deploy`/`status`
(namespaced vercel — avaliar), `brainstorm` (skill superpowers). Candidatos prováveis a
entrar: `coordinate`, `orchestrate`, `enhance`, `create`, `preview`, `remember`, `plan`,
`test`, `debug` — cada um confirmado contra a lista de colisão antes de incluir. A lista
final é determinística e documentada no `MANIFEST.json`.

## 4. Scripts Python

Vendorizados em `templates/ag-kit/scripts/`. Branding "AG Kit" removido dos cabeçalhos.

**Mantidos:** `verify_all.py`, `checklist.py` (CLIs de verificação genéricos).
**Excluídos:** `auto_preview.py`, `session_manager.py` (presos ao runtime de
preview/sessão do Antigravity).

Não são wired automaticamente em hooks/settings. Entram como helpers opcionais,
referenciados pelas skills/commands que os usam (ex.: command `verify`).

## 5. Seleção mapeada por stack

`lib/data/agkit-catalog.mjs` espelha `ecc-catalog.mjs`:

- `AGKIT_COMMON` — instalado em todo projeto: agentes agnósticos (orchestrator,
  project-planner) + skills agnósticas (architecture, clean-code, context-compression,
  memory-system, lint-and-validate, behavioral-modes, intelligent-routing, coordinator-mode,
  batch-operations) + commands sobreviventes.
- `AGKIT_BY_STACK` — por chave de stack. Exemplos:
  - `react`/`next` → frontend-specialist, tailwind-patterns, web-design-guidelines
  - `node`/`typescript` → backend-specialist, testing-patterns
  - `python` → backend-specialist, database-design
  - mobile (dart/flutter, react-native) → mobile-developer, mobile-design
  - games → game-developer, game-development
- Funções exportadas com **mesmas assinaturas** do ecc-catalog: `stackKeys(profile)`,
  `selectAgkitAssets(profile)` (deduped, common incluído), `allAgkitAssets()` (união, usada
  pelo sync para saber o que vendorizar).

O mapa stack→assets é a **única fonte de verdade** tanto para o sync (o que vendorizar)
quanto para o planner (o que instalar) — igual ao ECC.

## 6. Fiação no `buildPlan` + superfície

Bloco novo em `lib/plan.mjs`, logo após o bloco ECC (~L266), seguindo o mesmo formato:

- `agkit-agent:<name>` → `.claude/agents/<name>.md`, category `agents`
- `agkit-skill:<name>` → `.claude/skills/<name>`, category `skills`
- `agkit-command:<name>` → `.claude/commands/<name>.md`, category `commands`
- `agkit-script:<name>` → `.claude/scripts/<name>` (ou local equivalente), category `tools`

Todos com `contextCost: 0`, `copyFrom` apontando para `templates/ag-kit/...`, `rationale`
citando ag-kit (MIT, vudovn), e guarda `if (!exists(from)) continue;`. `defaultSelected`
segue o padrão ECC (true para os mapeados por stack).

Sem novo slash-command no plugin: ag-kit entra no fluxo `init`/`doctor` existente, na mesma
porta de consentimento/diff.

## 7. Testes + licença

- `tests/agkit-transform.test.mjs` — cobre os transforms (remoção de `skills:`, força
  `model: sonnet`, mapeamento de tools, fusão de `when_to_use`, stamping de provenance),
  estilo `node:test` + `node:assert`, sem rede.
- `tests/agkit-catalog.test.mjs` — cobre `stackKeys`/`selectAgkitAssets`/`allAgkitAssets`
  (dedup, common sempre presente, mapeamento por stack).
- `LICENSE` MIT vendorizada em `templates/ag-kit/LICENSE`; atribuição em `MANIFEST.json`.
- `templates/` permanece fora de lint/typecheck.

## Decisões travadas

1. Scripts: manter só `verify_all.py` e `checklist.py`.
2. Commands: só os sem colisão entram; colidentes descartados (sem prefixo).
3. Agentes excluídos: explorer-agent, debugger, test-engineer, security-auditor.
4. Todos os agentes: `model: sonnet` na conversão.

## Fora de escopo

- Não vendorizar `.agents/rules/`, `.agents/memory/`, `mcp_config.json`, `ARCHITECTURE.md`
  do ag-kit (não pedido; rules/MCP já cobertos por outros catálogos do harness).
- Sem novo slash-command de superfície dedicado ao ag-kit.
- Sem refactor do pipeline ECC existente.
