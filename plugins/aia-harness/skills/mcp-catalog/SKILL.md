---
name: mcp-catalog
description: Use when choosing, recommending, or wiring MCP servers for a project's .mcp.json. Curated list of strategic MCP servers with safe configuration (env placeholders, scoping). Triggers on "add an MCP", "which MCP servers", "configure .mcp.json", "strategic MCPs".
---

# Strategic MCP catalog

Curated MCP servers worth adding to a project, and how to wire them safely. The
machine-readable source is `lib/data/mcp-catalog.mjs`; `aia-harness plan --json`
emits the recommended subset for the current project.

## Catalog

| Server | When to add | Secrets |
|--------|-------------|---------|
| **context7** | Default. Up-to-date library/framework docs. Marginal for dependency-light repos (e.g. tooling-only); high value for React/DB/large-dep projects. | none |
| **sequential-thinking** | Always. Structured multi-step reasoning. | none |
| **github** | **Default for any git repo** — issues, PRs, releases, review in the dev loop. Prereq: `gh` CLI (token via `gh auth token`). | `GITHUB_PERSONAL_ACCESS_TOKEN` |
| **playwright** | Project has Playwright/Cypress. Browser e2e. | none |
| **postgres** | Project uses PostgreSQL. Schema + read queries. | `DATABASE_URL` |
| **filesystem** | Needs access outside the project dir. | none |
| **memory** | Want persistent knowledge-graph memory across sessions. | none |
| **parallel-search** | Want citation-backed web search (HTTP, key-free). | none |
| **supabase** | Project uses managed Postgres (Supabase). | `SUPABASE_ACCESS_TOKEN` |

## Wiring rules (non-negotiable)

- Write servers to the **project-root `.mcp.json`** (committed, team-shared).
- Use `${ENV_VAR}` placeholders for every secret — never a literal token. Put the
  real values in `.claude/settings.local.json` under `env` (gitignored).
- Keep the set **small** (high-signal only). Each server costs context; the
  practitioner rule of thumb is under ~5 servers. Tool Search defers schemas, so
  prefer adding a server over inlining its docs.
- Never set `enableAllProjectMcpServers: true`.
- After editing `.mcp.json` or env, the user must **restart Claude Code**.

## Example `.mcp.json`

```json
{
  "mcpServers": {
    "context7": { "type": "stdio", "command": "npx", "args": ["-y", "@upstash/context7-mcp@latest"] },
    "github": { "type": "http", "url": "https://api.githubcopilot.com/mcp/", "env": { "Authorization": "Bearer ${GITHUB_PERSONAL_ACCESS_TOKEN}" } }
  }
}
```
