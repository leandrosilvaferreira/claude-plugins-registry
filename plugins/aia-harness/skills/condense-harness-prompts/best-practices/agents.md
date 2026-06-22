# Best Practices — Agents (`.claude/agents/`)

> Reference for compressing agent files. Apply these rules when condensing — preserve what matters, compress what is prose.

## Frontmatter fields

| Field | Required | Compressão: regra |
|-------|----------|-------------------|
| `name` | **SIM** | Preservar exato — é o identificador único; hooks recebem via `agent_type` |
| `description` | **SIM** | Comprimir prosa MAS preservar todos os triggers de delegação (ver abaixo) |
| `tools` | não | Preservar exato — define allowlist de ferramentas; omitir = herda tudo |
| `disallowedTools` | não | Preservar exato — é denylist de segurança |
| `model` | não | Preservar exato — `sonnet`/`opus`/`haiku`/`fable`/full-id/`inherit` |
| `permissionMode` | não | Preservar exato — `default`/`acceptEdits`/`auto`/`dontAsk`/`bypassPermissions`/`plan` |
| `maxTurns` | não | Preservar exato — limite de turns agentic |
| `skills` | não | Preservar exato — skills pré-carregadas no contexto do subagent |
| `mcpServers` | não | Preservar exato — MCP servers disponíveis ao subagent |
| `hooks` | não | Preservar exato — hooks scoped ao subagent |
| `memory` | não | Preservar exato — `user`/`project`/`local` |
| `background` | não | Preservar exato |
| `effort` | não | Preservar exato — `low`/`medium`/`high`/`xhigh`/`max` |
| `isolation` | não | Preservar exato — `worktree` para cópia git isolada |
| `color` | não | Preservar exato |

**Regra de ouro para frontmatter de agents:** Todos os campos são semânticos (controlam comportamento real). Nunca comprimir ou remover campos existentes — apenas o valor do campo `description` admite condensação de prosa.

## Comprimindo `description`

`description` é o campo mais crítico: Claude usa-o para decidir quando delegar. Comprimir prosa mas **preservar obrigatoriamente**:

- Padrões "Use when..." / "Use proactively after..." / "Triggers on..." — são os gatilhos de delegação
- Menções a ferramentas específicas, comandos, workflows
- Nomes de arquivos, extensões, eventos mencionados como contexto de ativação
- Exemplos concretos de quando invocar

**Comprimir:** redundâncias, artigos, hedging, explicações óbvias do que o agente faz (não do quando)

```yaml
# RUIM (muito verboso):
description: This is a specialized agent that reviews code for quality issues, best practices, security vulnerabilities, and maintainability concerns. Use it when you need to review code or check the quality of any source file.

# BOM (triggers preservados, prosa condensada):
description: Reviews code for quality, security, maintainability. Use when reviewing code, checking PRs, or analyzing source files after changes.
```

## Comprimindo o body (system prompt)

O body do agent é seu system prompt — é o ÚNICO contexto que o subagent recebe (não herda o system prompt do Claude Code).

**Comprimir agressivamente:**
- Prosa introdutória/explicativa
- Repetições de regras já ditas
- Hedging, pleasantries, fillers

**Preservar obrigatoriamente:**
- Toda regra, restrição ou comportamento específico
- Exemplos concretos de input/output
- Nomes de tools, comandos bash, paths específicos
- Thresholds numéricos e condições booleanas
- Proibições explícitas ("NEVER X", "ALWAYS Y")

## Padrão de qualidade do body

O body ideal é conciso e imperativo:

```markdown
# RUIM (prolixo):
You are a code reviewer. Your job is to analyze code that is provided to you and give feedback about the quality. When you receive code, you should look at it carefully and think about potential issues...

# BOM (imperativo):
Review code for:
1. Correctness: logic errors, edge cases, null handling
2. Security: injection, auth bypass, data exposure
3. Maintainability: naming, complexity, duplication
Return: numbered findings with file:line references.
```

## Invariantes — nunca violar ao comprimir

- `name` deve permanecer lowercase com hyphens (sem spaces, uppercase, underscores)
- `tools` e `disallowedTools` não podem ter tools removidas da lista
- Se `isolation: worktree` existe, preservar — remove isolamento se deletado
- `model` específico não deve ser removido (mudaria qual modelo executa a tarefa)
- Qualquer `permissionMode` diferente de `default` é intencional — preservar
