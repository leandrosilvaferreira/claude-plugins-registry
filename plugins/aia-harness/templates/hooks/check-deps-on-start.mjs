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
  process.stdout.write("");
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
});

if (result.status !== 0 && result.status !== 1) {
  // harness crashed or timed out — fail open
  passThrough();
}

/** @type {{ status: "ok"|"warn"|"block", checks: any[], missing: string[] }|null} */
let report = null;
try {
  report = JSON.parse(result.stdout ?? "");
} catch {
  passThrough();
}

if (!report || report.status === "ok") {
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
} else {
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

process.stdout.write(
  JSON.stringify({
    hookSpecificOutput: { hookEventName: "SessionStart", additionalContext: lines.join("\n") },
  }),
);
process.exit(0);
