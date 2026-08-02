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
import { renderReport, renderPlanSummary } from "../lib/render.mjs";
import { applyPlan } from "../lib/apply.mjs";
import {
  checkSystemDeps,
  resolveDepsFromProfile,
  detectInstalledTools,
} from "../lib/detect/system-deps.mjs";
import { checkGhAuth } from "../lib/detect/gh-auth.mjs";
import { GH_SCOPES_BASE, GH_SCOPES_PM } from "../lib/data/gh-scopes.mjs";
import { auditRootClaudeMdSections } from "../lib/generate/root-sections.mjs";
import { checkPluginVersion } from "../lib/version-check.mjs";
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
                    [--merge]           No-op: merging is the default apply
                                        behaviour now, so this flag is only
                                        accepted for backward compatibility
  aia-harness check [dir] [--json]      Check required system dependencies.
                    [--tools=a,b]       Also check deps for specific tools.
  aia-harness version-check [--json]    Is this running copy the latest published
                    [--no-refresh]      version? Every slash command runs this
                                        first. Always exits 0 (fail-open).
  aia-harness help | version

Apply is a dry run unless --yes is given. Merging into an existing harness is
the default: artifacts that are safe to write are applied, and anything that
exists and differs with no mechanical merge strategy is reported in
conflicts[] instead of being overwritten. A merged CLAUDE.md section that
exists and differs is reported there too, despite carrying a strategy: that
strategy replaces the whole section rather than merging it key by key, so a
differing one is parked instead of replaced. --force bypasses every merge
strategy and overwrites wholesale; --merge is accepted but is now a no-op.`);
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
  // Every conflict is also pushed to `res.skipped` (see lib/apply.mjs) carrying
  // this exact suffix, and gets its own CONFLICT: line below. Skip those here so
  // the enumerated list describes the same set the tally counts — otherwise each
  // conflict prints as both a `skipped:` and a `CONFLICT:` line while the tally
  // subtracts it, and the two disagree (measured: 196 skipped: lines, "192
  // skipped").
  for (const p of res.skipped) {
    if (p.endsWith("(conflict — pending review)")) continue;
    console.log(`  skipped: ${p}`);
  }
  for (const c of res.conflicts)
    console.log(`  CONFLICT: ${c.relPath} — pending review at ${c.pendingPath}`);
  for (const e of res.errors) console.log(`  ERROR: ${e.path} — ${e.error}`);
  // `res.skipped.length` still includes every conflict, so subtract it here
  // rather than counting the same artifact in both tallies.
  console.log(
    `\n${res.created.length} created, ${res.updated.length} updated, ${res.skipped.length - res.conflicts.length} skipped, ${res.conflicts.length} conflicts, ${res.errors.length} errors.`,
  );
}

/**
 * Widen the PM-tier decision past `profile.githubPM.hasPmConfig`'s "found in the
 * scanned file list" contract. `.claude/pm-config.json` is gitignored (lib/plan.mjs),
 * so git never copies it into a linked worktree on its own — `hasPmConfig` is always
 * false there even on a genuine PM project, and `check` would ask for only the base
 * scope tier. `CLAUDE_PROJECT_DIR` (set by Claude Code to the invoking project's root)
 * is checked directly, but only when it points somewhere other than the scanned dir —
 * this is the worktree case, not a redundant re-check of the same directory.
 *
 * Fail-open: any error here (missing env, fs failure) is swallowed and treated as
 * "no widening" — this must never throw or otherwise affect `check`'s exit code.
 * Does NOT change what `detectGitHubPM` itself means: `hasPmConfig` keeps meaning
 * "found in the scanned file list", this only widens where the tier is *chosen*.
 *
 * @param {import('../lib/profile.mjs').ProjectProfile} profile
 * @returns {boolean}
 */
function needsPmScopes(profile) {
  if (profile.githubPM?.hasPmConfig) return true;
  try {
    const projectDir = process.env.CLAUDE_PROJECT_DIR;
    if (!projectDir || path.resolve(projectDir) === path.resolve(profile.root)) return false;
    return exists(path.join(projectDir, ".claude", "pm-config.json"));
  } catch {
    return false;
  }
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
      lines.push(`✗ ${c.name.padEnd(12)} not found  [${c.level}]`);
      const hint = c.installHint[plat];
      if (hint) lines.push(`  → ${plat}: ${hint}`);
    }
  }
  lines.push("");
  if (report.status === "block") {
    lines.push("BLOCKED: install the dependencies above before continuing.");
  } else if (report.status === "warn") {
    const n = report.checks.filter((c) => !c.found).length;
    lines.push(`STATUS: ok  (${n} recommended missing, no required deps missing)`);
  } else {
    lines.push("STATUS: ok  all dependencies found.");
  }

  if (
    report.ghAuth &&
    (!report.ghAuth.available ||
      report.ghAuth.envTokenOverride ||
      !report.ghAuth.authenticated ||
      report.ghAuth.missing.length > 0)
  ) {
    lines.push("");
    if (!report.ghAuth.available) {
      // gh was found on disk but spawnSync could not run it (corrupt binary,
      // permission problem, timeout, non-functional shim) — nothing else about
      // its auth state was determined, so `missing`/`authenticated` below are
      // artifacts of that failure, not findings. Neither `gh auth refresh` nor
      // `gh auth login` can fix a binary that will not start.
      lines.push(
        "⚠  gh was found but could not be run.",
        "   Verify the installation by running `gh --version` yourself.",
      );
    } else if (report.ghAuth.envTokenOverride) {
      lines.push(
        "⚠  GH_TOKEN/GITHUB_TOKEN is set — gh prefers it over the keyring account,",
        "   so its permissions are what apply. Run `unset GH_TOKEN GITHUB_TOKEN` to",
        "   fall back to the OAuth login before refreshing scopes.",
      );
    } else if (!report.ghAuth.authenticated) {
      // A freshly-installed gh: `gh auth refresh` has nothing to refresh yet —
      // that command only adds scopes to an existing login. `missing` already
      // equals the full required tier here (checkGhAuth diffs against an empty
      // granted list when not authenticated), so it's the right scope list to log in with.
      lines.push(
        "⚠  gh is not logged in to any host.",
        `   Run: gh auth login -h github.com -s ${report.ghAuth.missing.join(",")}`,
        "   Confirm with `gh auth status`.",
      );
    } else {
      lines.push(
        `⚠  gh is missing OAuth scope(s): ${report.ghAuth.missing.join(", ")}`,
        `   Run: ${report.ghAuth.refreshCmd}`,
        "   Confirm with `gh auth status`.",
      );
    }
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

    // Scopes are only meaningful once the binary exists. The PM tier applies
    // when the project is already wired to a GitHub Project; a plain GitHub
    // repo is asked for the base tier only (least privilege).
    const ghCheck = report.checks.find((c) => c.name === "gh");
    const payload = ghCheck?.found
      ? {
          ...report,
          ghAuth: checkGhAuth(needsPmScopes(profile) ? GH_SCOPES_PM : GH_SCOPES_BASE, {
            binPath: ghCheck.resolvedPath,
          }),
        }
      : report;

    if (flags.has("json")) {
      process.stdout.write(JSON.stringify(payload, null, 2) + "\n");
    } else {
      process.stdout.write(formatDepsReport(payload, process.platform) + "\n");
    }
    // Missing scopes are advisory: the exit code stays driven by the dep
    // status alone, so `ghAuth` can never halt a harness operation.
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
      printApply(res, dryRun);
    }
    return res.errors.length > 0 ? 1 : 0;
  }

  console.error(`Unknown command: ${cmd}\n`);
  printHelp();
  return 2;
}

process.exitCode = main();
