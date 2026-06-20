# Claude Plugins Registry

Public marketplace of community [Claude Code](https://claude.ai/code) plugins.

## Quick Start

```bash
# 1. Add this registry to Claude Code (once — persists globally)
claude plugin marketplace add leandrosilvaferreira/claude-plugins-registry

# 2. Install any plugin
claude plugin install <plugin-name>
```

## Available plugins

### [aia-harness](https://github.com/leandrosilvaferreira/claude-plugins-registry/tree/main/plugins/aia-harness)

**Category:** tooling

Scan any project and scaffold a complete Claude Code harness: hooks, skills, agents, rules,
settings, MCPs, worktree config, and per-domain CLAUDE.md. Full diagnose → approve → apply flow.

```bash
claude plugin install aia-harness
```

## How to install a plugin

### Prerequisites

- [Claude Code](https://claude.ai/code) CLI installed and authenticated
- macOS, Linux, or Windows (WSL)

### Step-by-step

```bash
# Step 1 — add this registry (one time only)
claude plugin marketplace add leandrosilvaferreira/claude-plugins-registry

# Step 2 — install the plugin you want
claude plugin install aia-harness

# Step 3 — confirm it's enabled
claude plugin list
# ❯ aia-harness@leandro-plugins-registry
#   Status: ✔ enabled

# Step 4 — use it in any project
cd /path/to/your-project
claude
# /aia-harness:scan    ← diagnose (read-only)
# /aia-harness:init    ← full scaffold with consent + diffs
```

### Update a plugin

```bash
claude plugin update aia-harness
```

### Uninstall

```bash
claude plugin uninstall aia-harness
```

### Remove this registry

```bash
claude plugin marketplace remove leandro-plugins-registry
```

## Publish your plugin

See [CONTRIBUTING.md](./CONTRIBUTING.md) for how to add your plugin to this registry.

**TL;DR:**

1. Your plugin needs a public GitHub repo with `.claude-plugin/plugin.json`
2. Fork this repo, add your entry to `.claude-plugin/marketplace.json`
3. Open a PR — CI validates the manifest automatically

## Schema

Every entry in `.claude-plugin/marketplace.json` must conform to the Claude Code marketplace schema.
PRs are validated via GitHub Actions before merge.
