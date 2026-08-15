/**
 * GitHub CLI OAuth scopes the harness depends on.
 *
 * Single source of truth for the scopes an aia-harness project needs and for
 * the exact `gh auth refresh` command that grants them. A token minted by
 * `gh auth login` without `-s` often lacks `project` and `workflow`, which
 * surfaces much later as "token has not been granted the required scopes" on
 * an unrelated command — and historically led to the wrong fix (a hand-made
 * PAT) instead of one refresh.
 *
 * Consumed by lib/detect/gh-auth.mjs and the commands. Deliberately duplicated
 * inside templates/hooks/gh-scope-guard.mjs, which ships standalone into target
 * projects and cannot import from lib/; tests/hook-gh-scope-guard.test.mjs
 * asserts the copy still agrees with this module.
 *
 * @module data/gh-scopes
 */

/**
 * Every scope aia-harness ever asks a project's `gh` login for — one flat
 * set, requested in full regardless of which pillars are installed.
 *
 * `admin:public_key` / `gist` — defaults of `gh auth login`'s own initial
 *              flow; listed explicitly so the command shown to the user
 *              reflects the full expected grant, not just a delta.
 * `repo` / `workflow` — issues, pull requests, merges, Actions secrets, and
 *              pushing changes that touch `.github/workflows/` (the GitHub
 *              PM pillar installs four workflow files).
 * `read:org`  — `gh project list --owner <org>`.
 * `project`   — Projects v2 mutations (`addProjectV2ItemById`,
 *               `updateProjectV2ItemFieldValue`). GitHub exposes no
 *               `write:project`, and `read:project` is read-only, so the
 *               full `project` scope is the only option for writing.
 *
 * @type {readonly string[]}
 */
export const GH_SCOPES = Object.freeze([
  "admin:public_key",
  "gist",
  "project",
  "read:org",
  "repo",
  "workflow",
]);

/**
 * Build the command that grants `scopes`.
 *
 * `gh auth refresh -s` takes *additional* scopes and preserves the ones already
 * granted (only `--reset-scopes` / `--remove-scopes` subtract), so this is
 * idempotent and never revokes anything the user already has.
 *
 * @param {readonly string[]} scopes
 * @returns {string}
 */
export function ghRefreshCommand(scopes) {
  return `gh auth refresh -h github.com -s ${[...scopes].join(",")}`;
}
