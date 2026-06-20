# Claude Plugins Registry

Public index of community [Claude Code](https://claude.ai/code) plugins.

## Install a plugin

```bash
claude plugin add <installUrl>
```

Find `installUrl` in [registry.json](./registry.json) or browse the table below.

## Available plugins

| Name | Category | Description |
|------|----------|-------------|
| [aia-harness](https://github.com/leandrosilvaferreira/aia_harness) | tooling | Scan a project and scaffold a complete Claude Code harness: hooks, skills, agents, rules, settings, MCPs, worktree config and per-domain CLAUDE.md |

## Publish your plugin

See [CONTRIBUTING.md](./CONTRIBUTING.md).

## Schema

Every entry in `registry.json` must conform to [`schema/plugin.schema.json`](./schema/plugin.schema.json).  
PRs are validated automatically via GitHub Actions.

## Categories

`tooling` · `testing` · `deployment` · `code-quality` · `documentation` ·  
`integration` · `ai-workflow` · `security` · `database` · `frontend` · `backend` · `devops` · `other`
