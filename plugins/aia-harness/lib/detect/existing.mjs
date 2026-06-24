/**
 * Detect any harness artifacts already present in the project.
 * @module detect/existing
 */
import path from "node:path";
import { exists, isDir, listDirs, readText } from "../util/fs.mjs";

/**
 * @param {string} root
 * @param {import('../util/fs.mjs').CollectedFile[]} files
 * @returns {import('../profile.mjs').ExistingHarness}
 */
export function detectExistingHarness(root, files) {
  const claudeMdFiles = files.filter((f) => f.base === "CLAUDE.md").map((f) => f.rel);
  const claudeDir = path.join(root, ".claude");
  const skillsDir = path.join(claudeDir, "skills");
  const skills = isDir(skillsDir) ? listDirs(skillsDir) : [];

  // Check graphify git hooks by marker strings in .git/hooks/
  const postCommitContent = readText(path.join(root, ".git", "hooks", "post-commit")) ?? "";
  const postCheckoutContent = readText(path.join(root, ".git", "hooks", "post-checkout")) ?? "";
  const graphifyGitHooks = {
    postCommit: postCommitContent.includes("# graphify-hook-start"),
    postCheckout: postCheckoutContent.includes("# graphify-checkout-hook-start"),
  };

  return {
    claudeMd: claudeMdFiles.length > 0,
    claudeMdFiles,
    settings: exists(path.join(claudeDir, "settings.json")),
    settingsLocal: exists(path.join(claudeDir, "settings.local.json")),
    mcp: exists(path.join(root, ".mcp.json")),
    hooks: exists(path.join(claudeDir, "hooks")) || exists(path.join(claudeDir, "hooks.json")),
    rules: isDir(path.join(claudeDir, "rules")),
    skills,
    graphifyGitHooks,
  };
}
