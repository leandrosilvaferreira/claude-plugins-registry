/**
 * Add docs/LSP/worktree/plugin-installer artifacts to a plan.
 * Extracted from plan.mjs to keep that orchestrator under 350 lines.
 * @module plan/docs-artifacts
 */
import {
  renderStrategies,
  renderLspJson,
  renderWorktreeInclude,
  renderPluginsInstallScript,
} from "../generate/misc.mjs";
import { suggestPlugins } from "../data/plugins-catalog.mjs";

/** @typedef {(a: any) => void} AddFn */

/**
 * @param {AddFn} add
 * @param {import('../profile.mjs').ProjectProfile} profile
 * @param {string[]} toolIds
 */
export function addDocsArtifacts(add, profile, toolIds) {
  add({
    id: "strategies",
    relPath: "docs/harness/strategies.md",
    title: "Harness strategies doc",
    category: "docs",
    rationale: "Lint / compile / language-server / test strategy reference.",
    contextCost: 0,
    defaultSelected: true,
    content: renderStrategies(profile),
  });

  const lsp = renderLspJson(profile);
  if (lsp) {
    add({
      id: "lsp",
      relPath: ".lsp.json",
      title: ".lsp.json (language server)",
      category: "lsp",
      rationale: "Language server config (best-effort; opt-in).",
      contextCost: 0,
      defaultSelected: false,
      content: lsp,
    });
  }

  if (profile.vcs.isGit) {
    add({
      id: "worktree",
      relPath: ".worktreeinclude",
      title: ".worktreeinclude",
      category: "worktree",
      rationale: "Copy local settings/env into new git worktrees.",
      contextCost: 0,
      defaultSelected: true,
      mergeStrategy: "merge-lines",
      content: renderWorktreeInclude(toolIds.includes("graphify")),
    });
  }

  const pluginSuggestions = suggestPlugins(profile);
  if (pluginSuggestions.length > 0) {
    add({
      id: "install-plugins",
      relPath: "scripts/install-plugins.mjs",
      title: "Plugin installer (runnable)",
      category: "script",
      rationale: `Runnable installer for ${pluginSuggestions.length} suggested plugin(s) — idempotent; run with -y.`,
      contextCost: 0,
      defaultSelected: true,
      content: renderPluginsInstallScript(pluginSuggestions),
    });
  }
}
