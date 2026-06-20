---
description: Show open issues grouped by Projects v2 status
allowed-tools: Bash(gh *)
---

Config PM: !`cat .claude/pm-config.json 2>/dev/null || echo "NOT_FOUND"`
Remote: !`git remote get-url origin 2>/dev/null || echo "unknown"`

Use a skill `github-pm` para executar o workflow de visualização de backlog (Workflow 4).

Apresente as issues agrupadas por status (Triage / Backlog / In Progress / In Review).
Destaque issues In Progress sem atividade recente e issues Triage há mais de 3 dias.
