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

/**
 * Compare two "MAJOR.MINOR.PATCH"-style version strings numerically,
 * segment by segment. Missing segments are treated as 0 (so "0.3" == "0.3.0").
 * @param {string} a
 * @param {string} b
 * @returns {number} negative if a<b, zero if equal, positive if a>b
 */
export function compareVersions(a, b) {
  const pa = String(a).split(".").map(Number);
  const pb = String(b).split(".").map(Number);
  const len = Math.max(pa.length, pb.length);
  for (let i = 0; i < len; i++) {
    const na = pa[i] || 0;
    const nb = pb[i] || 0;
    if (na !== nb) return na - nb;
  }
  return 0;
}
