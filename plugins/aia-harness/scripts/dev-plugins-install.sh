#!/usr/bin/env bash
# Dev-harness plugin install for aia-harness (this repo IS a Claude Code plugin).
# Manual, never auto-run. Installs authoring plugins that help develop plugins,
# skills, and hooks. Re-running is safe; Claude Code skips already-installed items.
set -euo pipefail

echo "aia-harness: installing plugin-authoring tooling…"

# Official Anthropic plugin marketplace. NOTE: the repo `anthropics/claude-code`
# registers under the marketplace name `claude-code-plugins` (from its
# marketplace.json), so installs target `@claude-code-plugins`, not `@claude-code`.
claude plugin marketplace add anthropics/claude-code 2>/dev/null || true
claude plugin marketplace update claude-code-plugins 2>/dev/null || true

# plugin-dev: SKILL.md structure, frontmatter, progressive disclosure, packaging.
# Complements the plugin-structure + plugin-settings skills already under .claude/skills/.
claude plugin install plugin-dev@claude-code-plugins || true

cat <<'NOTE'

Done (or already present). Verify with:
  claude plugin list

If a name differs in your registry, browse:
  claude plugin marketplace list
NOTE
