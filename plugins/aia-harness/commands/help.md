---
description: Show the full aia-harness command reference — what each command does, when to use it, parameters and options — with a "I want to…" quick-start guide at the top.
allowed-tools:
  - Bash
---

# Guia de comandos do aia-harness

Apresente este guia ao usuário **em português**, na íntegra e bem formatado.
Comece pela seção "Por onde começar" e depois detalhe cada comando. Se útil,
mostre a versão do engine:

```bash
"${CLAUDE_PLUGIN_ROOT}/bin/aia-harness" version
```

---

## 🚀 Por onde começar (guia de decisão)

| Se você quer… | Use |
| --- | --- |
| **Só diagnosticar** a stack/arquitetura sem escrever nada | `/aia-harness:scan` |
| **Configurar o harness do zero** num projeto novo (diagnose → aprovar → aplicar com diffs) | `/aia-harness:init` |
| **Auditar** um harness já existente e receber correções pontuais | `/aia-harness:doctor` |
| **Atualizar parte** de um projeto que já tem o harness (ex: só o `settings.json`, só os hooks) | `/aia-harness:patch` |
| Reaplicar **tudo** sobrescrevendo arquivos existentes | `/aia-harness:patch` e selecione todas as categorias |
| Adicionar **servidores MCP** estratégicos (`.mcp.json`) | `/aia-harness:add-mcp` |
| Instalar os **plugins** de mercado recomendados para a stack | `/aia-harness:add-plugins` |
| Instalar **ferramentas de economia de token / code-graph** (caveman, ponytail, rtk, graphify) | `/aia-harness:add-tools` |
| Ver esta ajuda | `/aia-harness:help` |

**Estado do projeto → comando recomendado:**

- **Projeto sem harness** → `/aia-harness:init`
- **Projeto com harness desatualizado** (após upgrade do plugin) → `/aia-harness:doctor` detecta e **adiciona o que falta** (novos agentes/hooks/skills/rules) sem tocar no existente; use `/aia-harness:patch` para **sobrescrever** artefatos que mudaram (ex: `settings.json`, hooks)
- **Projeto com harness, suspeita de problema** (permissões largas, hooks errados, CLAUDE.md inchado) → `/aia-harness:doctor`
- **Só quero entender o projeto antes de mexer** → `/aia-harness:scan`

> Todo comando aceita um caminho opcional como primeiro argumento. Sem ele, o
> alvo é `$CLAUDE_PROJECT_DIR` (o projeto atual). Ex: `/aia-harness:doctor /caminho/do/projeto`.

---

## Comandos em detalhe

### `/aia-harness:scan [caminho]`

**O que faz:** roda o scanner determinístico e imprime o diagnóstico — linguagem
primária, stack, package manager, frameworks, monorepo, comandos canônicos,
domínios de arquitetura e artefatos de harness já existentes.
**Quando usar:** antes de qualquer escrita, ou só para entender um projeto.
**Escreve arquivos?** Não — 100% read-only.
**Parâmetros:** `caminho` (opcional) → diretório alvo.

### `/aia-harness:init [caminho]`

**O que faz:** fluxo completo de scaffolding — diagnose → plano → **consentimento
por categoria** → preview com diffs → aplica → enriquece os `CLAUDE.md` (3 passes
analisando o código real) → revisa com o agente `harness-reviewer` → oferece
instalar plugins/tools/MCP interativamente → segunda opinião via
`claude-automation-recommender`.
**Quando usar:** projeto **sem** harness, ou pra reconstruir do zero.
**Escreve arquivos?** Sim, mas **nunca sem aprovação** e sempre com diff antes de sobrescrever.
**Pergunta dedicada:** "Stop verification" — se aceitar (recomendado), instala o
loop estrito que roda lint + typecheck ao terminar e bloqueia até passar.
**Parâmetros:** `caminho` (opcional).

### `/aia-harness:doctor [caminho]`

**O que faz:** audita um harness existente e dá notas — `CLAUDE.md` inchado ou
genérico, stubs `AI-ENRICH` não preenchidos, regras fixas (`aia-harness:fixed`)
suprimidas, `settings.json` com permissões largas, hooks mal configurados,
`.mcp.json` com segredos literais, `.gitignore` sem `*.local.*`, ausência de
testes unitários. **Detecta também o que falta vs. a versão atual do plugin**
(novos agentes/hooks/skills/rules) rodando `plan` e comparando o flag `exists` de
cada artefato — e oferece **adicionar só os faltantes** via apply aditivo (sem
`--force`, não toca no que já existe). Apresenta findings priorizados e aplica
cada correção **só após aprovação**, com diff.
**Quando usar:** projeto **com** harness — validar qualidade, **ou após upgrade do
plugin para receber os artefatos novos** sem sobrescrever o existente (para
sobrescrever o que mudou, use `/aia-harness:patch`).
**Escreve arquivos?** Só correções aprovadas, via `Edit` (nunca reescreve em massa).
**Parâmetros:** `caminho` (opcional).

