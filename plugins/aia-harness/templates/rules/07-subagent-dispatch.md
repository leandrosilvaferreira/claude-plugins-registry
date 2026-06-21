---
paths:
  - "**/*"
---

# Subagent Dispatch

## Regra

Ao despachar subagentes para qualquer tarefa de implementação, revisão ou análise:

1. **Consulte a tabela `## Workflow & Agents` no CLAUDE.md** antes de escolher o agente.
2. **Use o especialista correspondente** ao tipo de tarefa — nunca o agente genérico quando um especialista estiver listado.
3. **Passe o nome exato** como `subagent_type` no despacho.

## Mapeamento de tarefas → agentes

| Tipo de tarefa | Agente a usar |
|---|---|
| Implementação de código | especialista de stack (ex: `php-reviewer`, `go-reviewer`) |
| Revisão de código | `code-reviewer` + especialista de stack + `security-reviewer` |
| Revisão de segurança | `security-reviewer` |
| Orquestração de fluxo complexo | `orchestrator` |

Se nenhum especialista cobrir a tarefa, use o agente genérico como fallback.
