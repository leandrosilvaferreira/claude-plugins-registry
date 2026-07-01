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
 * @returns {{lastCheckedAt?: string, lastKnownVersion?: string}}
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
 * @param {{lastCheckedAt: string, lastKnownVersion?: string}} data
 */
function writeCache(cacheFile, data) {
  try {
    fs.mkdirSync(path.dirname(cacheFile), { recursive: true });
    fs.writeFileSync(cacheFile, JSON.stringify(data, null, 2));
  } catch {
    /* non-fatal: worst case the throttle window resets */
  }
}

function main() {
  const cacheFile = process.env.AIA_UPDATE_CHECK_CACHE_FILE || process.argv[2];
  if (!cacheFile || cacheFile.includes("${")) {
    process.exit(0);
  }

  const cache = readCache(cacheFile);

  if (!isCheckDue(cache.lastCheckedAt, Date.now(), TTL_MS)) {
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
    writeCache(cacheFile, {
      lastCheckedAt: new Date().toISOString(),
      lastKnownVersion: cache.lastKnownVersion,
    });
    process.exit(0);
  }
}

main();
