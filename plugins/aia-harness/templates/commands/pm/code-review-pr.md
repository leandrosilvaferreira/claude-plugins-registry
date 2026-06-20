---
description: Parallel code review of a PR using subagents
argument-hint: "[pr-number]"
allowed-tools: Bash(gh *), Bash(bash *), Bash(python3 *)
---

Config PM: !`cat .claude/pm-config.json 2>/dev/null || echo "NOT_FOUND"`
PR info: !`gh pr view ${ARGUMENTS:-} --json number,title,state,isDraft,headRefName,body 2>/dev/null || echo "NOT_FOUND"`
Diff stat: !`gh pr diff ${ARGUMENTS:-} --stat 2>/dev/null || echo "NOT_FOUND"`

Use a skill `github-pm` para executar o code review paralelo.
Número do PR: `$ARGUMENTS`.

**Sequência obrigatória:**

1. **Haiku agent** → elegibilidade: PR fechado? Já revisado sem fixes pendentes? Automatizado?
   Se não elegível → reportar motivo e encerrar.

2. **Haiku agent** → listar CLAUDE.md relevantes do codebase.

3. **Haiku agent** → resumo das mudanças do PR (arquivos, propósito, escopo).

4. **6 agentes Sonnet em paralelo** (dispatch único, não sequencial):
   - #1: Conformidade com CLAUDE.md do projeto
   - #2: Scan de bugs nas linhas modificadas (somente diff, não todo o arquivo)
   - #3: Git blame e histórico dos arquivos modificados
   - #4: PRs anteriores que tocaram os mesmos arquivos
   - #5: Comentários inline nos arquivos modificados (TODO, FIXME, HACK)
   - #6: Over-engineering, YAGNI, duplicações, abstrações desnecessárias

5. Para cada issue encontrada: **Haiku agent de scoring** (0-100).
   Critérios: severidade, certeza, impacto no usuário.

6. Filtrar: manter apenas issues com score ≥ 60.

7. **Re-check de elegibilidade** (Haiku): alguma issue já foi corrigida entre os passos?

8. Postar resultado no PR:

   ```bash
   gh pr comment $ARGUMENTS --body "<resultado formatado com links file:sha#L>"
   ```

   Formato: sem emojis; links `owner/repo/blob/<sha>/<file>#L<line>`; agrupado por severidade.

9. Mensagem terminal:
   - Issues encontradas → "Para corrigir automaticamente: `/orchestrate`"
   - Nenhuma issue + CI verde → "PR pronto para merge: `/pm:pr-merge $ARGUMENTS`"
   - Nenhuma issue + CI pendente/falhando → informar e não sugerir merge
