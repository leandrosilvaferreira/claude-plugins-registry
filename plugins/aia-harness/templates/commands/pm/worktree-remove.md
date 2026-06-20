---
description: Safely remove worktree — validates no lost work
argument-hint: "[branch|issue-number|path]"
allowed-tools: Bash(gh *), Bash(git *), Bash(bash *)
---

Config PM: !`cat .claude/pm-config.json 2>/dev/null || echo "NOT_FOUND"`
Worktrees: !`git worktree list 2>/dev/null`
Branch atual: !`git branch --show-current`

Use a skill `github-pm` para remover a worktree com segurança.
Argumento: `$ARGUMENTS` (branch, número de issue, path, ou vazio para worktree atual).

**NUNCA pule os gates abaixo:**

**Passo 1 — Gate de segurança**

```bash
bash .claude/skills/github-pm/scripts/worktree-safety-check.sh \
  "$ARGUMENTS" "<OWNER>/<REPO>"
```

- Exit 0 → capturar RESULT_WT_PATH e RESULT_WT_BRANCH do stdout, prosseguir
- Exit 1 → BLOQUEAR. Mostrar checklist ✅/❌. Encerrar sem remover.
- Exit 2 → worktree não encontrada. Listar worktrees disponíveis com `git worktree list`.

**Passo 2 — Sair da worktree (se sessão está dentro dela)**
Verificar se `$CLAUDE_WORKTREE_PATH` corresponde ao WT_PATH.
Se sim: ExitWorktree com action "keep" antes de qualquer remoção.

**Passo 3 — Gate 2: checkout principal limpo**

```bash
MAIN_ROOT=$(git rev-parse --show-toplevel)
git -C "$MAIN_ROOT" status --porcelain
```

Se sujo → ABORTAR: "Checkout principal tem mudanças não salvas."

```bash
git -C "$MAIN_ROOT" checkout main && git -C "$MAIN_ROOT" pull --ff-only
```

**Passo 4 — Remover**

```bash
git worktree remove --force "$RESULT_WT_PATH"
git branch -D "$RESULT_WT_BRANCH"
git worktree prune
```

**Passo 5 — Confirmar**

```bash
git worktree list
```

Informar ao usuário que a worktree foi removida.

REGRAS CRÍTICAS:

- NUNCA `rm -rf` antes do Passo 2 (sair primeiro)
- NUNCA remover com checklist vermelho — listar o que falta
- NÃO deletar branch remota (já removida pelo merge com --delete-branch)
