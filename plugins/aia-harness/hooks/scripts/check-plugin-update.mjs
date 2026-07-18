#!/usr/bin/env node
/**
 * SessionStart hook: checks at most once per 24h whether a newer aia-harness
 * version is published in the plugin's marketplace registry and, if so,
 * silently updates the installed copy on disk via the `claude` CLI.
 *
 * Fail-open on all infrastructure (offline, claude CLI unresolvable, a
 * missing or malformed cache/manifest file). Never blocks session start,
 * never surfaces an error — worst case it silently skips the check.
 *
 * External dependencies are env-overridable for testing:
 *   AIA_UPDATE_CHECK_CLAUDE_BIN        — command to run instead of the real
 *                                        `claude` binary on PATH.
 *   AIA_UPDATE_CHECK_CACHE_FILE        — cache file path. Falls back to
 *                                        argv[2] (the
 *                                        ${CLAUDE_PLUGIN_DATA}/update-check.json
 *                                        path plugin.json passes for real —
 *                                        CLAUDE_PLUGIN_DATA itself is a
 *                                        directory, not a file).
 *   AIA_UPDATE_CHECK_MARKETPLACE_HOME  — replaces os.homedir() when locating
 *                                        the cached marketplace clone.
 *
 * @hook SessionStart
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { isCheckDue, compareVersions } from "./update-check-logic.mjs";

const PLUGIN_NAME = "aia-harness";
const TTL_MS = 24 * 60 * 60 * 1000;
/**
 * Retry window after a failed attempt. A failure must not cost the full TTL:
 * being offline for one session start would otherwise leave the plugin stale
 * for a whole day, and the failure is invisible (the hook is fail-open by
 * design, so nothing surfaces). Short enough to recover within the same
 * working session, long enough that a permanently broken `claude` CLI isn't
 * re-probed on every single session start.
 */
const RETRY_MS = 60 * 60 * 1000;
/**
 * Claude Code's own documented grace period between marking a superseded
 * version directory `.orphaned_at` and deleting it. Mirrored here rather than
 * chosen: it is what keeps sessions already running from an older version from
 * having their files pulled out from under them.
 */
const ORPHAN_GRACE_MS = 7 * 24 * 60 * 60 * 1000;
const CLAUDE_BIN = process.env.AIA_UPDATE_CHECK_CLAUDE_BIN || "claude";
const MARKETPLACE_HOME = process.env.AIA_UPDATE_CHECK_MARKETPLACE_HOME || os.homedir();

/**
 * @param {string[]} args
 * @returns {string} stdout
 */
function runClaude(args) {
  return execFileSync(CLAUDE_BIN, args, { encoding: "utf8", timeout: 20000, windowsHide: true });
}

/**
 * @param {string} cacheFile
 * @returns {{lastCheckedAt?: string, lastKnownVersion?: string, lastAttemptFailed?: boolean}}
 */
