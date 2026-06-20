/**
 * Render the diagnosis report and plan summary as Markdown.
 * @module render
 */
import { commandsBlock } from "./generate/claude-md.mjs";

/** @typedef {import('./profile.mjs').ProjectProfile} ProjectProfile */
/** @typedef {import('./plan.mjs').HarnessPlan} HarnessPlan */

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
    profile.frameworks.map((f) => `- ${f.name} (${f.category})${f.version ? ` ${f.version}` : ""} — ${f.evidence}`).join("\n") ||
    "- none detected";

  const pms =
    profile.packageManagers.map((p) => `- ${p.name} [${p.ecosystem}]${p.version ? ` ${p.version}` : ""} — ${p.evidence}`).join("\n") ||
    "- none detected";

  const domains =
    profile.architecture.domains.map((d) => `- \`${d.path}/\` (${d.kind}) — ${d.role}`).join("\n") || "- none detected";

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
`;
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
