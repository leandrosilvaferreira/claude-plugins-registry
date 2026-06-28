# Memory index

- [secrets-file-model](secrets-file-model.md) — project secrets in .env/.env.local; settings.local.json is MCP-credentials-only
- [cross-platform-artifacts](cross-platform-artifacts.md) — artefatos gerados devem ser .mjs, nunca .sh — plugin é cross-platform (Win/Mac/Linux)
- [hooks-mjs-only](hooks-mjs-only.md) — hooks: .mjs obrigatório, schema de saída validado, testes unitários por branch, lint/typecheck limpos
- [node-runtime-nvm](node-runtime-nvm.md) — node não está no PATH em shells não-interativos; usar path do nvm ou resolver
- [project-level-only](project-level-only.md) — ferramentas/config instaladas em .claude/ do repo, nunca global (~/.claude)
- [publish-registry-command](publish-registry-command.md) — bump de versão e publicar plugin via BUMP/PUSH/TAG env vars + npm run publish-registry
