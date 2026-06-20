---
description: Safely merge a PR — validates CI before merging
argument-hint: "[pr-or-issue-number]"
allowed-tools: Bash(gh *), Bash(git *), Bash(bash *), Bash(python3 *)
---

Config PM: !`cat .claude/pm-config.json 2>/dev/null || echo "NOT_FOUND"`
Branch atual: !`git branch --show-current`

Use a skill `github-pm` para executar o merge seguro. O argumento `$ARGUMENTS`
pode ser número de PR ou número de issue.

**NUNCA pule os gates abaixo. Esta é a sequência obrigatória:**

**Passo 1 — Identificar PR**

- Tentar direto como PR number: `gh pr view $ARGUMENTS --json number`
- Se falhar: buscar PR com branch `feat/$ARGUMENTS-*` ou body com `Closes #$ARGUMENTS`

  ```bash
  gh pr list --json number,headRefName,body | python3 -c "
  import sys,json; prs=json.load(sys.stdin)
  n=int('$ARGUMENTS')
  for p in prs:
    if f'/{n}-' in p['headRefName'] or f'#{n}' in p.get('body',''):
      print(p['number']); break
  "
  ```

**Passo 2 — Verificar draft**

```bash
gh pr view $PR_NUMBER --json isDraft --jq '.isDraft'
```

Se true → perguntar ao usuário se marca como ready:

```bash
gh pr ready $PR_NUMBER
```

Depois aguardar CI: `gh pr checks $PR_NUMBER --watch`

**Passo 3 — Gate autoritativo (SEMPRE executar, NUNCA pular)**

```bash
bash .claude/skills/github-pm/scripts/check-pr-status.sh $PR_NUMBER <OWNER>/<REPO>
```

- Exit 0 → prosseguir
- Exit 1 → BLOQUEAR. Listar falhas, não merge.
- Exit 2 → perguntar se aguarda (`gh pr checks $PR_NUMBER --watch`), re-rodar gate
- Exit 3 → ENCERRAR (PR inválido)
- Exit 4 → avisar "CI verde mas sem review aprovado". Perguntar se prossegue mesmo assim.

**Passo 4 — Detectar estratégia de merge**

```bash
gh repo view --json squashMergeAllowed,rebaseMergeAllowed,mergeCommitAllowed \
  --jq 'if .squashMergeAllowed then "--squash" elif .rebaseMergeAllowed then "--rebase" else "--merge" end'
```

**Passo 5 — Merge**

```bash
gh pr merge $PR_NUMBER $MERGE_FLAG --delete-branch
```

Se exit ≠ 0 → reportar erro exato, ENCERRAR sem pós-merge.

**Passo 6 — Pós-merge (somente se merge com exit 0)**

- Comentar na issue: "PR #$PR_NUMBER mergeado ✅"
- Fechar issue: `gh issue close $ISSUE_NUMBER --repo <OWNER>/<REPO>`
- Mover para Done no Projects v2 (usar pm-config.json)

**Passo 7 — Cleanup**

- Se em worktree → perguntar: "Deseja remover a worktree? (`/pm:worktree-remove`)"
- Se no checkout principal: `git checkout main && git pull --ff-only`

REGRAS CRÍTICAS (nunca violar):

- NUNCA `gh pr merge` sem gate do Passo 3 com exit 0 (ou exit 4 + confirmação explícita)
- NUNCA fechar issue antes de confirmar exit 0 do merge
- NUNCA `--admin` sem pedido explícito + confirmação dupla
