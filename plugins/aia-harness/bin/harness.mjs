#!/usr/bin/env node
/**
 * aia-harness CLI — deterministic core for scan / plan / apply.
 * The Claude Code commands wrap this for the interactive consent loop.
 *
 * @module bin/harness
 */
import path from "node:path";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { scanProject } from "../lib/detect/index.mjs";
import { buildPlan } from "../lib/plan.mjs";
import {
  renderReport,
  renderPlanSummary,
  renderHelp,
  renderApplyResult,
  renderDepsReport,
  renderPmHealthReport,
} from "../lib/render.mjs";
import { applyPlan } from "../lib/apply.mjs";
import {
  checkSystemDeps,
  resolveDepsFromProfile,
  detectInstalledTools,
} from "../lib/detect/system-deps.mjs";
import { checkGhAuth } from "../lib/detect/gh-auth.mjs";
import { GH_SCOPES } from "../lib/data/gh-scopes.mjs";
import { auditRootClaudeMdSections } from "../lib/generate/root-sections.mjs";
import { checkPluginVersion } from "../lib/version-check.mjs";
import { runPmCheck } from "../lib/detect/pm-check-io.mjs";
import { exists, readText, readJson } from "../lib/util/fs.mjs";

const PLUGIN_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
// Single source of truth: plugin.json's version (bumped in lockstep with package.json
// by scripts/publish-to-registry.mjs). Read the plugin manifest, NOT package.json:
// package.json is deliberately excluded from what publishes to the registry, so the
// installed plugin has no package.json — reading it there crashed every CLI invocation.
// plugin.json always ships (it is the manifest) and carries the same version.
const VERSION = JSON.parse(
  readFileSync(path.join(PLUGIN_ROOT, ".claude-plugin", "plugin.json"), "utf8"),
).version;

/**
 * @param {string[]} argv
 * @returns {{ cmd: string, dir: string, flags: Set<string>, opts: Record<string, string> }}
 */
function parseArgs(argv) {
  /** @type {Set<string>} */
  const flags = new Set();
  /** @type {Record<string, string>} */
  const opts = {};
  /** @type {string[]} */
  const positional = [];
  for (const a of argv) {
    if (a.startsWith("--")) {
      const eq = a.indexOf("=");
      if (eq >= 0) opts[a.slice(2, eq)] = a.slice(eq + 1);
      else flags.add(a.slice(2));
    } else {
      positional.push(a);
    }
  }
  return { cmd: positional[0] ?? "help", dir: positional[1] ?? ".", flags, opts };
}

/**
 * @returns {number}
 */
