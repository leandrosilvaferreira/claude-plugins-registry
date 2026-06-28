---
name: hooks-mjs-only
description: "Hooks devem ser .mjs, validados pelo schema de saída do Claude Code, cobertos por testes unitários e passar lint/typecheck"
metadata: 
  node_type: memory
  type: feedback
  originSessionId: e34c2484-ace8-4eeb-af9c-9fbb6c9fefe1
--- 

Hooks devem seguir TODAS as regras abaixo:

1. **Extensão `.mjs` obrigatória** — nunca `.js`, `.ts` ou `.sh`. **Why:** compatibilidade multiplataforma (macOS/Linux/Windows) sem compilador ou shell externo.

2. **Schema de saída validado** — toda saída de hook deve passar pelo validator correspondente de `lib/validate/hook-schema.mjs` para o tipo de evento (`PreToolUse`, `PostToolUse`, `Stop`, etc.). Cobrir **todos os branches** de saída possíveis, não apenas o caminho feliz. **Why:** hook com saída malformada falha silenciosamente em produção.

3. **Testes unitários obrigatórios** — cada hook distribuído em `templates/hooks/` deve ter `tests/hook-<name>.test.mjs` importando o validator e assertando cada branch. **Why:** sem teste, regressões passam despercebidas.

4. **Lint + typecheck limpos** — hooks devem passar `npm run lint` e `npm run typecheck` (JSDoc + checkJs). **Why:** erros pré-existentes não são desculpa para adicionar mais.

**How to apply:** ao criar ou modificar qualquer hook, **ler e seguir** [.claude/rules/hooks-cross-platform.md](../rules/hooks-cross-platform.md) (regra path-scoped completa: exec form, padrões de portabilidade `os`/`path`, armadilhas Windows, `windowsHide: true` obrigatório em todo spawn) e aplicar as 4 regras acima antes de encerrar. Rodar `npm test` para confirmar. Não reportar erros de lint/typecheck como "pré-existentes não relacionados".
