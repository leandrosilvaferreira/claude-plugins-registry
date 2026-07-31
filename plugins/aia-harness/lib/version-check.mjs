/**
 * Plugin self-version check — is the *running* copy of aia-harness the latest
 * published one?
 *
 * Complements `hooks/scripts/check-plugin-update.mjs`, which auto-updates on
 * `SessionStart` at most once per 24h. That hook cannot help a session that was
 * already open when a new version shipped, and even when it does update, the
 * files it swaps on disk are not picked up by the already-loaded copy until
 * `/reload-plugins` or a new session. Every slash command therefore calls this
 * as its first step, so a harness is never scaffolded by a stale plugin without
 * the user knowing.
 *
 * Fail-open by construction: every failure mode (offline, no `claude` CLI, no
 * marketplace clone, malformed manifest) resolves to `status: "unknown"`, which
 * commands treat as "say nothing, continue".
 *
 * @module version-check
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";

const PLUGIN_NAME = "aia-harness";
/**
 * Cap on the `claude plugin marketplace update` refresh — a dead registry must
 * not stall a command. Measured at ~5.0s against a healthy GitHub-hosted
 * registry, so a 5s cap killed every refresh and silently degraded the check to
 * whatever the clone already had on disk; 15s leaves real headroom while still
 * bounding the worst case. The CACHE_TTL_MS throttle below is what keeps this
 * from being paid per command.
 */
const REFRESH_TIMEOUT_MS = 15000;
/**
 * How long a completed check is reused. Long enough that a multi-command
 * session pays the refresh once, short enough that a publish mid-session is
 * still noticed by the next command.
 */
const CACHE_TTL_MS = 15 * 60 * 1000;

/**
 * @typedef {Object} VersionCheckResult
 * @property {"current"|"stale"|"unknown"} status
 * @property {string} running   Version of the loaded plugin copy ("" if unreadable).
 * @property {string} latest    Latest version published in the marketplace ("" if unknown).
 * @property {string} marketplace  Marketplace name the plugin is published under ("" if unknown).
 * @property {string} updateCommand  Command the user runs to update ("" when not applicable).
 * @property {string} [reason]  Why the check could not conclude (only on "unknown").
 */

/**
 * Compare two "MAJOR.MINOR.PATCH"-style version strings numerically, segment by
 * segment. Missing segments count as 0 (so "0.3" == "0.3.0").
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

/**
 * Reads a plugin manifest's `version`. Returns "" for any failure — a missing,
 * unreadable, or malformed manifest is never fatal here.
 * @param {string} file
 * @returns {string}
 */
function readManifestVersion(file) {
  try {
    const parsed = JSON.parse(fs.readFileSync(file, "utf8"));
    return parsed && typeof parsed.version === "string" ? parsed.version : "";
  } catch {
    return "";
  }
}

/**
 * Locates the marketplace clone that publishes this plugin. Several clones can
 * carry it (a fork, a mirror); the highest published version wins, which is
 * also what `claude plugin update` would install.
 * @param {string} home
 * @returns {{ name: string, manifest: string, version: string } | null}
 */
export function findMarketplace(home) {
  const root = path.join(home, ".claude", "plugins", "marketplaces");
  /** @type {string[]} */
  let names;
  try {
    names = fs.readdirSync(root);
  } catch {
    return null;
  }
  /** @type {{ name: string, manifest: string, version: string } | null} */
  let best = null;
  for (const name of names) {
    const manifest = path.join(root, name, "plugins", PLUGIN_NAME, ".claude-plugin", "plugin.json");
    const version = readManifestVersion(manifest);
    if (!version) continue;
    if (!best || compareVersions(version, best.version) > 0) best = { name, manifest, version };
  }
  return best;
}

/**
 * Marketplace names that are safe to hand to the `claude` CLI. The name comes
 * from a directory listing, and the Windows branch below runs through a shell —
 * so anything outside this character class is skipped rather than passed along.
 * Real marketplace names are slugs; this rejects nothing legitimate.
 */
const SAFE_MARKETPLACE = /^[A-Za-z0-9._-]+$/;

/**
 * Default marketplace refresh. Never throws out of `checkPluginVersion` — the
 * caller swallows a failure and falls back to whatever is already on disk.
 *
 * `shell: true` is scoped to Windows only: an npm-installed Claude Code resolves
 * `claude` to a `.cmd` shim there, which execFile cannot invoke without a shell
 * (Node's own documented mechanism for this case). Everything passed here is
 * either hardcoded in this file or a name already validated against
 * SAFE_MARKETPLACE.
 * @param {string[]} args
 */
