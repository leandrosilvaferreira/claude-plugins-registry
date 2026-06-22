---
name: condense-harness-prompts
description: Condensa prompts .md do harness (.claude/agents, commands, rules, skills) usando caveman full + Opus, sem perder informação. Comprime prosa e tabelas verbosas, preserva code blocks/URLs/inline-code/headings via gate determinístico. Substitui direto (git é a rede de revisão). Use quando pedirem para "condensar/comprimir/encurtar os agents/commands/rules/skills do .claude".
---

# Condense Harness Prompts

Condensa os `.md` do harness Claude Code (`.claude/`) com **caveman full + modelo Opus**, garantindo preservação semântica. Objetivo: menos tokens por artefato sem perder regra, exemplo técnico ou nuance.

## Arquitetura — 2 camadas

| Camada | Quem | Faz |
|--------|------|-----|
| Compressão semântica | **subagents Opus paralelos** (1/arquivo) | comprime prosa + condensa tabelas; escreve `<file>.condensed.tmp` |
| Gate determinístico + commit | `lib/condense.mjs` (thread principal) | valida `.tmp` vs original, sobrescreve no pass, mantém `.tmp` no fail |

> Subagent **só comprime** — nunca valida nem sobrescreve. O gate roda no mjs do principal porque subagent pode reportar verde falso. Separa criativo (compress) de mecânico (validar+commit).

---

## Workflow OBRIGATÓRIO

### 1. Perguntar escopo — `AskUserQuestion`

Pergunta única, header `Escopo`, opções:

| Opção | Resolve para |
|-------|--------------|
| **Tudo (agents+commands+rules)** | `node ... enumerate --all` |
| **Uma pasta** | 2ª pergunta: agents \| commands \| rules → `--type <pasta>` |
| **Uma skill** | pedir nome da skill (dir em `.claude/skills/`) → `--type skills --name <nome>` |
| **Um arquivo** | pedir path → `--file <path>` |

- **Skills: só 1 por execução** (nunca lote) — uma skill pode ter múltiplos `.md`; o enumerate já varre recursivo aquela skill.
- Se o usuário já disse o escopo no prompt de invocação, pular a pergunta e usar direto.
- Aceita flag `--skip-dedup` para pular o step 5c. Padrão: dedup ativo para arquivos em `.claude/`.

### 2. Enumerar alvos

```bash
node "${CLAUDE_PLUGIN_ROOT}/skills/condense-harness-prompts/lib/condense.mjs" \
  enumerate --root "${CLAUDE_PROJECT_DIR}" <flags>
```

Saída = uma linha por arquivo, **já ordenada do maior para o menor**, no formato:

```text
<bytes>\t<tamanho-humano>\t<path>
```

Ex: `14802\t14.5KB\t/…/.claude/agents/frontend-specialist.md`. Se vazio → avisar e parar.

**Ao apresentar os arquivos ao usuário** (quando o escopo trouxe vários e/ou para confirmar): listar **maior → menor** (a ordem já vem pronta), com o **tamanho ao lado de cada path**. Maiores primeiro = mais a ganhar com a condensação.

Se o usuário passou `--skip-dedup`, registrar internamente para pular o step 5c.

### 2.5. Determinar tipo de artefato por arquivo

Para cada arquivo enumerado, derivar o tipo pelo path e registrar internamente:

| Padrão de path | Tipo | Arquivo de boas práticas |
| --- | --- | --- |
| `.claude/agents/*.md` | `agent` | `best-practices/agents.md` |
| `.claude/commands/*.md` | `command` | `best-practices/commands.md` |
| `.claude/rules/*.md` | `rule` | `best-practices/rules.md` |
| `.claude/skills/**/SKILL.md` | `skill` | `best-practices/skills.md` |

`best_practices_path` = `"${CLAUDE_PLUGIN_ROOT}/skills/condense-harness-prompts/best-practices/<tipo>s.md"` (substituir `<tipo>s` com o tipo em plural, ex: `agents.md`).

Registrar `{ path, tipo, best_practices_path }` por arquivo. Usar ao compor o prompt de cada subagent no step 4.

### 3. Todo list — OBRIGATÓRIA (2+ arquivos)

`TodoWrite` um item por arquivo enumerado. Marcar concluído ao receber cada subagent.

### 4. Dispatch subagents Opus — PARALELO

Um `Agent` por arquivo, **todos no mesmo turno** (múltiplos `Agent` numa só mensagem). `subagent_type: general-purpose`, `model: opus`. Prompt = template abaixo (autossuficiente — subagent não herda histórico).

**Para cada arquivo, substituir no prompt:**

- `<path-absoluto>` → path do arquivo
- `<tipo-de-artefato>` → tipo derivado no step 2.5 (`agent`/`skill`/`command`/`rule`)
- `<path-best-practices>` → `best_practices_path` derivado no step 2.5

