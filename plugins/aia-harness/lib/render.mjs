/**
 * Render every report/plan/help/apply-result the CLI (bin/harness.mjs) prints,
 * as plain or Markdown text. Pure: every export here takes a data object and
 * returns a string — no console/stdout access, so each is testable without a
 * subprocess (bin/harness.mjs owns the actual printing).
 * @module render
 */
import { commandsBlock } from "./generate/claude-md.mjs";

/** @typedef {import('./profile.mjs').ProjectProfile} ProjectProfile */
/** @typedef {import('./profile.mjs').DepsReport} DepsReport */
/** @typedef {import('./plan.mjs').HarnessPlan} HarnessPlan */
/** @typedef {import('./apply.mjs').ApplyResult} ApplyResult */
/** @typedef {import('./pm-check.mjs').PmHealthReport} PmHealthReport */

/**
 * @param {ProjectProfile} profile
 * @returns {string}
 */
export function renderReport(profile) {
  const langs =
    profile.languages
      .filter((l) => l.type === "programming")
      .slice(0, 6)
      .map((l) => `- ${l.name} — ${(l.share * 100).toFixed(0)}% (${l.files} files)`)
      .join("\n") || "- none detected";

  const fws =
    profile.frameworks
      .map((f) => `- ${f.name} (${f.category})${f.version ? ` ${f.version}` : ""} — ${f.evidence}`)
      .join("\n") || "- none detected";

  const pms =
    profile.packageManagers
      .map((p) => `- ${p.name} [${p.ecosystem}]${p.version ? ` ${p.version}` : ""} — ${p.evidence}`)
      .join("\n") || "- none detected";

  const domains =
    profile.architecture.domains
      .map((d) => `- \`${d.path}/\` (${d.kind}) — ${d.role}`)
      .join("\n") || "- none detected";

  const eh = profile.existingHarness;
  const existing = [
    `- CLAUDE.md: ${eh.claudeMd ? `yes (${eh.claudeMdFiles.length})` : "no"}`,
    `- settings.json: ${eh.settings ? "yes" : "no"}`,
    `- settings.local.json: ${eh.settingsLocal ? "yes" : "no"}`,
    `- .mcp.json: ${eh.mcp ? "yes" : "no"}`,
    `- hooks: ${eh.hooks ? "yes" : "no"}`,
    `- rules: ${eh.rules ? "yes" : "no"}`,
    `- skills: ${eh.skills.length > 0 ? eh.skills.join(", ") : "no"}`,
  ].join("\n");

  const hhIssues = profile.hookHygiene.placeholderIssues;
  const hookHygieneBlock =
    hhIssues.length > 0
      ? `\n\n## ⚠ Hook placeholder hygiene\n${hhIssues.length} hook(s) in .claude/settings.json use a bare $VAR instead of \${VAR} — Claude Code only expands the braced form in exec-form hooks (no shell), so these will throw MODULE_NOT_FOUND. Run \`/aia-harness:doctor\` to fix.\n${hhIssues.map((i) => `  - \`${i.script}\` (${i.event}): \`${i.arg}\``).join("\n")}`
      : "";

  const staleRuleBlock = profile.staleJavascriptRule
    ? `\n\n## ⚠ Stale rule file\n\`.claude/rules/javascript.md\` is a leftover from before this plugin named the TypeScript rule file \`typescript.md\` — this project is detected as TypeScript. Run \`/aia-harness:doctor\` to remove it.`
    : "";

  return `# Harness diagnosis — ${profile.root.split("/").pop()}

## Languages
${langs}
Primary: **${profile.primaryLanguage ?? "unknown"}**${profile.truncated ? "  _(scan truncated — large repo)_" : ""}

## Package managers
${pms}

## Frameworks & tools
${fws}

## Monorepo
${profile.monorepo.isMonorepo ? `- ${profile.monorepo.tool} — ${profile.monorepo.evidence}` : "- not a monorepo"}

## Architecture: ${profile.architecture.style}
${domains}

## Canonical commands (${profile.commands.source})
${commandsBlock(profile.commands)}

## Unit tests
${profile.testing.configured ? `- present${profile.testing.framework ? ` — ${profile.testing.framework}` : ""}` : `- none — recommended: ${profile.testing.recommended ?? "n/a (unknown stack)"}`}

## Large source files (>${profile.largeFiles.threshold} lines)
- ${profile.largeFiles.count === 0 ? "none — clean repo" : `${profile.largeFiles.count} pre-existing`} → recommended guard: **${profile.largeFiles.recommended}** (${profile.largeFiles.recommended === "block" ? "born strict: agent refactors before finishing" : "legacy-safe: suggest + confirm, never auto-block"})${profile.largeFiles.sample.length > 0 ? "\n" + profile.largeFiles.sample.map((s) => `  - \`${s.file}\` (${s.lines} lines)`).join("\n") : ""}

