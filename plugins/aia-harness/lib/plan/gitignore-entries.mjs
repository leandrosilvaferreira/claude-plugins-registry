/**
 * Build the `.gitignore` entries `applyPlan` appends under the `# aia-harness` header.
 * Extracted from plan.mjs to keep that orchestrator under 350 lines.
 * @module plan/gitignore-entries
 */

/**
 * Built before the artifacts that need them: `.graphifyignore` seeds itself from
 * the project `.gitignore`, which `ensureGitignore` only updates *after* every
 * artifact has been rendered — so a seed taken from the file alone is always one
 * apply behind and parks a self-inflicted conflict on the next apply run.
 *
 * @param {string[]} toolIds
 * @returns {string[]}
 */
export function buildGitignoreEntries(toolIds) {
  return [
    ".claude/settings.local.json",
    ".claude/*.local.*",
    ".claude/.aia-harness-pending/",
    ...(toolIds.includes("graphify")
      ? ["graphify-out/", "graphify-out/cost.json", "graphify-out/cache/"]
      : []),
  ];
}
