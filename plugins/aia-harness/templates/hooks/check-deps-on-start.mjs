#!/usr/bin/env node
/**
 * SessionStart hook: verify required system dependencies before the session begins.
 *
 * Calls `bin/harness.mjs check <cwd> --json` via the plugin root, parses the
 * DepsReport, and injects additionalContext when deps are missing.
 *
 * Fail-open: if the harness binary cannot be found or crashes, exits 0 silently
 * so it never blocks a session due to infrastructure issues.
 */
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";

/**
 * Silent success — never blocks the session.
 * @returns {never}
 */
function passThrough() {
  process.exit(0);
}

/** @type {{ cwd?: string }} */
let event = {};
try {
  event = JSON.parse(
    await new Promise((res) => {
      let buf = "";
      process.stdin.setEncoding("utf8");
      process.stdin.on("data", (c) => {
        buf += c;
      });
      process.stdin.on("end", () => res(buf || "{}"));
    }),
  );
} catch {
  passThrough();
}

const cwd = event.cwd ?? process.cwd();
const pluginRoot = process.env.CLAUDE_PLUGIN_ROOT ?? "";
const harnessBin = pluginRoot ? path.join(pluginRoot, "bin", "harness.mjs") : "";

if (!harnessBin || !existsSync(harnessBin)) {
  passThrough();
}

const result = spawnSync(process.execPath, [harnessBin, "check", cwd, "--json"], {
  encoding: "utf8",
  timeout: 15_000,
  windowsHide: true,
});

if (result.status !== 0 && result.status !== 1) {
  // harness crashed or timed out — fail open
  passThrough();
}

/**
 * @type {{
 *   status: "ok"|"warn"|"block",
 *   checks: any[],
 *   missing: string[],
 *   ghAuth?: { available: boolean, authenticated: boolean, scopes: string[], missing: string[], envTokenOverride: boolean, refreshCmd: string },
 * }|null}
 */
let report = null;
try {
  report = JSON.parse(result.stdout ?? "");
} catch {
  passThrough();
}

// A gh scope problem is reported independently of the aggregate status. It has
// to be: checkSystemDeps computes `warn` as `missingRecommendedOnly &&
// !hasFoundRequired`, and ENGINE_DEPS always contributes `node`, which is
// always found — so `status` is in practice only ever "ok" or "block", and
// keying off it alone would swallow this entirely.
const ghProblem = Boolean(
  report?.ghAuth &&
  (!report.ghAuth.available ||
    report.ghAuth.missing.length > 0 ||
    report.ghAuth.envTokenOverride ||
    !report.ghAuth.authenticated),
);

if (!report || (report.status === "ok" && !ghProblem)) {
  passThrough();
}

const platform = /** @type {"win32"|"darwin"|"linux"} */ (
  process.platform === "win32" ? "win32" : process.platform === "darwin" ? "darwin" : "linux"
);

/** @type {string[]} */
const lines = [];

if (report.status === "warn") {
  const missingChecks = report.checks.filter((/** @type {any} */ c) => !c.found);
  lines.push("⚠️  Recommended dependencies missing:");
  for (const c of missingChecks) {
    lines.push(`  • ${c.name}  → ${c.installHint?.[platform] ?? "see docs"}`);
  }
  lines.push("The harness works, but some optional tools are missing.");
} else if (report.status === "block") {
  // status === "block": required deps missing
  lines.push("🚫  REQUIRED DEPENDENCIES MISSING — harness operations may fail.", "");
  lines.push("Install before continuing:");
  for (const name of report.missing) {
    const check = report.checks.find((/** @type {any} */ c) => c.name === name);
    const hint = check?.installHint?.[platform] ?? "see docs";
    lines.push(`  • ${name}  → ${hint}`);
  }
  lines.push("", "Run /check-deps to see the full report.");
}

if (ghProblem && report.ghAuth) {
  if (lines.length > 0) lines.push("");
  if (!report.ghAuth.available) {
    // gh was found on disk but could not be executed — nothing else about its
    // auth state was determined, so scopes/missing below are artifacts of
    // that failure, not findings. Neither `gh auth refresh` nor
    // `gh auth login` can fix a binary that will not start.
    lines.push(
      "⚠️  gh is installed but could not be run.",
      "   GitHub commands (issues, PRs, Projects v2) will fail until this is fixed.",
      "   Verify the installation by running `gh --version` yourself.",
    );
  } else if (report.ghAuth.envTokenOverride) {
    lines.push(
      "⚠️  GH_TOKEN/GITHUB_TOKEN is set — gh uses it instead of your keyring login,",
      "   so its permissions are what apply and `gh auth refresh` cannot change them.",
      "   Run `unset GH_TOKEN GITHUB_TOKEN` before using gh in this session.",
    );
  } else if (!report.ghAuth.authenticated) {
    lines.push(
      "⚠️  gh is installed but not logged in.",
      "   GitHub commands (issues, PRs, Projects v2) will fail until you do. Run:",
      `     gh auth login -h github.com -s ${report.ghAuth.missing.join(",")}`,
      "   Do not work around this with GH_TOKEN or a hand-made personal access token.",
    );
  } else {
    lines.push(
      `⚠️  gh is missing OAuth scope(s): ${report.ghAuth.missing.join(", ")}`,
      "   GitHub commands (issues, PRs, Projects v2) will fail until granted. Run:",
      `     ${report.ghAuth.refreshCmd}`,
      "   It adds scopes without revoking existing ones. Confirm with `gh auth status`.",
      "   Do not work around this with GH_TOKEN or a hand-made personal access token.",
    );
  }
}

process.stdout.write(
  JSON.stringify({
    hookSpecificOutput: { hookEventName: "SessionStart", additionalContext: lines.join("\n") },
  }),
);
process.exit(0);
