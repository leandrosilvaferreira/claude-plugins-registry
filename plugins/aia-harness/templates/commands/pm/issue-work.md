---
description: Work on a GitHub issue: set In Progress + worktree
argument-hint: "[issue-number]"
allowed-tools: Bash(gh *), Bash(git *)
---

Issue: !`gh issue view ${ARGUMENTS:-} --json number,title,labels,body 2>/dev/null || echo "NOT_FOUND"`
Config PM: !`cat .claude/pm-config.json 2>/dev/null || echo "NOT_FOUND"`
Worktrees existentes: !`git worktree list 2>/dev/null`

Use a skill `github-pm` para executar o workflow de início de trabalho (Workflow 2).
Número da issue: `$ARGUMENTS`.

A skill irá:

1. Ler detalhes da issue
2. Sugerir nome da branch (tipo/N-slug)
3. Criar worktree em .claude/worktrees/
4. Mover issue para In Progress no Projects v2
5. Comentar na issue
