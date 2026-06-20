---
description: Create worktree for issue with auto-named branch
argument-hint: "[issue-number]"
allowed-tools: Bash(gh *), Bash(git *), AskUserQuestion
---

Issue: !`gh issue view ${ARGUMENTS:-} --json number,title,labels 2>/dev/null || echo "NOT_FOUND"`
Config PM: !`cat .claude/pm-config.json 2>/dev/null || echo "NOT_FOUND"`
Worktrees existentes: !`git worktree list 2>/dev/null`
Branch atual: !`git branch --show-current`

Use a skill `github-pm` para executar o workflow de criação de worktree:

1. Ler `gh issue view $ARGUMENTS --json title,labels` para determinar tipo e título.
2. Gerar slug: tipo/N-titulo-em-kebab-case (máx 60 chars; especiais → `-`)
   - tipo: `feat` (feature/enhancement), `fix` (bug), `chore` (task), `docs`
   - Exemplo: `feat/42-add-payment-flow`
3. Confirmar nome da branch com o usuário via AskUserQuestion.
4. Se worktree já existe para o slug → avisar e perguntar se reabre.
5. Criar worktree:

   ```bash
   git worktree add .claude/worktrees/<SLUG> -b <SLUG>
   ```

6. Entrar na worktree via EnterWorktree (se disponível) ou instruir o usuário.
7. Comentar na issue: "🤖 Worktree criada: branch `<SLUG>`"
8. Mover issue para In Progress no Projects v2 (usar pm-config.json).

REGRAS:

- NUNCA criar sem `-b <SLUG>` (sempre nova branch)
- NUNCA partir de main sem criar branch separada
