---
description: Create a new GitHub issue and add it to the project board
argument-hint: "[description]"
allowed-tools: Bash(gh *), Bash(git *), Write
---

Config PM: !`cat .claude/pm-config.json 2>/dev/null || echo "NOT_FOUND"`
Remote: !`git remote get-url origin 2>/dev/null || echo "unknown"`

Use a skill `github-pm` para executar o workflow de criação de issue (Workflow 1).
Para CRUD da issue, a skill `github-issues` fornece as ferramentas MCP necessárias.

Se argumento fornecido (`$ARGUMENTS`), use como título inicial da issue.
Confirme título, tipo (bug/feature/task) e critérios de aceite com o usuário antes de criar.
