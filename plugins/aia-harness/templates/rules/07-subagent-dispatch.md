---
paths:
  - "**/*"
---

# Subagent Dispatch

## Rule

When dispatching subagents for any implementation, review, or analysis task:

1. **Consult the `## Workflow & Agents` table in CLAUDE.md** before choosing an agent.
2. **Use the specialist that matches** the task type — never the generic agent when a specialist is listed.
3. **Pass the exact name** as `subagent_type` in the dispatch.

## Task → agent mapping

| Task type | Agent to use |
|---|---|
| Code implementation | stack specialist (e.g. `php-reviewer`, `go-reviewer`) |
| Code review | `code-reviewer` + stack specialist + `security-reviewer` |
| Security review | `security-reviewer` |
| Complex flow orchestration | `orchestrator` |

If no specialist covers the task, use the generic agent as a fallback.
