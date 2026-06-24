/**
 * Detection pipeline orchestrator: produces a ProjectProfile.
 * @module detect
 */
import path from "node:path";
import { collectFiles } from "../util/fs.mjs";
import { detectLanguages } from "./language.mjs";
import { detectPackageManagers } from "./package-manager.mjs";
import { detectFrameworks } from "./frameworks.mjs";
import { detectMonorepo } from "./monorepo.mjs";
import { detectCommands } from "./commands.mjs";
import { detectArchitecture } from "./architecture.mjs";
import { detectExistingHarness } from "./existing.mjs";
import { detectVcs } from "./vcs.mjs";
import { detectTesting } from "./testing.mjs";
import { detectLargeFiles } from "./large-files.mjs";
import { detectGitHubPM } from "./github-pm.mjs";

/** Root-level files worth surfacing in the report as evidence. */
const MARKER_FILES = new Set([
  "package.json",
  "tsconfig.json",
  "composer.json",
  "pyproject.toml",
  "requirements.txt",
  "go.mod",
  "Cargo.toml",
  "pom.xml",
  "build.gradle",
  "build.gradle.kts",
  "Gemfile",
  "Dockerfile",
  "docker-compose.yml",
  "compose.yaml",
  "turbo.json",
  "nx.json",
  "pnpm-workspace.yaml",
  "Makefile",
  "justfile",
  "artisan",
  "manage.py",
]);

/**
 * Run the full detection pipeline against a project root.
 * @param {string} root
 * @param {{ maxFiles?: number }} [opts]
 * @returns {import('../profile.mjs').ProjectProfile}
 */
export function scanProject(root, opts = {}) {
  const abs = path.resolve(root);
  const { files, truncated } = collectFiles(abs, { maxFiles: opts.maxFiles });

  const rootFiles = new Set(files.filter((f) => !f.rel.includes("/")).map((f) => f.base));

  // Exclude harness config dirs from stack detection only — they belong to the
  // scaffolded harness, not to the target project's own language/framework.
  const HARNESS_ROOT_DIRS = new Set([".claude", ".agents", ".agent"]);
  const stackFiles = files.filter((f) => !HARNESS_ROOT_DIRS.has(f.rel.split("/")[0]));
  const stackRelSet = new Set(stackFiles.map((f) => f.rel));

  const { languages, primaryLanguage } = detectLanguages(stackFiles);
  const packageManagers = detectPackageManagers(abs, rootFiles, languages);
  const frameworks = detectFrameworks(abs, stackRelSet);
  const monorepo = detectMonorepo(abs, rootFiles);
  const commands = detectCommands(abs, packageManagers, rootFiles, frameworks);
  const architecture = detectArchitecture(abs, monorepo);
  const existingHarness = detectExistingHarness(abs, files);
  const vcs = detectVcs(abs);
  const markers = [...rootFiles].filter((f) => MARKER_FILES.has(f)).sort();

  const profile = {
    root: abs,
    languages,
    primaryLanguage,
    packageManagers,
    frameworks,
    monorepo,
    commands,
    architecture,
    existingHarness,
    testing: /** @type {import('../profile.mjs').TestingInfo} */ ({
      configured: false,
      framework: null,
      hasTestFiles: false,
      hasTestScript: false,
      recommended: null,
      installNeeded: false,
      evidence: "pending",
    }),
    largeFiles: /** @type {import('../profile.mjs').LargeFilesInfo} */ ({
      threshold: 350,
      count: 0,
      recommended: "block",
      sample: [],
    }),
    githubPM: /** @type {import('../profile.mjs').GitHubPMInfo} */ ({
      detected: false,
      hasIssueTemplates: false,
      hasWorkflows: false,
      hasPmConfig: false,
    }),
    vcs,
    markers,
    truncated,
  };
  profile.testing = detectTesting(profile, files);
  profile.largeFiles = detectLargeFiles(abs, files);
  profile.githubPM = detectGitHubPM(profile, files);
  return profile;
}