### 5. Commit + gate

Após todos os subagents retornarem:

```bash
node "${CLAUDE_PLUGIN_ROOT}/skills/condense-harness-prompts/lib/condense.mjs" \
  commit <file1> <file2> ...
```

O gate bloqueia se perdeu code block, URL, inline-code ou contagem de heading. Bloqueado → original intacto, `.tmp` mantido.

### 5b. Fix-loop opcional

Para cada arquivo **bloqueado**, pode-se re-dispatchar 1 subagent de correção (máx 1-2 voltas) — recebe os erros exatos do gate + original como referência e SÓ restaura o que foi perdido, reescrevendo o `.tmp`. Depois roda `commit` de novo só naquele arquivo. Se ainda bloquear → desistir, deixar pro humano via `.tmp`.

### 5c. Global Dedup Review (padrão: ativo; skip com `--skip-dedup`)

> `graphify` **não indexa `.claude/`** — scan é sempre grep/glob nativo.

**Pré-condição:** gate do step 5 passou para ao menos 1 arquivo. Executar somente se o artefato pertence a `.claude/`.

#### 5c-1. Mapear cross-referências

Para cada arquivo que passou o gate, grep/glob em `.claude/` para identificar:

1. O que o artefato menciona (nomes de rules, skills, agents ou commands citados).
2. Quem menciona o artefato (outros artefatos que referenciam o nome/path do arquivo).

```bash
grep -rl "<nome>" .claude/rules/ .claude/skills/ .claude/agents/ .claude/commands/
```

Se grep retornar **0 referências** em qualquer direção → pular 5c silenciosamente.

#### 5c-2. Dispatch subagent Dedup Analyst

Se cross-refs encontradas: 1 subagent `general-purpose` / `sonnet` com o template da seção "Template Dedup Analyst". Roda após o commit do step 5.

#### 5c-3. Apresentar proposta ao usuário

Exibir output do subagent (tabela de propostas + estimativa de bytes). Perguntar confirmação antes de qualquer edição.

#### 5c-4. Aplicar somente sob aprovação

Se aprovado: aplicar via `Edit` no arquivo já comprimido. Se recusado: descartar.

### 6. Reportar ao usuário

Tabela do commit. Para cada **bloqueado**, dar o path do `.tmp`. Se step 5c executado: incluir resumo de dedup (quantas duplicações, substituições aplicadas, bytes economizados).

---

## Template de prompt do subagent (caveman full + preservação)

```
Você é um compressor de prompt de harness Claude Code. Comprima o arquivo abaixo em estilo CAVEMAN FULL, sem perder NENHUMA informação técnica.

ARQUIVO: <path-absoluto>
TIPO DE ARTEFATO: <tipo-de-artefato>

PASSO 0 — OBRIGATÓRIO: Leia o arquivo de boas práticas para este tipo de artefato:
  <path-best-practices>

Aplique as invariantes e regras de compressão específicas contidas nele ANTES e DURANTE a compressão. Em especial:
- agents: preservar triggers de delegação na `description`; não alterar campos de frontmatter comportamentais (`tools`, `model`, `permissionMode`, `isolation`, etc.)
- skills: preservar padrões "Use when..." na `description`; não alterar `allowed-tools`/`paths`/`disable-model-invocation`
- commands: preservar variáveis `$1`/`${VAR}`, dynamic context `` !`...` ``, opções de AskUserQuestion, caminhos com `${CLAUDE_PLUGIN_ROOT}`
- rules: NUNCA remover `paths:` do frontmatter; comprimir body agressivamente (cada token economizado repete em toda sessão)

CAVEMAN FULL — corte: artigos (a/o/as/os), filler (apenas/realmente/basicamente/simplesmente), hedging (talvez/poderia/acho que), pleasantries. Frases → fragmentos. Sinônimos curtos. Diga uma vez, não repita.

CONDENSAR (agressivo onde for prosa):
- Texto narrativo → bullets/fragmentos terse
- Tabelas verbosas → mesclar células-prosa redundantes, remover rows duplicadas
- Frontmatter `description:` → condensar a prosa MAS manter TODOS os triggers/keywords (dirigem roteamento de delegação)

PRESERVAR EXATO (nunca alterar/remover):
- Code blocks (``` … ```) — byte a byte, incl. conteúdo
- Inline code (`token`) — todo token; NÃO dropar nenhum mesmo ao mesclar tabela
- URLs e paths exatos
- Headings (#..######) — mesmo texto e mesma quantidade
- Wikilinks [[...]]
- Demais campos do frontmatter YAML (name, model, skills, allowed-tools, etc.) — intactos
- Toda regra, proibição, threshold numérico, nome de tool/arquivo

REGRA DURA: existe um gate determinístico depois de você. Se você perder um code block, URL, inline-code ou mudar a contagem de headings, o arquivo é REJEITADO e seu trabalho descartado. Seja agressivo na prosa, cirúrgico no resto.

SAÍDA: escreva o markdown comprimido em `<path-absoluto>.condensed.tmp` (tool Write). NÃO sobrescreva o arquivo original. NÃO valide. NÃO envolva em code fence externo. Retorne só: bytes antes → bytes depois.
```

