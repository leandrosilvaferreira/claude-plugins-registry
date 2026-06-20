---
description: Commit, push, and open PR linked to the issue
allowed-tools: Bash(git *), Bash(gh *), AskUserQuestion
---

Branch atual: !`git branch --show-current`
Status: !`git status --short`
Diff: !`git diff HEAD --stat`
Config PM: !`cat .claude/pm-config.json 2>/dev/null || echo "NOT_FOUND"`
Issues linked (via branch name): !`git branch --show-current | grep -oE '[0-9]+' | head -1 | xargs -I{} gh issue view {} --json number,title 2>/dev/null || echo "none"`

Use a skill `github-pm` para executar este workflow:

1. GATE OBRIGATÓRIO: se branch atual = `main` ou `master` → PARAR.
   Instruir o usuário a criar uma branch primeiro (`/pm:worktree-new` ou `git checkout -b`).

2. Analisar `git diff HEAD` para gerar mensagem de commit (conventional commits):
   - feat: nova funcionalidade
   - fix: correção de bug
   - chore: manutenção/infra
   - docs: documentação
   - refactor: refatoração sem mudança de comportamento
   - test: testes

3. Propor commit message e mostrar ao usuário. Aguardar confirmação.

4. Commitar:

   ```bash
   git add -A && git commit -m "<mensagem aprovada>"
   ```

5. Push (criar upstream se necessário):

   ```bash
   git push -u origin <BRANCH> 2>/dev/null || git push origin <BRANCH>
   ```

6. Detectar issue pelo nome da branch (ex: `feat/42-*` → issue #42).
   Criar PR com "Closes #N" no body se issue detectada:

   ```bash
   gh pr create \
     --title "<título baseado no commit>" \
     --body "## Resumo\n\n<descrição>\n\nCloses #<N>" \
     --base main
   ```

7. Reportar URL do PR. Sugerir: "Rode `/pm:code-review-pr <PR>` para iniciar review."
