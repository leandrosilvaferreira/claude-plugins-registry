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

/**
 * Detect one known stale-artifact case left behind by a fixed generator bug:
 * `renderRules()` (`lib/generate/rules.mjs`) used to always name the JS/TS rule file
 * `.claude/rules/javascript.md`, even for TypeScript projects; it now writes
 * `.claude/rules/typescript.md` for TypeScript. The artifact id is derived from the
 * path (`rule:${relPath}` in `lib/plan.mjs`), so a project scaffolded before that fix
 * keeps the old, mislabeled file forever: `apply`/`patch` only ever add what the
 * CURRENT plan wants — nothing in this pipeline compares a target's existing
 * `.claude/` contents against what an OLDER plan used to produce, so a renamed
 * artifact's stale copy is never flagged or removed on its own (no general
 * rename/orphan-detection mechanism exists here; this is one narrow, hardcoded
 * old-path check for this one rename, not a framework for renamed artifacts in
 * general).
 *
 * Deliberately NOT gated on `.claude/rules/typescript.md` being absent: once a
 * project is detected as TypeScript, `javascript.md` is stale regardless of
 * whether the replacement has already been added (e.g. by an earlier `doctor`
 * run) — gating on the new file's absence would make this check go silent
 * forever after the first successful add, leaving the stale file undetected.
 * @param {string} root
 * @param {string|null} primaryLanguage
 * @returns {boolean}
 */
export function hasStaleJavascriptRule(root, primaryLanguage) {
  return (
    primaryLanguage === "TypeScript" && exists(path.join(root, ".claude", "rules", "javascript.md"))
  );
}
