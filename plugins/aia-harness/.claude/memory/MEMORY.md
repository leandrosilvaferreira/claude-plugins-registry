# Memory index

- [secrets-file-model](secrets-file-model.md) — project secrets in .env/.env.local; settings.local.json is MCP-credentials-only
- [cross-platform-artifacts](cross-platform-artifacts.md) — artefatos gerados devem ser .mjs, nunca .sh — plugin é cross-platform (Win/Mac/Linux)
- [hooks-mjs-only](hooks-mjs-only.md) — hooks: .mjs obrigatório, schema de saída validado, testes unitários por branch, lint/typecheck limpos
- [node-runtime-nvm](node-runtime-nvm.md) — node não está no PATH em shells não-interativos; usar path do nvm ou resolver
- [project-level-only](project-level-only.md) — ferramentas/config instaladas em .claude/ do repo, nunca global (~/.claude)
- [publish-registry-command](publish-registry-command.md) — bump de versão e publicar plugin via BUMP/PUSH/TAG env vars + npm run publish-registry
- [gh-pr-token-404](gh-pr-token-404.md) — gh PR/API dá 404 neste repo (escopo do token); usar git SSH para push/merge
- [hook-placeholder-braces](hook-placeholder-braces.md) — hooks exec-form (args) só expandem ${VAR} com chaves, nunca $VAR bare — bare quebra silenciosamente
- [merge-settings-hooks-dedup-key](merge-settings-hooks-dedup-key.md) — mergeSettingsHooks só adiciona hooks faltantes; nunca repara valor de hook existente
- [subagent-worktree-drift](subagent-worktree-drift.md) — subagent via Agent tool não herda EnterWorktree; pode commitar em main por engano (visto 2x com haiku)
- [controller-session-worktree-cwd-drift](controller-session-worktree-cwd-drift.md) — sessão controller (não só subagent) também sofre drift de cwd pra fora da worktree; usar `git -C`/`cd &&` sempre; ExitWorktree perde tracking após reentrada via path
- [claude-plugin-cli-and-marketplace-autoupdate](claude-plugin-cli-and-marketplace-autoupdate.md) — claude plugin list/update/marketplace update são CLI reais; marketplaces de terceiros não auto-atualizam por padrão
- [claude-cannot-invoke-builtin-slash-commands](claude-cannot-invoke-builtin-slash-commands.md) — modelo não consegue rodar /reload-plugins ou outro slash command nativo sozinho; só humano ou sessão nova
- [hook-type-table-stale](hook-type-table-stale.md) — tabela de 14 tipos de hook no CLAUDE.md/hook-schema.mjs está desatualizada; plataforma tem mais tipos (UserPromptExpansion, TaskCreated, etc.)
- [claude-plugin-data-is-a-directory](claude-plugin-data-is-a-directory.md) — ${CLAUDE_PLUGIN_DATA} é diretório (~/.claude/plugins/data/{id}/), não arquivo — passar puro como cache-file causa EISDIR silencioso
- [readline-question-close-race](readline-question-close-race.md) — ask() com node:readline pode perder resposta "y" via pipe — rl.close() dispara 'close' antes do próprio res(answer); precisa flag `answered`