function readCache(cacheFile) {
  try {
    const parsed = JSON.parse(fs.readFileSync(cacheFile, "utf8"));
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

/**
 * @param {string} cacheFile
 * @param {{lastCheckedAt: string, lastKnownVersion?: string, lastAttemptFailed?: boolean}} data
 */
function writeCache(cacheFile, data) {
  try {
    fs.mkdirSync(path.dirname(cacheFile), { recursive: true });
    fs.writeFileSync(cacheFile, JSON.stringify(data, null, 2));
  } catch {
    /* non-fatal: worst case the throttle window resets */
  }
}

/**
 * Finish the cleanup Claude Code already schedules but doesn't carry out.
 *
 * On update, Claude Code writes a `.orphaned_at` marker (epoch ms) into the
 * superseded version's directory and, per the plugins reference, "the previous
 * version directory is marked as orphaned and removed automatically 7 days
 * later. The grace period lets concurrent Claude Code sessions that already
 * loaded the old version keep running without errors." In practice the deletion
 * does not happen — a long-standing, widely reported bug (anthropics/claude-code
 * #16453, #37865, #47966, #51536) — so directories accumulate indefinitely:
 * 10 versions / 2.0GB for this plugin alone on the author's machine.
 *
 * This deletes ONLY directories Claude Code itself marked as orphaned whose
 * grace period has already elapsed. It deliberately does not invent its own
 * retention rule: an earlier "keep the newest two" version of this function
 * would have deleted a directory a still-running session was pinned to, which
 * is the exact failure the grace period exists to prevent. There is no
 * sanctioned command to do this (`claude plugin gc` was requested and closed
 * not-planned; `claude plugin prune` only handles dependencies), but deleting
 * from this cache by hand is explicitly endorsed by Anthropic's own
 * troubleshooting guidance.
 *
 * @param {string} installPath  installPath reported by `claude plugin list`.
 */
function pruneExpiredOrphans(installPath) {
  if (!installPath) return;
  const versionsDir = path.dirname(installPath);
  // Only ever act inside this plugin's own versions directory — a malformed or
  // unexpected installPath must not redirect a recursive delete elsewhere.
  if (path.basename(versionsDir) !== PLUGIN_NAME) return;

  /** @type {string[]} */
  let entries;
  try {
    entries = fs.readdirSync(versionsDir);
  } catch {
    return;
  }

  for (const entry of entries) {
    // Per entry, not around the loop: on Windows a directory held open by
    // another process fails with EBUSY/EPERM, and aborting there would leave
    // every remaining expired orphan behind.
    try {
      const dir = path.join(versionsDir, entry);
      // Absent marker throws → not orphaned by Claude Code → never touched.
      const orphanedAt = Number(fs.readFileSync(path.join(dir, ".orphaned_at"), "utf8").trim());
      if (!Number.isFinite(orphanedAt)) continue;
      if (Date.now() - orphanedAt < ORPHAN_GRACE_MS) continue;
      fs.rmSync(dir, { recursive: true, force: true });
    } catch {
      continue;
    }
  }
}

function main() {
  const cacheFile = process.env.AIA_UPDATE_CHECK_CACHE_FILE || process.argv[2];
  if (!cacheFile || cacheFile.includes("${")) {
    process.exit(0);
  }

  const cache = readCache(cacheFile);

  if (!isCheckDue(cache.lastCheckedAt, Date.now(), cache.lastAttemptFailed ? RETRY_MS : TTL_MS)) {
    process.exit(0);
  }

  try {
    const listOut = runClaude(["plugin", "list", "--json"]);
    const list = JSON.parse(listOut);
    const installed = Array.isArray(list)
      ? list.find((p) => p && typeof p.id === "string" && p.id.startsWith(`${PLUGIN_NAME}@`))
      : undefined;

    if (!installed) {
      writeCache(cacheFile, { lastCheckedAt: new Date().toISOString() });
      process.exit(0);
    }

    const marketplace = installed.id.slice(`${PLUGIN_NAME}@`.length);
    const installedVersion = String(installed.version);
    const installedPath = typeof installed.installPath === "string" ? installed.installPath : "";

    // Before any network work, and outside the update branch. Sweeping expired
    // orphans is a purely local operation: orphans age out on their own
    // schedule whether or not a new version exists, and an offline machine —
    // where everything below this line throws — is exactly where stale
    // directories would otherwise pile up untouched.
    pruneExpiredOrphans(installedPath);

    runClaude(["plugin", "marketplace", "update", marketplace]);

    const manifestPath = path.join(
      MARKETPLACE_HOME,
      ".claude",
      "plugins",
      "marketplaces",
      marketplace,
      "plugins",
      PLUGIN_NAME,
      ".claude-plugin",
      "plugin.json",
    );
    const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
    const latestVersion =
      manifest && typeof manifest.version === "string" ? manifest.version : undefined;

    let updated = false;
    if (latestVersion && compareVersions(latestVersion, installedVersion) > 0) {
      runClaude(["plugin", "update", `${PLUGIN_NAME}@${marketplace}`]);
      updated = true;
    }

    writeCache(cacheFile, {
      lastCheckedAt: new Date().toISOString(),
      lastKnownVersion: latestVersion ?? installedVersion,
    });

    if (updated) {
      process.stdout.write(
        JSON.stringify({
          hookSpecificOutput: {
            hookEventName: "SessionStart",
            additionalContext:
              `aia-harness was auto-updated in the background from ${installedVersion} to ${latestVersion}. ` +
              `Tell the user, and suggest running /reload-plugins (or starting a new session) to pick it up.`,
          },
        }),
      );
    }
    process.exit(0);
  } catch {
    // Mark the attempt as failed so the next session retries on RETRY_MS
    // instead of waiting out the full TTL. Success paths omit the flag, which
    // clears it.
    writeCache(cacheFile, {
      lastCheckedAt: new Date().toISOString(),
      lastKnownVersion: cache.lastKnownVersion,
      lastAttemptFailed: true,
    });
    process.exit(0);
  }
}

main();
