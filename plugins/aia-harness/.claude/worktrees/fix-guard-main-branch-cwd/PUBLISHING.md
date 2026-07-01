# Publishing to the Registry

Covers bumping the version, syncing to [claude-plugins-registry](https://github.com/leandrosilvaferreira/claude-plugins-registry), and tagging a release.

## Quick release

```bash
npm run publish-registry
```

Interactive flow:

```
Current version: 0.1.1
Bump type? [patch (0.1.2) / minor (0.2.0) / major (1.0.0) / skip]
> patch

✔  Version bumped: 0.1.1 → 0.1.2
Plugin SHA: abc123...
Syncing plugin files to registry...
✔  Registry updated.

Create git tag v0.1.2? [Y/n]
Push both repos to GitHub? [Y/n]
✔  aia-harness@0.1.2 is live!
```

## Non-interactive (CI / scripts)

```bash
BUMP=patch npm run publish-registry   # patch, no prompts
BUMP=minor npm run publish-registry
BUMP=major npm run publish-registry
BUMP=skip  npm run publish-registry   # sync only, no version bump
```

Point to a registry at a custom path:

```bash
REGISTRY_DIR=/path/to/other/registry npm run publish-registry
```

## What the script does

| Step | Action |
|------|--------|
| 1 | Bump `plugin.json` + `package.json` → commit in plugin repo |
| 2 | `rsync` plugin files → `registry/plugins/aia-harness/` |
| 3 | Commit sync in registry |
| 4 | Update `sha` pin in `marketplace.json` → commit in registry |
| 5 | Create annotated git tag `vX.Y.Z` (optional) |
| 6 | `git push --follow-tags` in plugin repo + `git push` in registry |

## Bump type guide

| Type | When to use | Example |
|------|-------------|---------|
| `patch` | Bug fixes, doc updates, small tweaks | `0.1.1 → 0.1.2` |
| `minor` | New commands, skills, agents (backwards-compatible) | `0.1.1 → 0.2.0` |
| `major` | Breaking changes, renamed commands, removed features | `0.1.1 → 1.0.0` |
| `skip` | Re-sync registry without changing version | — |

## Registry location

Default: `../claude-plugins-registry` (sibling directory).
Override with `REGISTRY_DIR` env var or first CLI argument:

```bash
node scripts/publish-to-registry.mjs /absolute/path/to/registry
```

## After publishing

Users already installed get the update with:

```bash
claude plugin update aia-harness@leandro-plugins-registry
```
