---
name: secrets-file-model
description: Where the harness expects secrets — .env/.env.local vs settings.local.json (MCP only)
metadata:
  type: project
---

The harness has two distinct secret stores; do not conflate them in generated CLAUDE.md/comments:

- **Project secrets / env vars** → `.env` / `.env.local` at project root (gitignored). This is the common case. `lib/generate/settings.mjs` deny-list already blocks `Read(./.env*)`, confirming the model.
- **`.claude/settings.local.json`** → ONLY MCP-server credentials (env vars referenced by `.mcp.json`). It is fed exclusively by `renderSettingsLocal(envPlaceholders)`, whose input comes from mcp-catalog `envPlaceholders`.

**Why:** user flagged that the generated fixed rule wrongly said all env values belong in `settings.local.json`. Fixed in `ROOT_FIXED_RULES` ([claude-md.mjs](../../lib/generate/claude-md.mjs)) and the settings.local.json `$comment`.

**How to apply:** when writing any rule/comment/doc about secrets, route project secrets to `.env`/`.env.local` and reserve `settings.local.json` for MCP credentials. `misc.mjs` install-script line is already MCP-specific and correct.
