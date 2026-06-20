---
description: Close an issue after validating acceptance criteria
argument-hint: "[issue-number]"
allowed-tools: Bash(gh *)
---

Issue: !`gh issue view ${ARGUMENTS:-} --json number,title,body,state 2>/dev/null || echo "NOT_FOUND"`
Config PM: !`cat .claude/pm-config.json 2>/dev/null || echo "NOT_FOUND"`

Use a skill `github-pm` para executar o workflow de fechamento de issue (Workflow 3).
Número da issue: `$ARGUMENTS`.

OBRIGATÓRIO: validar critérios de aceite no body antes de fechar. Nunca fechar sem esta validação.
