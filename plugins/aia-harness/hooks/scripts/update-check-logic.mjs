/**
 * Pure decision logic for the plugin self-update SessionStart hook
 * (hooks/scripts/check-plugin-update.mjs). No IO — safe to unit-test
 * directly without spawning a subprocess.
 */

/**
 * Whether an update check is due, given when it last ran.
 * @param {string|undefined|null} lastCheckedAt  ISO 8601 timestamp, or nullish if never checked
 * @param {number} now  Date.now()
 * @param {number} ttlMs  Minimum interval between checks, in milliseconds
 * @returns {boolean}
 */
export function isCheckDue(lastCheckedAt, now, ttlMs) {
  if (!lastCheckedAt) return true;
  const last = Date.parse(lastCheckedAt);
  if (Number.isNaN(last)) return true;
  return now - last >= ttlMs;
}

// Single definition, shared with the commands' `version-check` path
// (lib/version-check.mjs) so the two never drift on how versions compare.
export { compareVersions } from "../../lib/version-check.mjs";
