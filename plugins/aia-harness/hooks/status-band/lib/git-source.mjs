// git/gh data source for the status band, with strict resource limits.
// No Node APIs and no timers: the mod injects `run` and `now`, expiry comes from `now()`.

const TIMEOUT_MS = 5000;
const CACHE_MS = 60_000;
const BACKOFF_MS = 5 * 60_000;

/**
 * @typedef {{ exitCode: number, stdout: string }} RunResult
 * @typedef {{
 *   run(argv: string[], opts: { timeoutMs: number }): Promise<RunResult>,
 *   now(): number
 * }} GitSourceDeps
 * @typedef {{ number: number, url: string }} PullRequest
 * @typedef {{
 *   branch(cwd: string): Promise<string | undefined>,
 *   pr(root: string, branch: string): Promise<PullRequest | undefined>,
 *   invalidate(root: string, branch: string): void,
 *   reset(): void
 * }} GitSource
 */

/**
 * @param {GitSourceDeps} deps
 * @returns {GitSource}
 */
export function createGitSource({ run, now }) {
  /** @type {Map<string, { value: PullRequest | undefined, expires: number }>} */
  let cache = new Map();
  /** @type {Map<string, Promise<PullRequest | undefined>>} */
  let inflight = new Map();
  /** @type {Promise<unknown>} */
  let tail = Promise.resolve();
  // Bumped by reset() so a query started before it cannot repopulate the cache.
  let epoch = 0;

  /** @param {string} root @param {string} branch @param {number} startedEpoch Epoch when the caller asked. @returns {Promise<PullRequest | undefined>} */
  async function query(root, branch, startedEpoch) {
    /** @type {PullRequest | undefined} */
    let value;
    let ttl = CACHE_MS;
    try {
      const r = await run(["gh", "pr", "view", branch, "--json", "number,url,state"], {
        timeoutMs: TIMEOUT_MS,
      });
      if (r.exitCode !== 0) throw new Error("gh failed");
      const j = JSON.parse(r.stdout);
      if (j && j.state === "OPEN" && typeof j.number === "number" && typeof j.url === "string") {
        value = { number: j.number, url: j.url };
      }
    } catch {
      value = undefined;
      ttl = BACKOFF_MS;
    }
    if (startedEpoch === epoch) cache.set(`${root}\0${branch}`, { value, expires: now() + ttl });
    return value;
  }

  return {
    async branch(cwd) {
      try {
        const r = await run(["git", "-C", cwd, "branch", "--show-current"], {
          timeoutMs: TIMEOUT_MS,
        });
        if (r.exitCode !== 0) return undefined;
        return r.stdout.trim() || undefined;
      } catch {
        return undefined;
      }
    },

    pr(root, branch) {
      const key = `${root}\0${branch}`;
      const hit = cache.get(key);
      if (hit && now() < hit.expires) return Promise.resolve(hit.value);
      const pending = inflight.get(key);
      if (pending) return pending;
      // One gh process at a time overall: a query for another key waits its turn.
      // The map is captured: after reset() the old query must not delete an entry of the new map.
      const map = inflight;
      const askedEpoch = epoch;
      const p = tail
        .then(() => query(root, branch, askedEpoch))
        .finally(() => {
          if (map.get(key) === p) map.delete(key);
        });
      tail = p.catch(() => undefined);
      inflight.set(key, p);
      return p;
    },

    invalidate(root, branch) {
      const key = `${root}\0${branch}`;
      cache.delete(key);
      inflight.delete(key);
      epoch++;
    },

    reset() {
      cache = new Map();
      inflight = new Map();
      // `tail` stays: a query in flight keeps its place, so two gh never run at once.
      epoch++;
    },
  };
}
