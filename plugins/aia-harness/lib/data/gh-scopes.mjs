/**
 * GitHub CLI OAuth scopes the harness depends on.
 *
 * Single source of truth for which scopes a project needs and for the exact
 * `gh auth refresh` command that grants them. A token minted by `gh auth login`
 * without `-s` lacks `project` (and often `workflow`), which surfaces much
 * later as "token has not been granted the required scopes" on an unrelated
 * command — and historically led to the wrong fix (a hand-made PAT) instead of
 * one refresh.
 *
 * Consumed by lib/detect/gh-auth.mjs and the commands. Deliberately duplicated
 * inside templates/hooks/gh-scope-guard.mjs, which ships standalone into target
 * projects and cannot import from lib/; tests/hook-gh-scope-guard.test.mjs
 * asserts the copy still agrees with this module.
 *
 * @module data/gh-scopes
 */

/**
 * Scopes every GitHub repo needs.
 *
 * `repo`     — issues, pull requests, merges, Actions secrets.
 * `workflow` — pushing changes that touch `.github/workflows/`; the GitHub PM
 *              pillar installs four workflow files.
 *
 * @type {readonly string[]}
 */
export const GH_SCOPES_BASE = Object.freeze(["repo", "workflow"]);

/**
 * Additionally required by the GitHub PM pillar (templates/commands/pm/*).
 *
 * `read:org` — `gh project list --owner <org>`.
 * `project`  — Projects v2 mutations (`addProjectV2ItemById`,
 *              `updateProjectV2ItemFieldValue`). GitHub exposes no
 *              `write:project`, and `read:project` is read-only, so the full
 *              `project` scope is the only option for a pillar that writes.
 *
 * @type {readonly string[]}
 */
export const GH_SCOPES_PM = Object.freeze([...GH_SCOPES_BASE, "read:org", "project"]);

/**
 * Build the command that grants `scopes`.
 *
 * `gh auth refresh -s` takes *additional* scopes and preserves the ones already
 * granted (only `--reset-scopes` / `--remove-scopes` subtract), so this is
 * idempotent and never revokes anything the user already has — including the
 * `gist` and `admin:public_key` defaults of the initial login flow, which is
 * why neither appears in the tiers above.
 *
 * @param {readonly string[]} scopes
 * @returns {string}
 */
export function ghRefreshCommand(scopes) {
  return `gh auth refresh -h github.com -s ${[...scopes].join(",")}`;
}
