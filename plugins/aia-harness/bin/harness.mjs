#!/usr/bin/env node
/**
 * aia-harness CLI — deterministic core for scan / plan / apply.
 * The Claude Code commands wrap this for the interactive consent loop.
 *
 * @module bin/harness
 */
import path from "node:path";
import { fileURLToPath } from "node:url";
import { scanProject } from "../lib/detect/index.mjs";
import { buildPlan } from "../lib/plan.mjs";
import { renderReport, renderPlanSummary } from "../lib/render.mjs";
import { applyPlan } from "../lib/apply.mjs";

const PLUGIN_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const VERSION = "0.1.1";

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

function printHelp() {
  console.log(`aia-harness ${VERSION} — scan a project and scaffold a Claude Code harness.

Usage:
  aia-harness scan  [dir] [--json]      Diagnose stack/architecture (read-only).
  aia-harness plan  [dir] [--json]      Show the proposed harness plan.
  aia-harness apply [dir] [--yes]       Apply the plan (default: dry-run preview).
                    [--only=id,id] [--force]
                    [--tools=a,b | --no-tools]   Limit/skip project-level tools
                    [--no-strict]                Passive Stop reminder instead of
                                                 the blocking lint+typecheck loop
                    [--large-files=block|advisory]  Large-file guard mode: block
                                                 (refactor before finishing) or
                                                 advisory (suggest + confirm).
                                                 Default: detector recommendation
  aia-harness help | version

Apply is a dry run unless --yes is given. Existing differing files are left
unchanged unless --force is passed.`);
}

/**
 * @param {import('../lib/apply.mjs').ApplyResult} res
 * @param {boolean} dryRun
 */
function printApply(res, dryRun) {
  const prefix = dryRun ? "[dry-run] would create" : "created";
  console.log(`${dryRun ? "DRY RUN (pass --yes to write)\n" : ""}`);
  for (const p of res.created) console.log(`  ${prefix}: ${p}`);
  for (const p of res.updated) console.log(`  ${dryRun ? "[dry-run] would update" : "updated"}: ${p}`);
  for (const p of res.skipped) console.log(`  skipped: ${p}`);
  for (const e of res.errors) console.log(`  ERROR: ${e.path} — ${e.error}`);
  console.log(
    `\n${res.created.length} created, ${res.updated.length} updated, ${res.skipped.length} skipped, ${res.errors.length} errors.`,
  );
}

/**
 * @returns {number}
 */
function main() {
  const { cmd, dir, flags, opts } = parseArgs(process.argv.slice(2));

  if (cmd === "help" || flags.has("help")) {
    printHelp();
    return 0;
  }
  if (cmd === "version" || flags.has("version")) {
    console.log(`aia-harness ${VERSION}`);
    return 0;
  }

  if (cmd === "scan") {
    const profile = scanProject(dir);
    console.log(flags.has("json") ? JSON.stringify(profile, null, 2) : renderReport(profile));
    return 0;
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
    const plan = buildPlan(profile, { pluginRoot: PLUGIN_ROOT, tools: toolsOpt, strict, largeFiles });
    console.log(flags.has("json") ? JSON.stringify(plan, null, 2) : renderPlanSummary(plan));
    return 0;
  }

  if (cmd === "apply") {
    const profile = scanProject(dir);
    const plan = buildPlan(profile, { pluginRoot: PLUGIN_ROOT, tools: toolsOpt, strict, largeFiles });
    const selected = opts.only ? new Set(opts.only.split(",").map((s) => s.trim())) : undefined;
    const dryRun = !flags.has("yes");
    const res = applyPlan(plan, profile.root, { selected, dryRun, force: flags.has("force") });
    printApply(res, dryRun);
    return res.errors.length > 0 ? 1 : 0;
  }

  console.error(`Unknown command: ${cmd}\n`);
  printHelp();
  return 2;
}

process.exit(main());
