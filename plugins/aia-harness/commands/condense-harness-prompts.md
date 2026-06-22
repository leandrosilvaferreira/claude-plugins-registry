---
description: Valida/corrige frontmatters de artefatos Claude Code e condensa os .md do harness (.claude/agents, commands, rules, skills) com Opus + gate determinístico.
argument-hint: "[path]"
allowed-tools:
  - Bash
  - AskUserQuestion
  - Agent
  - TodoWrite
---

# /aia-harness:condense-harness-prompts

Target directory: `$1` if provided, else `$CLAUDE_PROJECT_DIR`.

Executa dois estágios sequenciais nos artefatos `.claude/` do projeto alvo:

**Estágio 1 — Frontmatter validation + auto-fix**
**Estágio 2 — Condensação semântica** (via skill `condense-harness-prompts`)

---

## 1. Determinar escopo

Usar `AskUserQuestion` (header `Escopo`) com as opções abaixo — **a menos** que o usuário já tenha informado o escopo no prompt, nesse caso pular direto.

| Opção | Flags para condense.mjs |
|-------|-------------------------|
| Tudo (agents+commands+rules) | `--all` |
| Uma pasta | 2ª pergunta: agents / commands / rules → `--type <pasta>` |
| Uma skill | pedir nome da skill → `--type skills --name <nome>` |
| Um arquivo | pedir path → `--file <path>` |

**Skills: só 1 por execução** — nunca em lote.

Registrar internamente se o usuário solicitou `--skip-dedup` (pula dedup review no estágio 2).

---

## 2. Enumerar arquivos

```bash
node "${CLAUDE_PLUGIN_ROOT}/skills/condense-harness-prompts/lib/condense.mjs" \
  enumerate --root "${1:-$CLAUDE_PROJECT_DIR}" <flags do escopo>
```

Saída: `<bytes>\t<tamanho>\t<path>` por linha, ordenado maior → menor. Se vazio: avisar e parar.

Apresentar ao usuário a lista **maior → menor** com tamanho ao lado.

---

## 3. Estágio 1 — Frontmatter validation + auto-fix

Antes de comprimir, corrigir frontmatters inválidos em todos os arquivos enumerados.

```bash
node "${CLAUDE_PLUGIN_ROOT}/skills/condense-harness-prompts/lib/condense.mjs" \
  frontmatter <file1> <file2> ...
```

O comando detecta o tipo de artefato pelo path (`agent` / `skill` / `command` / `rule`) e valida/corrige automaticamente:

| Tipo | Campos obrigatórios | Correções auto-aplicadas |
|------|---------------------|--------------------------|
| `agent` | `name`, `description` | `allowed-tools` → `tools`; normaliza CSV de tools |
| `skill` | `name`, `description` | `tools` → `allowed-tools`; normaliza CSV |
| `command` | `description` | `tools` → `allowed-tools`; normaliza CSV |
| `rule` | — | — (warnings apenas: missing `paths`) |

Reportar ao usuário:
- Quantos arquivos foram corrigidos e quais erros foram encontrados
- Warnings não bloqueantes (ex: agent sem `model`, agent sem `tools`)
- Arquivos cujo tipo não foi reconhecido (skipados)

Após o relatório do estágio 1, prosseguir para o estágio 2.

---

## 4. Estágio 2 — Condensação semântica

Invocar a skill `condense-harness-prompts` para condensar os mesmos arquivos enumerados no passo 2. O escopo já foi determinado — **pular a pergunta de escopo** da skill e passar direto para o step 3 (todo list) e 4 (dispatch de subagents).

Seguir o workflow da skill exatamente:

1. `TodoWrite` um item por arquivo (se 2+ arquivos)
2. Dispatch paralelo de subagents Opus (1 por arquivo, todos no mesmo turno)
3. `commit` via condense.mjs após todos retornarem
4. Fix-loop opcional para bloqueados (máx 1-2 voltas)
5. Global Dedup Review (step 5c da skill) — exceto se `--skip-dedup` foi solicitado

---

## 5. Relatório final

Apresentar tabela consolidada:

```
Estágio 1 — Frontmatter
  N corrigido(s) · N ok · N com avisos

Estágio 2 — Condensação
  N escrito(s) · N bloqueado(s) · Xb economizados

Bloqueados (inspecionar .tmp):
  <lista de paths .condensed.tmp>
```

Se dedup review executada: incluir resumo de substituições aplicadas e bytes economizados.
