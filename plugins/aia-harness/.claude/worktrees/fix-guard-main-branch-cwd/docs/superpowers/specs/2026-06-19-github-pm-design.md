# Design: GitHub PM — gestão de issues e Projects v2 via harness

**Data:** 2026-06-19
**Status:** aprovado para planejamento
**Fontes upstream:**
- [github/awesome-copilot](https://github.com/github/awesome-copilot) — skill `github-issues` (MIT)
- [netresearch/github-project-skill](https://github.com/netresearch/github-project-skill) — skill `github-project` (MIT AND CC-BY-SA-4.0)

## Contexto e objetivo

O `aia-harness` distribui um harness de Claude Code para projetos-alvo. Projetos que usam
**GitHub Issues** e/ou **GitHub Projects v2** para rastrear demandas de desenvolvimento
atualmente recebem apenas o MCP do GitHub como suporte.

O objetivo é adicionar um **pilar GitHub PM** que o harness instala opcionalmente em projetos
com remote `github.com`. O pilar inclui:

- Skill first-party `github-pm` (ciclo de vida simplificado: Backlog → In Progress → In Review → Done)
- Skills vendorizadas `github-issues` e `github-project` como referência complementar
- Issue templates + PR template para `.github/`
- 4 GitHub Actions workflows para automação de status no Projects v2
- 5 commands `/pm:*` para o loop de desenvolvimento via Claude Code
- Comando `/add-github-pm` no plugin para projetos que já têm harness

## Princípios herdados (invariantes a não regredir)

- `lib/` puro e testável; IO só nas bordas (`detect` lê, `apply` escreve, `bin` orquestra).
- Detector read-only; transforms sem IO → unit-testáveis sem rede.
- Consent gate antes de escrever; diff antes de sobrescrever; nunca sobrescreve divergente sem `--force`.
- `pm-config.json` só copiado se não existe (safe by default do `apply.mjs`).
- Provenance carimbada em cada arquivo vendorizado + `MANIFEST.json`. Atribuições mantidas.
- `templates/` fora de lint/typecheck.
- MCP do GitHub já existente em `mcp-catalog.mjs` — não duplicar.

## 1. Detecção — `lib/detect/github-pm.mjs`

Roda ao final de `scanProject()`, após todos os detectores existentes. Lê `profile.vcs`
e faz stat de caminhos:

```js
// lib/detect/github-pm.mjs
export function detectGitHubPM(profile, files) {
  const remote = profile.vcs.remoteUrl ?? '';
  const detected = profile.vcs.isGit && remote.includes('github.com');
  return {
    detected,
    hasIssueTemplates: files.some(f => f.includes('.github/ISSUE_TEMPLATE')),
    hasWorkflows:      files.some(f => f.includes('.github/workflows')),
    hasPmConfig:       files.some(f => f.endsWith('.claude/pm-config.json')),
  };
}
```

### Typedef em `lib/profile.mjs`

```js
/**
 * @typedef {Object} GitHubPMInfo
 * @property {boolean} detected          - remote contém github.com e isGit=true
 * @property {boolean} hasIssueTemplates - .github/ISSUE_TEMPLATE/ existe
 * @property {boolean} hasWorkflows      - .github/workflows/ existe
 * @property {boolean} hasPmConfig       - .claude/pm-config.json existe
 */
```

Campo adicionado ao `ProjectProfile`:

```js
/**
 * @property {GitHubPMInfo} githubPM
 */
```

## 2. Catálogo — `lib/data/github-pm-catalog.mjs`

Novo módulo paralelo a `ecc-catalog.mjs`. Re-exportado pelo barrel `asset-catalog.mjs`.

```js
/**
 * @typedef {Object} GitHubPMArtifact
 * @property {string} id
 * @property {string} description
 * @property {string} copyFrom   - path absoluto em templates/
 * @property {string} dest       - path relativo no projeto-alvo
 * @property {boolean} skipIfExists - não sobrescreve se já existe
 */

export function selectGitHubPMAssets(profile) {
  if (!profile.githubPM?.detected) return [];
  return GITHUB_PM_ARTIFACTS;  // array de GitHubPMArtifact
}
```

`buildPlan` em `lib/plan.mjs` chama `selectGitHubPMAssets(profile)` e adiciona cada item
como `Artifact` com:
- `category: 'github-pm'`
- `defaultSelected: false` — opt-in no `init`, não padrão automático
- `contextCost: 0` — lazy, sem custo por sessão

## 3. Templates distribuídos

### 3.1 Estrutura em `templates/`

```
templates/
├── skills/github-pm/
│   ├── SKILL.md                       # first-party (nossa skill)
│   ├── references/
│   │   ├── 01-criar-issue.md
│   │   ├── 02-trabalhar-issue.md
│   │   ├── 03-fechar-issue.md
│   │   └── 04-backlog.md
│   └── scripts/
│       ├── check-pr-status.sh         # valida checks do CI (exit 0-4)
│       └── worktree-safety-check.sh   # valida segurança antes de remover worktree
├── commands/pm/
│   ├── issue-new.md
│   ├── issue-work.md
│   ├── issue-close.md
│   ├── backlog.md
│   ├── setup-project.md
│   ├── worktree-new.md               # cria worktree com branch nomeada por issue
│   ├── commit-push-pr.md             # commit + push + abre PR (nunca na main)
│   ├── pr-merge.md                   # merge seguro respeitando CI
│   ├── worktree-remove.md            # encerra worktree com segurança
│   └── code-review-pr.md            # code review paralelo com subagents
├── github/
│   ├── ISSUE_TEMPLATE/
│   │   ├── bug.yml
│   │   ├── feature.yml
│   │   └── task.yml
│   ├── PULL_REQUEST_TEMPLATE.md
│   ├── workflows/
│   │   ├── issue-to-project.yml
│   │   ├── commit-to-progress.yml
│   │   ├── pr-to-review.yml
│   │   └── auto-close-issue.yml
│   └── pm-config.json.template
└── github-pm-ext/
    ├── MANIFEST.json
    ├── github-issues/                  # vendorizado de awesome-copilot
    └── github-project/                 # vendorizado de netresearch
```

### 3.2 Destinos no projeto-alvo

| Origem (templates/) | Destino |
|---|---|
| `skills/github-pm/` | `.claude/skills/github-pm/` |
| `commands/pm/` | `.claude/commands/pm/` |
| `github/ISSUE_TEMPLATE/` | `.github/ISSUE_TEMPLATE/` |
| `github/PULL_REQUEST_TEMPLATE.md` | `.github/PULL_REQUEST_TEMPLATE.md` |
| `github/workflows/*.yml` | `.github/workflows/` |
| `github/pm-config.json.template` | `.claude/pm-config.json` (skipIfExists) |
| `github-pm-ext/github-issues/` | `.claude/skills/github-issues/` |
| `github-pm-ext/github-project/` | `.claude/skills/github-project/` |

`apply.mjs` já suporta `copyFrom` de diretório — nenhuma mudança necessária.

## 4. Skill first-party `github-pm`

### Estrutura de arquivos

```
templates/skills/github-pm/
├── SKILL.md                    # frontmatter + body imperativo (~1500-2000 words)
├── references/
│   ├── 01-criar-issue.md      # passo a passo detalhado de criação
│   ├── 02-trabalhar-issue.md  # worktree + branch + status In Progress
│   ├── 03-fechar-issue.md     # validação critérios de aceite + Done
│   ├── 04-backlog.md          # filtros, ordenação, visualização
│   └── pm-config-schema.md    # schema completo de pm-config.json
└── scripts/
    ├── check-pr-status.sh
    └── worktree-safety-check.sh
```

### Frontmatter do SKILL.md (obrigatório em 3ª pessoa)

```yaml
---
name: github-pm
description: >
  This skill should be used when the user mentions tickets, issues, backlog,
  PR, pull request, worktree, sprint, or any development project management
  activity. Also activate when the user says "create issue", "work on #N",
  "close ticket", "open PR", "merge PR", "view backlog", "create branch for
  issue", or when code was modified without a linked issue.
---
```

### Ciclo de vida documentado na skill (não reinventa — orquestra)

```
Backlog → In Progress → In Review → Done
```

### Mapa de delegação (o que a skill instrui Claude a fazer)

| Operação | Skill/ferramenta delegada |
| -------- | ------------------------- |
| CRUD de issues (criar, ler, editar, fechar) | `github-issues` skill |
| Sub-issues, dependencies, issue fields | `github-issues` skill |
| Adicionar issue ao Projects V2, atualizar status | `github-issues` skill (MCP `mcp__github__projects_write`) |
| Buscar issues por status/label | `github-issues` skill (MCP `mcp__github__search_issues`) |
| Troubleshooting de PR/CI/merge bloqueado | `github-project` skill |
| Worktrees, branches | comandos git + tools nativos |
| `pm-config.json` → IDs reais | referência local (`references/pm-config-schema.md`) |

### Catálogo de workflows (triggers para carregar referência)

| # | Trigger phrases | Referência carregada |
| - | --------------- | -------------------- |
| 1 | "criar ticket/issue", "novo bug", "nova feature/task" | `references/01-criar-issue.md` |
| 2 | "trabalhar em #N", "pegar #N", "criar worktree para #N" | `references/02-trabalhar-issue.md` |
| 3 | "fechar #N", "concluir", "marcar como done" | `references/03-fechar-issue.md` |
| 4 | "backlog", "o que está pendente", "listar issues" | `references/04-backlog.md` |

### Princípios no body da skill

- Ler `.claude/pm-config.json` antes de qualquer operação com Projects V2. Se não existe → instruir `/pm:setup-project` e parar.
- Todo trabalho de código deve ter issue. Se não tem → criar retroativamente antes de prosseguir.
- Status reflete estado real. Nunca deixar In Progress se trabalho parou.
- Confirmar com usuário antes de criar ou fechar issues.
- NUNCA operar em `main` — sempre em branch de feature ou worktree.

### Anti-padrões na skill

- Não fazer merge sem passar por `check-pr-status.sh` (exit 0 obrigatório)
- Não fechar issue sem validar critérios de aceite no body
- Não usar `--admin` bypass
- Não reinventar CRUD — delegar para `github-issues` skill

## 5. GitHub Actions Workflows

Todos fail-open: se `PROJECTS_PAT` não estiver configurado, o workflow loga e encerra sem erro.
Sem chamadas à API Claude (auto-triage por IA foi descartado).

### `issue-to-project.yml`
- Trigger: `issues: [opened]`
- Ações: adiciona issue ao project (status Triage) + label `needs-triage`
- Requer: `PROJECTS_PAT` (secret)

### `commit-to-progress.yml`
- Trigger: `push` em branches que não sejam `main`/`master`
- Ações: extrai `#N` de commit messages → muda status Backlog/Todo → In Progress
- Skip: commits com `[skip-pm]` no início; issues com label `pm:paused`
- Não regride status (ex.: In Review permanece In Review)

### `pr-to-review.yml`
- Trigger: `pull_request: [opened, ready_for_review, reopened]`
- Ações: extrai issues linkadas do body (closes/fixes/resolves #N) → status In Review
- Skip: PRs draft; `[skip-pm]` no body

### `auto-close-issue.yml`
- Trigger: `pull_request: [closed]` + `merged == true`
- Ações: fecha issues linkadas + comenta + status Done no Projects v2

### Secret necessário
`PROJECTS_PAT`: PAT com escopos `repo` + `project`. Instruções incluídas no
`pm-config.json.template` e na skill `/pm:setup-project`.

## 6. Padrões de Commands (boas práticas aplicadas)

Commands são **thin orchestrators**: frontmatter restritivo + injeção de contexto + delegação para skills.
Body é instrução FOR Claude, não mensagem ao usuário.

### Frontmatter padrão por command

```markdown
---
description: <ação em ≤60 chars — aparece no /help>
argument-hint: [issue-number]     # quando recebe argumento
allowed-tools: Bash(gh *), Bash(git *)   # sempre restritivo, nunca *
---
```

### Injeção de contexto (via `!`bash``)

```markdown
Branch atual: !`git branch --show-current`
Status: !`git status --short`
Config PM: !`cat .claude/pm-config.json 2>/dev/null || echo "NOT_FOUND"`
```

### Padrão de delegação para skills

Commands mencionam explicitamente qual skill usar. Claude carrega a skill automaticamente:

```markdown
Use a skill `github-pm` para executar este workflow.
Para CRUD de issues, a skill `github-issues` fornece as ferramentas MCP necessárias.
```

### Tabela de frontmatter por command

| Command | argument-hint | allowed-tools principais |
| ------- | ------------- | ------------------------ |
| `issue-new.md` | `[description]` | `Bash(gh *)`, `Bash(python3 *)` |
| `issue-work.md` | `[issue-number]` | `Bash(gh *)`, `Bash(git *)` |
| `issue-close.md` | `[issue-number]` | `Bash(gh *)` |
| `backlog.md` | — | `Bash(gh *)` |
| `setup-project.md` | — | `Bash(gh *)`, `Bash(git *)`, Write |
| `worktree-new.md` | `[issue-number]` | `Bash(gh *)`, `Bash(git *)` |
| `commit-push-pr.md` | — | `Bash(git *)`, `Bash(gh *)` |
| `pr-merge.md` | `[pr-or-issue-number]` | `Bash(gh *)`, `Bash(git *)`, `Bash(bash *)`, `Bash(python3 *)` |
| `worktree-remove.md` | `[branch\|issue\|path]` | `Bash(gh *)`, `Bash(git *)`, `Bash(bash *)`, ExitWorktree |
| `code-review-pr.md` | `[pr-number]` | `Bash(gh *)`, `Bash(bash *)`, `Bash(python3 *)` |

## 7. Comandos de Desenvolvimento (worktree + PR loop)

Cinco novos comandos que cobrem o loop completo: abrir worktree → trabalhar → commit/PR → review → merge → fechar worktree.

### 7.1 `/pm:worktree-new` — Criar worktree para uma issue

Cria uma git worktree isolada em `.claude/worktrees/` com branch nomeada a partir da issue.

```
Argumento: número da issue

1. gh issue view $N --json title,labels → ler título e tipo (bug/feat/chore/docs)
2. Gerar slug: tipo/N-titulo-em-kebab-case (ex: feat/42-add-payment-flow)
3. Confirmar branch name com o usuário
4. git worktree add .claude/worktrees/$SLUG -b $SLUG
5. EnterWorktree({ path: ".claude/worktrees/$SLUG" })
6. Comentar na issue: "🤖 Worktree criada: branch `$SLUG`"
7. Mover issue para In Progress no Projects v2 (via pm-config.json)
```

Regras:

- **NUNCA** criar worktree a partir de `main` sem criar branch — sempre `-b $SLUG`
- Slug limitado a 60 chars; caracteres especiais → `-`
- Se worktree já existe para o mesmo slug → avisar e perguntar se reabre

### 7.2 `/pm:commit-push-pr` — Commit + push + PR

Commit das mudanças, push e abertura de PR. **NUNCA opera na main.**

```
Contexto injetado: branch atual, git status, git diff HEAD

1. GATE: se branch atual = main → PARAR. Instruir criar branch ou worktree primeiro.
2. git diff HEAD → resumo das mudanças para gerar mensagem de commit
3. Propor commit message (conventional commits) + mostrar ao usuário → confirmar
4. git add -A && git commit -m "$MSG"
5. Verificar se remote existe: git push origin $BRANCH ou git push -u origin $BRANCH
6. gh pr create com title, body (inclui "Closes #N" se issue detectada no nome da branch)
7. Reportar URL do PR + sugerir /pm:code-review-pr $PR_NUMBER
```

Detecção automática de issue: extrai número do nome da branch (`feat/42-*` → `#42`).

### 7.3 `/pm:pr-merge` — Merge seguro respeitando CI

Valida checks do GitHub Actions antes de mergear. **Nunca bypassa CI.**

```
Argumento: número do PR ou da issue

Passo 1 — Identificar PR
  - Tenta direto como PR number
  - Se não encontrar: busca PR com "Closes #N" no body ou branch feat/N-*

Passo 2 — Verificar estado
  - isDraft = true → perguntar se marca ready + aguardar CI (gh pr checks --watch)

Passo 3 — Gate autoritativo (SEMPRE executar)
  bash .claude/skills/github-pm/scripts/check-pr-status.sh $PR_NUMBER $OWNER/$REPO
  Exit 0 → verde, prosseguir
  Exit 1 → checks falhando → BLOQUEAR, listar falhas
  Exit 2 → checks pendentes → perguntar se aguarda (--watch) e re-rodar gate
  Exit 3 → PR inválido → ENCERRAR
  Exit 4 → verde mas sem review → avisar e perguntar se tenta mesmo assim

Passo 4 — Detectar estratégia de merge (squash > rebase > merge)
  gh repo view --json squashMergeAllowed,rebaseMergeAllowed,mergeCommitAllowed

Passo 5 — Merge
  gh pr merge $PR_NUMBER $MERGE_FLAG --delete-branch
  MERGE_EXIT ≠ 0 → reportar erro exato, NÃO executar pós-merge

Passo 6 — Pós-merge (somente se exit 0)
  - Comentar na issue + label status:done + gh issue close
  - Atualizar Projects v2 → Done via pm-config.json

Passo 7 — Cleanup
  - Se em worktree → perguntar se roda /pm:worktree-remove
  - git checkout main && git pull no checkout principal
```

Regras críticas (nunca violar):

- NUNCA `gh pr merge` sem gate do Passo 3 com exit 0 (ou exit 4 + confirmação)
- NUNCA fechar issue antes de confirmar MERGE_EXIT = 0
- NUNCA usar `--admin` sem pedido explícito e confirmação dupla

### 7.4 `/pm:worktree-remove` — Encerrar worktree com segurança

Remove worktree isolada somente após validar que nenhum código será perdido.

```
Argumento: branch, número da issue, path ou vazio (worktree atual)

Passo 1 — Gate de segurança
  bash .claude/skills/github-pm/scripts/worktree-safety-check.sh $ARG $OWNER/$REPO
  Exit 0 → tudo verde → prosseguir
  Exit 1 → bloqueado (uncommitted/unpushed/PR aberto/CI falhando) → PARAR
  Exit 2 → worktree não encontrada → listar disponíveis

Checklist do script (imprime ✅/❌):
  1. Working tree limpo (sem mudanças não commitadas)
  2. Nada commitado sem push
  3. Branch possui PR
  4. CI do PR sem falhas ou pendências
  5. PR mergeado
  6. Issue(s) relacionada(s) fechada(s)

Passo 2 — Sair da worktree
  ExitWorktree({ action: "keep" }) se sessão está dentro dela

Passo 3 — Gate 2: checkout principal limpo e em main
  cd $MAIN_ROOT
  git status --porcelain → se sujo → ABORTAR
  git checkout main && git pull --ff-only

Passo 4 — Remover
  git worktree remove --force $WT_PATH
  git branch -D $WT_BRANCH
  rm -rf $WT_PATH
  git worktree prune

Passo 5 — Confirmar com git worktree list
```

Regras críticas:

- NUNCA `rm -rf` antes de sair da worktree (Passo 2 antes do Passo 4)
- NUNCA remover com checks vermelhos no gate — listar o que falta e parar
- NÃO deletar branch remota (já removida pelo merge com `--delete-branch`)

### 7.5 `/pm:code-review-pr` — Code review com subagents paralelos

```
Argumento: número do PR

1. Haiku agent → elegibilidade (fechado? automatizado? já revisado sem fixes?)
2. Haiku agent → listar CLAUDE.md relevantes do codebase
3. Haiku agent → resumo das mudanças do PR
4. 6 agentes Sonnet em paralelo (dispatch único):
   #1 Conformidade com CLAUDE.md
   #2 Scan de bugs óbvios (só linhas modificadas)
   #3 Git blame/histórico dos arquivos modificados
   #4 PRs anteriores que tocaram esses arquivos
   #5 Comentários inline nos arquivos modificados
   #6 Ponytail review: over-engineering, YAGNI, duplicações, abstrações desnecessárias
5. Para cada issue: Haiku agent de scoring (0-100)
6. Filtrar: manter score ≥ 60
7. Re-check de elegibilidade (Haiku)
8. gh pr comment com resultado formatado (sem emojis, com links file:sha#L)
9. Mensagem terminal:
   - Issues encontradas → oferecer /orchestrate para correção
   - Nenhuma issue + CI verde → oferecer /pm:pr-merge $PR_NUMBER
   - Nenhuma issue + CI pendente/falhando → informar e aguardar
```

Referência `pm-config.json` para `OWNER/REPO`. Usa `check-pr-status.sh` após review.

## 8. Scripts auxiliares da skill

Dois scripts shell distribuídos em `.claude/skills/github-pm/scripts/`. Mesma responsabilidade dos scripts equivalentes do swapo, mas sem dependência do `ai-pm`.

### `check-pr-status.sh`

```
Argumento: $PR_NUMBER $OWNER_REPO
Exit 0: todos checks passaram + review aprovado (ou sem branch protection)
Exit 1: um ou mais checks falhando
Exit 2: checks ainda pendentes
Exit 3: PR não encontrado, inválido ou sem checks cadastrados
Exit 4: checks OK mas sem review aprovado
```

Usado por `/pm:pr-merge` (gate obrigatório) e `/pm:code-review-pr` (pós-review).

### `worktree-safety-check.sh`

```
Argumento: $WORKTREE_TARGET $OWNER_REPO
Exit 0: worktree segura para remoção (todos os checks verdes)
Exit 1: bloqueado (imprime ✅/❌ por item)
Exit 2: worktree não encontrada
Saída stdout (em exit 0): RESULT_WT_PATH, RESULT_WT_BRANCH
```

Usado exclusivamente por `/pm:worktree-remove`.

## 9. Comando `/pm:setup-project`

Setup interativo que roda uma vez por projeto:

```
1. Checar gh auth status — abortar se não autenticado
2. gh project list --owner $OWNER --format json
3. Exibir lista → usuário seleciona projeto
4. GraphQL: query field IDs (Status, Priority, Effort) do projeto selecionado
5. GraphQL: query option IDs de cada valor de status
6. Escrever .claude/pm-config.json com IDs reais
7. Verificar se PROJECTS_PAT existe como secret → instruir se não
```

`pm-config.json` gerado:
```json
{
  "owner": "org-or-user",
  "repo": "repo-name",
  "project_number": 1,
  "project_id": "PVT_...",
  "status_field_id": "PVTSSF_...",
  "status_options": {
    "Triage": "...",
    "Backlog": "...",
    "In Progress": "...",
    "In Review": "...",
    "Done": "..."
  }
}
```

## 10. Vendoring das Skills Externas

### Estrutura de sync

| ECC (padrão existente) | github-issues (novo) | github-project (novo) |
|---|---|---|
| `scripts/ecc-source.json` | `scripts/github-issues-source.json` | `scripts/github-project-source.json` |
| `scripts/sync-ecc.mjs` | `scripts/sync-github-issues.mjs` | `scripts/sync-github-project.mjs` |
| `lib/ecc/transform.mjs` | reutiliza ou `lib/github-pm/transform.mjs` | idem |
| `templates/ecc/` | `templates/github-pm-ext/github-issues/` | `templates/github-pm-ext/github-project/` |

**`package.json`:**
```json
"sync:github-issues": "node scripts/sync-github-issues.mjs",
"sync:github-project": "node scripts/sync-github-project.mjs"
```

### Transform aplicado
- Frontmatter SKILL.md compatível com Claude Code
- Provenance stamp em cada arquivo: `<!-- vendored from ... @ <commit> -->`
- Atribuição de licença preservada

### `templates/github-pm-ext/MANIFEST.json`
```json
{
  "github-issues": {
    "repo": "github/awesome-copilot",
    "commit": "<pinned>",
    "license": "MIT"
  },
  "github-project": {
    "repo": "netresearch/github-project-skill",
    "commit": "<pinned>",
    "license": "MIT AND CC-BY-SA-4.0"
  }
}
```

## 11. Comando `/add-github-pm` (Abordagem C)

Novo arquivo `commands/add-github-pm.md` no plugin (não distribuído ao alvo).
Permite ativar GitHub PM em projetos que já têm harness instalado.

```
1. node bin/harness.mjs scan [dir] --json → checar profile.githubPM.detected
2. Se não detectado → avisar ("remote não é github.com") e encerrar
3. Se detectado → node bin/harness.mjs plan [dir] --only=github-pm → mostrar diff
4. Confirmação do usuário
5. node bin/harness.mjs apply [dir] --yes --only=github-pm
6. Instruir: "Rode /pm:setup-project para configurar project IDs"
```

Análogo aos comandos `/add-mcp` e `/add-tools` existentes.

## 12. Integração com comandos existentes

| Comando | Mudança |
|---|---|
| `/init` | Detecta `githubPM.detected` → oferece categoria `github-pm` no menu de seleção |
| `/doctor` | Audita se artefatos github-pm estão presentes e atualizados |
| `/patch` | Categoria `github-pm` disponível para force-overwrite seletivo |
| `/scan` | Exibe `githubPM` no relatório de diagnóstico |

## 13. Testes

```
tests/detect-github-pm.test.mjs     # unit: detector com fixtures variadas
tests/catalog-github-pm.test.mjs    # unit: selectGitHubPMAssets retorna certo
tests/plan-github-pm.test.mjs       # integration: plan inclui categoria quando detected
```

Fixtures em `tests/fixtures/`:
- `github-project/` — projeto com remote github.com + `.github/`
- `no-github-project/` — projeto git sem remote github.com

## 14. Sequência de implementação

1. Typedef `GitHubPMInfo` em `lib/profile.mjs`
2. Detector `lib/detect/github-pm.mjs` + integrar em `lib/detect/index.mjs`
3. Scripts auxiliares: `templates/skills/github-pm/scripts/check-pr-status.sh` e `worktree-safety-check.sh`
4. Skill first-party: `templates/skills/github-pm/SKILL.md` + `references/0[1-4]-*.md`
5. Commands básicos: `issue-new`, `issue-work`, `issue-close`, `backlog`, `setup-project`
6. Commands de dev loop: `worktree-new`, `commit-push-pr`, `pr-merge`, `worktree-remove`, `code-review-pr`
7. GitHub templates: `ISSUE_TEMPLATE/`, `PULL_REQUEST_TEMPLATE.md`, `pm-config.json.template`
8. GitHub Actions workflows: 4 arquivos em `templates/github/workflows/`
9. Sync scripts + source JSONs + manifest
10. Sync vendoring: `npm run sync:github-issues && npm run sync:github-project`
11. `lib/data/github-pm-catalog.mjs` + integrar em `asset-catalog.mjs`
12. Integrar `buildPlan` em `lib/plan.mjs` (categoria `github-pm`)
13. Comando `/add-github-pm` em `commands/`
14. Integrar `/init`, `/doctor`, `/patch`, `/scan`
15. Testes unitários e de integração
16. `npm test` — typecheck + lint + unit

## 15. Decisões registradas

| Questão | Decisão | Motivo |
|---|---|---|
| Plugin separado vs. in-harness | In-harness | Reutiliza detecção, catalogs e apply existentes |
| Escopo | Issues + Projects v2 lightweight | "Mais objetivo e menos completo" que swapo |
| Detecção | Auto-detect + opt-in no init | Conveniente mas não impositivo |
| Skills externas | First-party + vendor github-issues + github-project | First-party na frente; externas como referência |
| Auto-triage IA | Não | Sem custo extra, sem ANTHROPIC_API_KEY obrigatório |
| `defaultSelected` | `false` | Opt-in; não impõe a quem não usa PM |
| Commands vs Skills | Commands = thin orchestrators; skill = conhecimento + mapa de delegação | Boas práticas Claude Code: commands mencionam skills, skills carregam sob demanda |
| Delegação CRUD issues | `github-issues` skill via MCP `mcp__github__projects_write` | Não reinventar — skill vendorizada já cobre CRUD completo + Projects V2 |
| Delegação troubleshooting PR/CI | `github-project` skill | Cobre diagnóstico de merge bloqueado, branch protection, CI failures |