function defaultRun(args) {
  execFileSync("claude", args, {
    stdio: "ignore",
    timeout: REFRESH_TIMEOUT_MS,
    windowsHide: true,
    shell: process.platform === "win32",
  });
}

/**
 * @param {string} file
 * @returns {{ checkedAt?: string, running?: string, latest?: string, marketplace?: string }}
 */
function readCache(file) {
  try {
    const parsed = JSON.parse(fs.readFileSync(file, "utf8"));
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

/**
 * @param {string} file
 * @param {{ checkedAt: string, running: string, latest: string, marketplace: string }} data
 */
function writeCache(file, data) {
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify(data, null, 2));
  } catch {
    /* non-fatal: worst case the next command refreshes again */
  }
}

/**
 * Compares the running plugin copy against the latest published version.
 *
 * @param {Object} opts
 * @param {string} opts.pluginRoot  Root of the *running* plugin copy (its own `.claude-plugin/plugin.json` is the running version).
 * @param {string} [opts.home]      Home directory holding `.claude/plugins/marketplaces`. Defaults to `os.homedir()`.
 * @param {number} [opts.now]       Clock injection point for tests.
 * @param {string} [opts.cacheFile] Where the throttle state lives.
 * @param {boolean} [opts.refresh]  Set false to skip the network refresh entirely.
 * @param {(args: string[]) => void} [opts.run]  Spawn injection point for tests.
 * @returns {VersionCheckResult}
 */
export function checkPluginVersion(opts) {
  const pluginRoot = opts.pluginRoot;
  const home = opts.home ?? os.homedir();
  const now = opts.now ?? Date.now();
  // Deliberately NOT session-scoped: the answer ("is version X the latest?")
  // is identical for every session on this machine, so sharing the throttle
  // across them is the desired behavior, not a leak.
  const cacheFile = opts.cacheFile ?? path.join(os.tmpdir(), "aia-harness-version-check.json");
  const refresh = opts.refresh !== false;
  const run = opts.run ?? defaultRun;

  const running = readManifestVersion(path.join(pluginRoot, ".claude-plugin", "plugin.json"));
  if (!running) {
    return unknown("", "", "could not read the running plugin's .claude-plugin/plugin.json");
  }

  const cached = readCache(cacheFile);
  const cachedAt = cached.checkedAt ? Date.parse(cached.checkedAt) : NaN;
  // A cache entry recorded against a different running version is stale by
  // definition — the plugin was reloaded since, so re-check rather than
  // reporting the old copy's verdict.
  const cacheUsable =
    !Number.isNaN(cachedAt) && now - cachedAt < CACHE_TTL_MS && cached.running === running;

  if (cacheUsable && cached.latest) {
    return verdict(running, cached.latest, cached.marketplace ?? "");
  }

  const found = findMarketplace(home);
  if (!found) {
    return unknown(running, "", "no marketplace clone of aia-harness found on this machine");
  }

  let latest = found.version;
  if (refresh && SAFE_MARKETPLACE.test(found.name)) {
    try {
      run(["plugin", "marketplace", "update", found.name]);
      // Re-read after the refresh: the clone on disk is what was just updated.
      latest = readManifestVersion(found.manifest) || latest;
    } catch {
      // Offline, no `claude` on PATH, timeout — keep the on-disk version. It may
      // be up to a day old (the SessionStart hook's own TTL), which is still a
      // better answer than none.
    }
  }

  writeCache(cacheFile, {
    checkedAt: new Date(now).toISOString(),
    running,
    latest,
    marketplace: found.name,
  });
  return verdict(running, latest, found.name);
}

/**
 * @param {string} running
 * @param {string} latest
 * @param {string} marketplace
 * @returns {VersionCheckResult}
 */
function verdict(running, latest, marketplace) {
  // `running > latest` is a local dev checkout ahead of what is published —
  // never nag about that.
  const stale = compareVersions(latest, running) > 0;
  return {
    status: stale ? "stale" : "current",
    running,
    latest,
    marketplace,
    updateCommand: stale && marketplace ? `claude plugin update ${PLUGIN_NAME}@${marketplace}` : "",
  };
}

/**
 * @param {string} running
 * @param {string} latest
 * @param {string} reason
 * @returns {VersionCheckResult}
 */
function unknown(running, latest, reason) {
  return { status: "unknown", running, latest, marketplace: "", updateCommand: "", reason };
}