---

## Template de prompt do subagent Dedup Analyst (step 5c-2)

```
## Contexto
Arquivo comprimido: <path-absoluto-do-artefato-comprimido>
Artefatos relacionados encontrados (grep/glob em .claude/):
<lista-de-paths-com-tamanho>

## Tarefa
1. Ler o artefato comprimido (tool Read).
2. Ler cada artefato relacionado listado acima (tool Read).
3. Identificar todo conteúdo presente no artefato comprimido que também existe substancialmente em algum artefato relacionado (checklist, regra, tabela, seção inteira).
4. Para cada duplicação encontrada: propor substituição pointer-based — ex: "> Ver rule X — seção Y" ou "> Aplicar skill Z".
5. Trechos sem equivalente canônico confirmado em outro artefato → NÃO propor remoção (manter verbatim).
6. Entregar saída estruturada (ver formato abaixo).

## Restrições
- NÃO usar graphify — não cobre .claude/.
- NÃO remover informação sem equivalente canônico confirmado.
- NÃO tocar code blocks, URLs, inline-code ou headings — só prosa/checklists duplicados.
- Retornar apenas texto (tabela + diffs) — NÃO editar arquivos.

## Formato de saída esperado

### Tabela de propostas

| Seção no artefato | Fonte canônica (path + seção) | Substituição pointer-based | Bytes economizados (est.) |
|-------------------|-------------------------------|----------------------------|--------------------------|
| <trecho/seção>    | <path>::<heading>             | `> Ver <arquivo> — <seção>` | ~<N> bytes               |

### Diffs propostos

Para cada linha da tabela, incluir:

old:
<trecho atual no artefato>

new:
> Ver <arquivo> — <seção>

### Conteúdo sem duplicata (manter)

Lista dos trechos que NÃO têm equivalente em outro artefato e devem ser preservados verbatim.
```

---

## O que o gate checa

Port fiel do `validate.py` do caveman-compress:

| Check | Falha = | Bloqueia? |
|-------|---------|-----------|
| Code blocks idênticos | qualquer alteração | ERRO |
| URLs (set) | perdeu/adicionou URL | ERRO |
| Inline code (contagem) | perdeu `token` | ERRO |
| Heading count | nº de headings mudou | ERRO |
| Heading text/ordem | reordenou/renomeou | warning |
| Path drift | path lost/added | warning |
| Bullet drift | >15% variação | warning |
| Inline code adicionado | `token` novo no comprimido | warning |

---

## Relação com caveman-compress

**NÃO reusa o compressor** (`caveman-compress.sh` nem `compress.py`):
- Ambos chamam `claude --print` aninhado → trava nesta sessão.
- Modelo hardcoded (haiku/sonnet-4-5). Queremos **Opus**.
- Haiku é lossy; objetivo aqui é **preservação** (Opus + gate).

**Reusa (portado em `lib/condense.mjs`):**
- `validate.py` → gate determinístico, 6 checks. Self-contained no plugin, funciona para o time.
- `compress.py` guardrails: `is_sensitive_path`, `MAX_FILE_SIZE` 500KB, skip vazio, `strip_llm_wrapper`, abort se idêntico, fix-loop (step 5b).

## Arquivos de referência de boas práticas

Cada tipo de artefato tem seu guia em `best-practices/` — carregado pelo subagent no Passo 0:

- [best-practices/agents.md](best-practices/agents.md) — frontmatter de agents, triggers de delegação, body (system prompt)
- [best-practices/skills.md](best-practices/skills.md) — frontmatter de skills, triggers de descoberta, progressive disclosure, invariantes
- [best-practices/commands.md](best-practices/commands.md) — frontmatter de commands, variáveis `$1`/`${VAR}`, dynamic context, AskUserQuestion
- [best-practices/rules.md](best-practices/rules.md) — frontmatter de rules, `paths:` scope, custo de context de regras globais

## Notas

- **Sem dry-run** — escreve direto; git é a revisão.
- **Não herda histórico** — cada subagent recebe contexto completo no prompt.
- Arquivos `.condensed.tmp` nunca são re-enumerados (filtrados no enumerate).
- `<path-best-practices>` no template do subagent = `"${CLAUDE_PLUGIN_ROOT}/skills/condense-harness-prompts/best-practices/<tipo>s.md"` — substituir antes de despachar.
