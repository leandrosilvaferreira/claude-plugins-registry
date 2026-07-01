---
name: claude-plugin-cli-and-marketplace-autoupdate
description: claude plugin list/update/marketplace update are real non-interactive CLI subcommands; third-party marketplaces default auto-update OFF, which is why an installed plugin silently goes stale
metadata:
  type: architecture
---

`claude plugin list [--json] [--available]`, `claude plugin update <name>@<marketplace>`,
and `claude plugin marketplace update <marketplace>` are real, scriptable, non-interactive
CLI subcommands (confirmed by running them directly) — distinct from the interactive
`/plugin` TUI menu. `claude plugin update` explicitly documents "restart required to
apply"; there is no way to hot-apply a plugin update to the *currently running* session
(and the model cannot invoke `/reload-plugins` itself either — see
[[claude-cannot-invoke-builtin-slash-commands]]).

`claude plugin list --json` returns each installed plugin's `id` (`<name>@<marketplace>`)
and installed `version` in one call. After `claude plugin marketplace update <marketplace>`,
the refreshed registry clone lives at `~/.claude/plugins/marketplaces/<marketplace>/`, and
a plugin's manifest is readable directly at `plugins/<name>/.claude-plugin/plugin.json`
inside that clone — no hand-rolled network fetch needed to check the latest published
version.

**Why this matters:** official Anthropic marketplaces auto-update at session start by
default; **third-party and local marketplaces default to auto-update OFF**. Nothing
refreshes a third-party marketplace's cache unless the user manually toggles this on,
runs `claude plugin marketplace update`, or a plugin ships its own check (e.g. this
repo's own `hooks/scripts/check-plugin-update.mjs`, added specifically because of this
gap). Concretely observed in this repo: the installed `aia-harness` plugin sat at v0.3.0
locally while the registry had already moved to v0.3.1 — silently, with nothing
surfacing the drift.

**How to apply:** when building any "check for plugin update" feature, use these CLI
subcommands as the mechanism (not a hand-rolled marketplace.json fetch) — they're
sanctioned, cover version comparison and the actual install/update in one step, and stay
in sync with however Claude Code's own marketplace resolution evolves.
