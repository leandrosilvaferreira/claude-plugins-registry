# Best Practices — Commands (`.claude/commands/<name>.md`)

> Reference for compressing command files. Commands são markdown simples (não diretório), invocados via `/name`. Usam `allowed-tools` (NÃO `tools`). O body é o prompt enviado ao Claude quando o comando é invocado.

## Frontmatter fields

| Field | Required | Compressão: regra |
|-------|----------|-------------------|
| `description` | **SIM** | Comprimir prosa MAS preservar o que descreve o propósito — aparece no autocomplete |
| `allowed-tools` | não | Preservar exato — allowlist de tools para execução do comando |
| `argument-hint` | não | Preservar exato — hint de tab-completion, ex: `[path]`, `<branch>` |
| `model` | não | Preservar exato — override de modelo para este comando |
| `disable-model-invocation` | não | Preservar exato — `true` = só usuário pode invocar |

**Atenção:** Commands usam `allowed-tools`, não `tools`. Se o arquivo usa `tools`, é erro de frontmatter (corrigido pelo validador antes da compressão).

## Diferença crítica: command vs skill

- **Command** (`.claude/commands/name.md`): arquivo único, sem estrutura de diretório
- **Skill** (`.claude/skills/name/SKILL.md`): diretório com SKILL.md + arquivos auxiliares opcionais

Ambos criam `/name` — mas commands são mais simples e adequados para fluxos lineares sem necessidade de arquivos auxiliares.

## Comprimindo `description`

`description` aparece no autocomplete e na lista de comandos disponíveis. É mais curta que descrição de skill — foca no O QUÊ, não no QUANDO.

```yaml
# RUIM:
description: This command helps you create a git commit with a well-formatted commit message by analyzing the current staged changes and generating an appropriate message.

# BOM:
description: Create a git commit with an appropriate message based on staged changes.
```

## Comprimindo o body

O body é o prompt completo enviado ao Claude quando `/name` é invocado. É uma instrução de tarefa.

**Preservar obrigatoriamente:**
- Blocos bash com comandos exatos e flags (`"${CLAUDE_PLUGIN_ROOT}/bin/..."`  etc.)
- Variáveis de contexto: `$1`, `$ARGUMENTS`, `${CLAUDE_PROJECT_DIR}`, `${CLAUDE_PLUGIN_ROOT}`
- Sintaxe de dynamic context: `!`` `git status` ``` — injeta saída de comando no prompt
- Seções numeradas de workflow com passos obrigatórios
- Tabelas de mapeamento (ex: categoria → IDs de artefatos)
- Lógica condicional ("se X então Y, caso contrário Z")
- Exemplos de output esperado
- Chamadas a `AskUserQuestion` com opções definidas
- Código bash inline com heredoc (ex: passagem de commit message)
- Paths absolutos e padrões de glob

**Comprimir agressivamente:**
- Prosa de apresentação/contextualização ("This command runs...")
- Explicações óbvias de passos triviais
- Repetições entre seções
- Hedging e fillers

## Padrão de estrutura ótima

```markdown
---
description: <o que faz, curto>
argument-hint: [argumento opcional]
allowed-tools: Tool1, Tool2
---

# /plugin:command-name

Target: `$1` if provided, else `$CLAUDE_PROJECT_DIR`.

## 1. <Passo inicial>

[instrução imperativa + bash se necessário]

## 2. <Próximo passo>

```bash
<comando exato>
```

[o que fazer com o output]
```

## Dynamic context injection

O padrão `!`` `` é processado quando o comando é carregado — o resultado entra no prompt. Preservar exato:

```markdown
## Current state

- Status: !`git status`
- Diff: !`git diff HEAD`
```

## Invariantes — nunca violar ao comprimir

- `$1`, `$ARGUMENTS`, `${CLAUDE_PROJECT_DIR}`, `${CLAUDE_PLUGIN_ROOT}` — variáveis de substituição; preservar exatas
- `!`` `command` `` ` — dynamic context; preservar exatos (o backtick triplo e o comando dentro)
- Caminhos com `"${CLAUDE_PLUGIN_ROOT}/..."` — aspas duplas e interpolação são necessárias para paths com espaços
- Opções de `AskUserQuestion` — cada opção define um caminho de fluxo; remoção quebra o comando
- `allowed-tools: Bash(pattern)` — pattern restringe quais comandos bash são permitidos; não simplificar para `Bash`
- Qualquer markdown table com mapeamento de IDs/categorias — são lookups estruturais do comando