### `/aia-harness:patch [caminho]`

**O que faz:** reaplica **seletivamente** categorias de artefatos num projeto já
configurado. Lista as categorias disponíveis, você escolhe **uma ou mais**
(multi-select), e por trás roda `apply --yes --force --only=<ids>` só para o que
foi escolhido.
**Quando usar:** projeto **com** harness que precisa receber só uma parte
atualizada (ex: o `settings.json` mudou no plugin, ou você quer reinstalar os
hooks sem tocar nos `CLAUDE.md`).
**Escreve arquivos?** Sim — **sobrescreve com `--force`** apenas as categorias selecionadas; o resto fica intacto.
**Categorias disponíveis:** `settings`, `hooks`, `claude-md`, `rules`, `mcp`, `skills`, `agents`, `tools` (só aparecem as que existem no plano).
**Parâmetros:** `caminho` (opcional).

### `/aia-harness:add-mcp [caminho]`

**O que faz:** sugere servidores MCP estratégicos e os mescla no `.mcp.json` da
raiz do projeto (criando se não existir), sempre com placeholders `${ENV_VAR}` —
nunca segredo literal. Adiciona as chaves de env vazias em
`.claude/settings.local.json` (gitignored) para você preencher.
**Quando usar:** quer dar ao agente acesso a serviços externos (github, context7, etc).
**Escreve arquivos?** Sim — `.mcp.json` e `settings.local.json`, com merge (não clobber) e diff.
**Parâmetros:** `caminho` (opcional). Default github em repos git.

### `/aia-harness:add-plugins [caminho]`

**O que faz:** instala os plugins de mercado recomendados para a stack
(code-review, hookify, feature-dev, frontend-design, context7, github,
claude-code-setup + LSP por linguagem). Gera o instalador idempotente
`scripts/install-plugins.sh` e, após **uma confirmação**, roda.
**Quando usar:** quer os plugins recomendados sem instalar manualmente.
**Escreve arquivos?** Gera `scripts/install-plugins.sh`. Plugins instalam a **nível de usuário** (Claude Code não tem install por-projeto).
**Parâmetros:** `caminho` (opcional). Lembre de **reiniciar o Claude Code** depois.

### `/aia-harness:add-tools [caminho]`

**O que faz:** vendoriza e fia ferramentas project-level de economia de token /
code-graph: **caveman** e **ponytail** (skills + hooks, offline), o hook guardado
do **rtk**, e **graphify**. Vendor + wiring são automáticos; instalações de
binário/pacote (rtk, graphify) rodam só após **uma confirmação**.
**Quando usar:** quer reduzir consumo de token ou ter um grafo de código.
**Escreve arquivos?** Sim — skills em `.claude/skills/`, hooks em `.claude/hooks/<tool>/`, wiring no `settings.json`, `.graphifyignore`. **Tudo project-level**, nunca em `~/.claude`.
**Parâmetros:** `caminho` (opcional). Escopo: `--tools=caveman,ponytail` ou `--no-tools`.

---

## ⚙️ Engine CLI por trás dos comandos

Os comandos acima são wrappers sobre o binário determinístico
`bin/aia-harness` (= `bin/harness.mjs`). Para uso direto / debugging:

```bash
aia-harness scan  [dir] [--json]     # diagnose → ProjectProfile (read-only)
aia-harness plan  [dir] [--json]     # ProjectProfile → HarnessPlan (não escreve)
aia-harness apply [dir] [--yes]      # aplica o plano (dry-run sem --yes)
aia-harness help | version
```

**Flags do `apply`:**

| Flag | Efeito |
| --- | --- |
| `--yes` | Escreve de fato. Sem ela, é **dry-run** (preview). |
| `--force` | Sobrescreve arquivos existentes que diferem. Sem ela, são **pulados**. |
| `--only=id,id` | Aplica só os artefatos com esses IDs (base do `/aia-harness:patch`). |
| `--tools=a,b` | Limita quais tools project-level instalar. |
| `--no-tools` | Pula todas as tools project-level. |
| `--no-strict` | Stop hook vira lembrete passivo em vez do loop bloqueante lint + typecheck (o padrão é **strict on**). |

**Segurança (invariantes que nenhum comando quebra):** gate de consentimento
antes de escrever, diff antes de sobrescrever, segredos só como `${ENV}`,
`*.local.*` no gitignore, hooks de guarda saem com código 2 / formatadores
falham aberto.
