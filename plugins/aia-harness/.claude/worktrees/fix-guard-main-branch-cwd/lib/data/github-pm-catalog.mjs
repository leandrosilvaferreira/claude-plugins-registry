/**
 * GitHub PM distributable-asset catalog.
 * Parallel to ecc-catalog.mjs — one module per provenance.
 *
 * Templates live in:
 *   templates/skills/github-pm/      first-party skill
 *   templates/commands/pm/           10 /pm:* commands
 *   templates/github/                ISSUE_TEMPLATE, workflows, pm-config
 *   templates/github-pm-ext/         vendored github-issues + github-project
 *
 * @module data/github-pm-catalog
 */
import path from "node:path";
import { fileURLToPath } from "node:url";

const PLUGIN_ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const T = path.join(PLUGIN_ROOT, "templates");

/**
 * @typedef {Object} GitHubPMArtifactDef
 * @property {string} id
 * @property {string} description
 * @property {string} copyFrom   Absolute path in templates/.
 * @property {string} dest       Relative path in target project.
 */

/** @type {GitHubPMArtifactDef[]} */
const GITHUB_PM_ARTIFACTS = [
  {
    id: "github-pm:skill",
    description: "First-party GitHub PM skill (lifecycle orchestration + delegation map)",
    copyFrom: path.join(T, "skills", "github-pm"),
    dest: ".claude/skills/github-pm",
  },
  {
    id: "github-pm:commands",
    description: "10 /pm:* commands for the full issue→worktree→PR→merge loop",
    copyFrom: path.join(T, "commands", "pm"),
    dest: ".claude/commands/pm",
  },
  {
    id: "github-pm:issue-templates",
    description: "GitHub issue templates: bug, feature, task",
    copyFrom: path.join(T, "github", "ISSUE_TEMPLATE"),
    dest: ".github/ISSUE_TEMPLATE",
  },
  {
    id: "github-pm:pr-template",
    description: "GitHub pull request template with acceptance criteria checklist",
    copyFrom: path.join(T, "github", "PULL_REQUEST_TEMPLATE.md"),
    dest: ".github/PULL_REQUEST_TEMPLATE.md",
  },
  {
    id: "github-pm:workflows",
    description: "4 GitHub Actions workflows: issue lifecycle → Projects v2 status automation",
    copyFrom: path.join(T, "github", "workflows"),
    dest: ".github/workflows",
  },
  {
    id: "github-pm:pm-config",
    description:
      "pm-config.json template — fill real IDs via /pm:setup-project (never overwritten)",
    copyFrom: path.join(T, "github", "pm-config.json.template"),
    dest: ".claude/pm-config.json",
  },
  {
    id: "github-pm:github-issues",
    description: "Vendored skill: github-issues (github/awesome-copilot, MIT)",
    copyFrom: path.join(T, "github-pm-ext", "github-issues"),
    dest: ".claude/skills/github-issues",
  },
  {
    id: "github-pm:github-project",
    description:
      "Vendored skill: github-project (netresearch/github-project-skill, MIT AND CC-BY-SA-4.0)",
    copyFrom: path.join(T, "github-pm-ext", "github-project"),
    dest: ".claude/skills/github-project",
  },
];

/**
 * Select GitHub PM artifacts for a profile. Returns [] if not detected.
 * @param {import('../profile.mjs').ProjectProfile} profile
 * @returns {GitHubPMArtifactDef[]}
 */
export function selectGitHubPMAssets(profile) {
  if (!profile.githubPM?.detected) return [];
  return GITHUB_PM_ARTIFACTS;
}