## Version control
- git: ${profile.vcs.isGit ? "yes" : "no"}${profile.vcs.defaultBranch ? ` (branch ${profile.vcs.defaultBranch})` : ""}
- worktree-ready: ${profile.vcs.worktreeReady ? "yes" : "no"}

## Existing harness
${existing}
${hookHygieneBlock}${staleRuleBlock}`;
}

/**
 * @param {HarnessPlan} plan
 * @returns {string}
 */
export function renderPlanSummary(plan) {
  /** @type {Map<string, import('./plan.mjs').Artifact[]>} */
  const byCat = new Map();
  for (const a of plan.artifacts) {
    const arr = byCat.get(a.category) ?? [];
    arr.push(a);
    byCat.set(a.category, arr);
  }

  let out = `# Proposed harness plan\n\n`;
  out += `Total session context cost (memory files): ~${plan.totalContextCost} tokens.\n\n`;
  for (const [cat, items] of byCat) {
    out += `### ${cat}\n`;
    for (const a of items) {
      const flags = [a.exists ? "exists" : "new", a.defaultSelected ? "selected" : "opt-in"];
      const cost = a.contextCost > 0 ? `, ~${a.contextCost}t` : "";
      out += `- \`${a.relPath}\` [${flags.join(", ")}${cost}] — ${a.rationale}\n`;
    }
    out += "\n";
  }
  if (plan.notes.length > 0) {
    out += `### Notes\n${plan.notes.map((n) => `- ${n}`).join("\n")}\n\n`;
  }
  out += `### .gitignore additions\n${plan.gitignore.map((g) => `- \`${g}\``).join("\n")}\n`;
  return out;
}

/**
 * @param {string} version
 * @returns {string}
 */
export function renderHelp(version) {
  return `aia-harness ${version} — scan a project and scaffold a Claude Code harness.

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
  aia-harness pm-check [dir] [--json]   GitHub PM pillar smoke check: does it
                                        actually work, not just "is it
                                        installed"? Verifies pm-config.json
                                        exists, has no leftover placeholders,
                                        is tracked by git, status names agree
                                        with the installed workflows, and the
                                        workflows are not stub loops
                                        (blocking); PROJECTS_PAT secret and
                                        gh token scope (advisory). Exit 1 on
                                        any blocking failure.
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
strategy and overwrites wholesale; --merge is accepted but is now a no-op.`;
}

/**
 * @param {ApplyResult} res
 * @param {boolean} dryRun
 * @returns {string}
 */
export function renderApplyResult(res, dryRun) {
  const prefix = dryRun ? "[dry-run] would create" : "created";
  const lines = [dryRun ? "DRY RUN (pass --yes to write)\n" : ""];
  for (const p of res.created) lines.push(`  ${prefix}: ${p}`);
  for (const p of res.updated)
    lines.push(`  ${dryRun ? "[dry-run] would update" : "updated"}: ${p}`);
  // Every conflict is also pushed to `res.skipped` (see lib/apply.mjs) carrying
  // this exact suffix, and gets its own CONFLICT: line below. Skip those here so
  // the enumerated list describes the same set the tally counts — otherwise each
  // conflict prints as both a `skipped:` and a `CONFLICT:` line while the tally
  // subtracts it, and the two disagree (measured: 196 skipped: lines, "192
  // skipped").
  for (const p of res.skipped) {
    if (p.endsWith("(conflict — pending review)")) continue;
    lines.push(`  skipped: ${p}`);
  }
  for (const c of res.conflicts)
    lines.push(`  CONFLICT: ${c.relPath} — pending review at ${c.pendingPath}`);
  for (const e of res.errors) lines.push(`  ERROR: ${e.path} — ${e.error}`);
  // `res.skipped.length` still includes every conflict, so subtract it here
  // rather than counting the same artifact in both tallies.
  lines.push(
    `\n${res.created.length} created, ${res.updated.length} updated, ${res.skipped.length - res.conflicts.length} skipped, ${res.conflicts.length} conflicts, ${res.errors.length} errors.`,
  );
  return lines.join("\n");
}

/**
 * Render a DepsReport as human-readable text for CLI output.
 * @param {DepsReport} report
 * @param {string} platform
 * @returns {string}
 */
export function renderDepsReport(report, platform) {
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
 * Render a PmHealthReport as human-readable text for CLI output.
 * @param {PmHealthReport} report
 * @returns {string}
 */
export function renderPmHealthReport(report) {
  const icon = { pass: "✓", fail: "✗", warn: "⚠" };
  const lines = report.checks.map((c) => {
    const line = `${icon[c.status]} [${c.blocking ? "blocking" : "advisory"}] ${c.id}: ${c.message}`;
    return c.remedy ? `${line}\n  → ${c.remedy}` : line;
  });
  lines.push("");
  lines.push(
    report.healthy
      ? "STATUS: healthy — the github-pm pillar is installed and wired correctly."
      : "STATUS: blocked — see the failing check(s) above; the pillar cannot work until they are fixed.",
  );
  return lines.join("\n");
}
