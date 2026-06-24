#!/usr/bin/env node
/**
 * Dev-harness plugin install for aia-harness (this repo IS a Claude Code plugin).
 * Manual, never auto-run. Installs authoring plugins that help develop plugins,
 * skills, and hooks. Re-running is safe; Claude Code skips already-installed items.
 * Cross-platform Node.js replacement for dev-plugins-install.sh.
 */
import { spawnSync } from "node:child_process";

console.log("aia-harness: installing plugin-authoring tooling…");

// Official Anthropic plugin marketplace. NOTE: the repo `anthropics/claude-code`
// registers under the marketplace name `claude-code-plugins` (from its
// marketplace.json), so installs target `@claude-code-plugins`, not `@claude-code`.
let result;

result = spawnSync("claude", ["plugin", "marketplace", "add", "anthropics/claude-code"], {
  stdio: ["inherit", "inherit", "inherit"],
});
if (result.status !== 0)
  process.stderr.write(
    "warn: 'claude plugin marketplace add anthropics/claude-code' exited non-zero\n",
  );

result = spawnSync("claude", ["plugin", "marketplace", "update", "claude-code-plugins"], {
  stdio: ["inherit", "inherit", "inherit"],
});
if (result.status !== 0)
  process.stderr.write(
    "warn: 'claude plugin marketplace update claude-code-plugins' exited non-zero\n",
  );

// plugin-dev: SKILL.md structure, frontmatter, progressive disclosure, packaging.
// Complements the plugin-structure + plugin-settings skills already under .claude/skills/.
result = spawnSync("claude", ["plugin", "install", "plugin-dev@claude-code-plugins"], {
  stdio: ["inherit", "inherit", "inherit"],
});
if (result.status !== 0)
  process.stderr.write(
    "warn: 'claude plugin install plugin-dev@claude-code-plugins' exited non-zero\n",
  );

console.log(`
Done (or already present). Verify with:
  claude plugin list

If a name differs in your registry, browse:
  claude plugin marketplace list
`);
