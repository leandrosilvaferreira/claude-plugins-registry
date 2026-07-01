/**
 * GitHub PM detection: checks if the project uses GitHub as VCS remote.
 * @module detect/github-pm
 */

/**
 * @param {{ vcs: import('../profile.mjs').VcsInfo }} profile
 * @param {{ rel: string, base: string }[]} files
 * @returns {import('../profile.mjs').GitHubPMInfo}
 */
export function detectGitHubPM(profile, files) {
  const remote = profile.vcs.remoteUrl ?? "";
  const detected = profile.vcs.isGit && remote.includes("github.com");
  return {
    detected,
    hasIssueTemplates: files.some((f) => f.rel.includes(".github/ISSUE_TEMPLATE")),
    hasWorkflows: files.some((f) => f.rel.includes(".github/workflows")),
    hasPmConfig: files.some((f) => f.rel.endsWith(".claude/pm-config.json")),
  };
}
