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
import { checkSystemDeps, resolveDepsFromProfile } from "../lib/detect/system-deps.mjs";

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
  aia-harness check [dir] [--json]      Check required system dependencies.
                    [--tools=a,b]       Also check deps for specific tools.
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
  for (const p of res.updated)
    console.log(`  ${dryRun ? "[dry-run] would update" : "updated"}: ${p}`);
  for (const p of res.skipped) console.log(`  skipped: ${p}`);
  for (const e of res.errors) console.log(`  ERROR: ${e.path} — ${e.error}`);
  console.log(
    `\n${res.created.length} created, ${res.updated.length} updated, ${res.skipped.length} skipped, ${res.errors.length} errors.`,
  );
}

/**
 * Render a DepsReport as human-readable text for CLI output.
 * @param {import('../lib/profile.mjs').DepsReport} report
 * @param {string} platform
 * @returns {string}
 */
function formatDepsReport(report, platform) {
  const plat = /** @type {'win32'|'darwin'|'linux'} */ (
    platform === "win32" ? "win32" : platform === "darwin" ? "darwin" : "linux"
  );
  const lines = [];
  for (const c of report.checks) {
    if (c.found) {
      lines.push(`✓ ${c.name.padEnd(12)} v${c.version ?? "?"}   ${c.resolvedPath}`);
    } else {
      lines.push(`✗ ${c.name.padEnd(12)} não encontrado  [${c.level}]`);
      const hint = c.installHint[plat];
      if (hint) lines.push(`  → ${plat}: ${hint}`);
    }
  }
  lines.push("");
  if (report.status === "block") {
    lines.push("BLOQUEADO: instale as dependências acima antes de continuar.");
  } else if (report.status === "warn") {
    const n = report.checks.filter((c) => !c.found).length;
    lines.push(
      `STATUS: ok  (${n} recommended ausente${n !== 1 ? "s" : ""}, nenhum required faltando)`,
    );
  } else {
    lines.push("STATUS: ok  todas as dependências encontradas.");
  }
  return lines.join("\n");
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

  if (cmd === "check") {
    const toolList = opts.tools
      ? opts.tools
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean)
      : [];
    const profile = scanProject(dir);
    const deps = resolveDepsFromProfile(profile, toolList);
    const report = checkSystemDeps(deps, process.platform);
    if (flags.has("json")) {
      console.log(JSON.stringify(report, null, 2));
    } else {
      console.log(formatDepsReport(report, process.platform));
    }
    return report.status === "block" ? 1 : 0;
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
    console.log(flags.has("json") ? JSON.stringify(plan, null, 2) : renderPlanSummary(plan));
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
    const res = applyPlan(plan, profile.root, { selected, dryRun, force: flags.has("force") });
    printApply(res, dryRun);
    return res.errors.length > 0 ? 1 : 0;
  }

  console.error(`Unknown command: ${cmd}\n`);
  printHelp();
  return 2;
}

process.exit(main());
