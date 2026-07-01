---
name: commands-project-dir-not-guaranteed
description: $CLAUDE_PROJECT_DIR só é garantido dentro de hooks; commands/*.md (Bash tool comum) não é coberto por hooks-cwd-resolution.md e falha silencioso
metadata:
  type: architecture
---

`$CLAUDE_PROJECT_DIR` só é documentado/garantido como env var dentro da execução de **hooks** — não dentro do Bash tool de uso geral que o agente usa para rodar as instruções de `commands/*.md`. A regra `.claude/rules/hooks-cwd-resolution.md` cobre só o caso de hooks; `commands/*.md` é um caminho de código estruturalmente diferente (prompt interpretado pelo agente, não subprocess de hook invocado pelo Claude Code) e não estava coberto por aquela regra até 2026-07-01.

**Why:** Confirmado empiricamente numa sessão real: `echo "$CLAUDE_PROJECT_DIR"` imprimiu vazio dentro de uma chamada Bash depois que o agente deu `cd` pro scratchpad. Todo `commands/*.md` usava o padrão `"${1:-$CLAUDE_PROJECT_DIR}"` repetido em várias chamadas Bash separadas dentro do fluxo de um único comando — quando a var vinha vazia, caía silenciosamente no fallback pra `process.cwd()` (o cwd real da chamada Bash, não necessariamente o projeto). Isso fez um dry-run de `apply` do `doctor` reportar o diretório do scratchpad como se fosse o alvo (`created: <90 artefatos>` como se nada existisse), em vez de dar erro alto. Corrigido nos 10 comandos que resolvem diretório-alvo, cada um marcado com `<!-- aia-harness:target-dir-resolution -->` pra edição sincronizada futura — ver `docs/superpowers/plans/2026-07-01-cli-invocation-regression-fix.md`.

**How to apply:** Todo comando NOVO em `commands/*.md` que resolva diretório-alvo via `$CLAUDE_PROJECT_DIR` precisa da mesma orientação ("resolver uma vez no início num path absoluto literal, nunca reexpandir `$CLAUDE_PROJECT_DIR` bare depois de um `cd`") — copiar o parágrafo de qualquer um dos 10 arquivos marcados em vez de rederivar. É uma preocupação DIFERENTE de `.claude/rules/hooks-cwd-resolution.md`, que só rege resolução de `event.cwd`/`CLAUDE_PROJECT_DIR` dentro de hooks — aquela regra não cobre este caso de commands/*.md.
