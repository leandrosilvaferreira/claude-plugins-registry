/**
 * IO-gathering edge for the GitHub PM pillar smoke check: reads
 * pm-config.json, git-tracks it, collects installed workflow files, and
 * checks gh auth/secrets — then hands everything to buildPmHealthReport
 * (lib/pm-check.mjs), which stays pure and unit-testable on pre-read input.
 * Same split as lib/detect/index.mjs vs the rest of lib/: detection reads,
 * the report builder decides.
 *
 * @module detect/pm-check-io
 */
import path from "node:path";
import { readdirSync } from "node:fs";
import { checkGhAuth, listGhSecretNames } from "./gh-auth.mjs";
import { checkPathGitStatus } from "./git-track-status.mjs";
import { findBinary } from "./system-deps.mjs";
import { GH_SCOPES } from "../data/gh-scopes.mjs";
import { buildPmHealthReport } from "../pm-check.mjs";
import { readText } from "../util/fs.mjs";

/**
 * Gather every already-read input buildPmHealthReport needs (IO at the edge,
 * per lib/CLAUDE.md's architecture) and run the smoke check.
 * @param {string} dir
 * @returns {import('../pm-check.mjs').PmHealthReport}
 */
export function runPmCheck(dir) {
  const configRaw = readText(path.join(dir, ".claude", "pm-config.json"));
  let configParsed = null;
  if (configRaw != null) {
    try {
      configParsed = JSON.parse(configRaw);
    } catch {
      configParsed = null;
    }
  }

  const gitStatus = checkPathGitStatus(dir, path.join(".claude", "pm-config.json"));

  /** @type {{ name: string, content: string }[]} */
  const workflowFiles = [];
  try {
    const workflowsDir = path.join(dir, ".github", "workflows");
    for (const f of readdirSync(workflowsDir)) {
      if (!f.endsWith(".yml") && !f.endsWith(".yaml")) continue;
      const content = readText(path.join(workflowsDir, f));
      if (content != null) workflowFiles.push({ name: f, content });
    }
  } catch {
    // .github/workflows doesn't exist (or isn't readable) — workflowFiles stays [].
  }

  // Scopes/secrets are only meaningful once the binary exists — same gate the
  // `check` command uses before ever calling checkGhAuth.
  const ghPath = findBinary("gh", process.platform, process.env);
  const ghAuth = ghPath ? checkGhAuth(GH_SCOPES, { binPath: ghPath }) : null;
  const secretNames = ghPath ? listGhSecretNames({ binPath: ghPath, cwd: dir }) : null;

  return buildPmHealthReport({
    configRaw,
    configParsed,
    gitStatus,
    workflowFiles,
    ghAuth,
    secretNames,
  });
}