function main() {
  const { cmd, dir, flags, opts } = parseArgs(process.argv.slice(2));

  if (cmd === "help" || flags.has("help")) {
    console.log(renderHelp(VERSION));
    return 0;
  }
  if (cmd === "version" || flags.has("version")) {
    console.log(`aia-harness ${VERSION}`);
    return 0;
  }

  // Always exits 0, including on "unknown": commands run this as their first
  // step, and a version check that can't conclude must never abort the work the
  // user actually asked for.
  if (cmd === "version-check") {
    const result = checkPluginVersion({
      pluginRoot: PLUGIN_ROOT,
      refresh: !flags.has("no-refresh"),
    });
    if (flags.has("json")) {
      process.stdout.write(JSON.stringify(result, null, 2) + "\n");
    } else if (result.status === "stale") {
      process.stdout.write(
        `aia-harness ${result.running} is running; ${result.latest} is published.\n` +
          `Update with: ${result.updateCommand}\n`,
      );
    } else {
      process.stdout.write(`aia-harness ${result.running || VERSION} (${result.status})\n`);
    }
    return 0;
  }

  if (cmd === "scan") {
    const profile = scanProject(dir);
    process.stdout.write(
      (flags.has("json") ? JSON.stringify(profile, null, 2) : renderReport(profile)) + "\n",
    );
    return 0;
  }

  if (cmd === "check") {
    const toolList = opts.tools
      ? opts.tools
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean)
      : detectInstalledTools(dir);
    const profile = scanProject(dir);
    const deps = resolveDepsFromProfile(profile, toolList);
    const report = checkSystemDeps(deps, process.platform);

    // Scopes are only meaningful once the binary exists.
    const ghCheck = report.checks.find((c) => c.name === "gh");
    const payload = ghCheck?.found
      ? {
          ...report,
          ghAuth: checkGhAuth(GH_SCOPES, {
            binPath: ghCheck.resolvedPath,
          }),
        }
      : report;

    if (flags.has("json")) {
      process.stdout.write(JSON.stringify(payload, null, 2) + "\n");
    } else {
      process.stdout.write(renderDepsReport(payload, process.platform) + "\n");
    }
    // Missing scopes are advisory: the exit code stays driven by the dep
    // status alone, so `ghAuth` can never halt a harness operation.
    return report.status === "block" ? 1 : 0;
  }

  if (cmd === "pm-check") {
    const report = runPmCheck(dir);
    if (flags.has("json")) {
      process.stdout.write(JSON.stringify(report, null, 2) + "\n");
    } else {
      process.stdout.write(renderPmHealthReport(report) + "\n");
    }
    return report.healthy ? 0 : 1;
  }

  const toolsOpt = flags.has("no-tools")
    ? []
    : opts.tools
      ? opts.tools.split(",").map((s) => s.trim())
      : undefined;
  // Strict Stop verification (lint + typecheck, blocking) is the default; --no-strict opts out.
  const strict = !flags.has("no-strict");
  // Large-file guard mode: --large-files=block|advisory. Omitted → buildPlan uses
  // the detector's recommendation (clean → block, legacy → advisory).
  const lf = opts["large-files"];
  const largeFiles = lf === "block" || lf === "advisory" ? lf : undefined;

  if (cmd === "plan") {
    const profile = scanProject(dir);
    const plan = buildPlan(profile, {
      pluginRoot: PLUGIN_ROOT,
      tools: toolsOpt,
      strict,
      largeFiles,
    });
    if (flags.has("json")) {
      const root = profile.root;
      const freshContent = plan.artifacts.find((a) => a.id === "claude-md-root")?.content ?? "";
      const existingContent = readText(path.join(root, "CLAUDE.md")) ?? "";
      const installed = {
        graphify: Boolean(
          exists(path.join(root, ".claude", "skills", "graphify")) ||
          exists(path.join(root, "graphify-out")) ||
          exists(path.join(root, ".claude", "hooks", "graphify-orient.mjs")),
        ),
        obsidian: Boolean(
          exists(path.join(root, ".claude", "rules", "obsidian.md")) ||
          readJson(path.join(root, ".mcp.json"))?.mcpServers?.obsidian != null,
        ),
      };
      const rootClaudeMd = auditRootClaudeMdSections({ freshContent, existingContent, installed });
      process.stdout.write(JSON.stringify({ ...plan, rootClaudeMd }, null, 2) + "\n");
    } else {
      process.stdout.write(renderPlanSummary(plan) + "\n");
    }
    return 0;
  }

  if (cmd === "apply") {
    const profile = scanProject(dir);
    const plan = buildPlan(profile, {
      pluginRoot: PLUGIN_ROOT,
      tools: toolsOpt,
      strict,
      largeFiles,
    });
    const selected = opts.only ? new Set(opts.only.split(",").map((s) => s.trim())) : undefined;
    const dryRun = !flags.has("yes");
    const res = applyPlan(plan, profile.root, {
      selected,
      dryRun,
      force: flags.has("force"),
      // Merge is always on from the CLI — applyPlan also defaults to it, but
      // this stays explicit so `--merge` (accepted below as a compatibility
      // no-op) never has to be consulted here.
      merge: true,
    });
    if (flags.has("json")) {
      process.stdout.write(JSON.stringify(res, null, 2) + "\n");
    } else {
      console.log(renderApplyResult(res, dryRun));
    }
    return res.errors.length > 0 ? 1 : 0;
  }

  console.error(`Unknown command: ${cmd}\n`);
  console.log(renderHelp(VERSION));
  return 2;
}

process.exitCode = main();
