---
name: skill-loader-bang-backtick
description: Loader de skill/command executa padrão bang-backtick em QUALQUER lugar do .md (até dentro de code fence) — literal !`...` quebra o load inteiro
metadata:
  type: architecture
---

Ao carregar `SKILL.md`/command `.md`, o Claude Code processa dynamic-context bang-backtick (exclamação imediatamente seguida de comando entre crases) e executa o conteúdo como shell — **inclusive dentro de code fences e inline-code**. Um `!` colado em crase com conteúdo não-executável (ex.: três pontos, placeholder) derruba o load com `Shell command failed for pattern`. Envolver o `!` em inline-code isolado (`` `!` ``) NÃO resolve — a crase segue adjacente e o parser recaptura até a próxima crase da linha.

**Why:** custou uma invocação quebrada da skill `condense-harness-prompts` noutro projeto que consome este plugin — o padrão literal estava no template do subagent (`SKILL.md`, dentro de um fence de exemplo), parecia seguro por estar "documentando" a sintaxe, não usando de verdade.

**How to apply:** ao escrever/editar qualquer `.md` carregável (`skills/**/SKILL.md`, `commands/**`, e o que isso vira depois de instalado: `.claude/skills/**/SKILL.md`, `.claude/commands/**`), nunca deixar `!` imediatamente seguido de crase, salvo injeção dinâmica intencional num command file de verdade (ali é a feature funcionando — ver `templates/commands/pm/*.md`, uso real e correto). Pra documentar a sintaxe num best-practices/rule/agent: descrever em palavras ("bang imediatamente seguido de comando entre crases") em vez do glifo `!` colado em crase, ou inserir um espaço entre `!` e a crase pra depictar a forma com segurança (quebra a adjacência "imediata" exigida pelo trigger).

Corrigido nesta sessão: `skills/condense-harness-prompts/SKILL.md` (linha do template do subagent) e `skills/condense-harness-prompts/best-practices/commands.md` (5 ocorrências, incl. o bloco de exemplo em fence).

**Achado mas fora de escopo** (não mexido — confirmar antes de tocar): grep repo-wide (`grep -rnE '(^|[^A-Za-z0-9_])!`' ./templates`) mostra o mesmo padrão em `templates/ecc/**` (agents/rules/skills MIT-vendorizados, majoritariamente falso-positivo — operador de null-assertion Dart/Kotlin/C# tipo `` `!` ``, não a sintaxe de dynamic-context) e em `templates/rules/*/coding-standards.md` (mesma classe de falso-positivo). **Não editar `templates/ecc/**` direto** — é reescrito pelo `npm run sync:ecc` a partir do upstream via `lib/ecc/transform.mjs`; edit manual se perde no próximo sync. Se algum desses se confirmar como bug real (não apenas menção ao operador `!` de outra linguagem), o fix correto é no transform pipeline, não no arquivo vendorizado.
