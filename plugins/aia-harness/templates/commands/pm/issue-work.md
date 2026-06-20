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

## Após concluir o setup da issue

Quando o worktree estiver criado e a issue em In Progress, invoque a skill
`superpowers:brainstorming` passando o contexto completo da issue:

```text
Issue #<N>: <title>
Labels: <labels>
Body:
<body>

Objetivo: gerar um plano de implementação detalhado com abordagem técnica,
arquitetura, arquivos a criar/modificar, casos de borda e ordem de execução.
```

A skill produzirá um plano estruturado. Apresente o plano ao usuário e aguarde
confirmação antes de iniciar a implementação.

**Quando o usuário aprovar o plano**, use a skill `superpowers:writing-plans`
para registrar o plano e em seguida inicie a implementação seguindo a ordem
definida no plano aprovado.
