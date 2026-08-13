/**
 * Git tracked/ignored status for a single path.
 *
 * Backs the GitHub PM smoke check's most important guard (lib/pm-check.mjs,
 * "config-tracked"): GitHub Actions checks out committed files only, so an
 * untracked or gitignored `.claude/pm-config.json` means every workflow's
 * "config missing" fallback silently fires on every run — a green CI run
 * that moves nothing, with no error anywhere. Whether a path is tracked or
 * ignored is a question only git itself can answer correctly (the index is
 * a binary format, and .gitignore pattern matching has real semantics —
 * nested files, negation — not worth reimplementing), so this shells out to
 * `git ls-files --error-unmatch` and `git check-ignore` rather than
 * inspecting the filesystem.
 *
 * FAIL-OPEN on environmental failure (git binary missing, spawn throwing) —
 * never throws. A directory that is not a git repository at all (git's own
 * exit code 128) is reported as `isGitRepo: false` rather than thrown, so
 * callers can treat it as advisory instead of crashing — same fail-open
 * philosophy as lib/detect/gh-auth.mjs.
 *
 * git.exe ships as a real PE binary on every standard Windows install
 * (unlike `gh`, which lib/detect/gh-auth.mjs found shipped as a .bat/.cmd
 * shim under some install methods) — so this needs none of that module's
 * shell:true + pre-resolved-binPath dance. A plain spawnSync("git", ...) is
 * the existing, already-cross-platform pattern this repo uses for git
 * elsewhere (templates/skills/github-pm/scripts/worktree-safety-check.mjs).
 *
 * @module detect/git-track-status
 */
import { spawnSync } from "node:child_process";

/**
 * @typedef {Object} GitTrackStatus
 * @property {boolean} isGitRepo  False when `root` is not inside a git working tree, or git
 *   itself could not be run at all — both are fail-open, indistinguishable to callers, and
 *   both mean "cannot determine tracked/ignored" rather than "confirmed untracked".
 * @property {boolean} tracked    Meaningful only when isGitRepo is true.
 * @property {boolean} ignored    Meaningful only when isGitRepo is true.
 */

/**
 * @param {string} root     Directory to run git in — its working tree.
 * @param {string} relPath  Path relative to root, e.g. ".claude/pm-config.json".
 * @returns {GitTrackStatus}
 */
export function checkPathGitStatus(root, relPath) {
  const notAGitRepo = { isGitRepo: false, tracked: false, ignored: false };

  /**
   * @param {string[]} args
   * @returns {number | null} exit status, or null on any environmental failure (fail-open).
   */
  const run = (args) => {
    try {
      const r = spawnSync("git", args, {
        cwd: root,
        encoding: "utf8",
        windowsHide: true,
        timeout: 10_000,
      });
      if (r.error || r.status === null) return null;
      return r.status;
    } catch {
      return null;
    }
  };

  const lsFilesStatus = run(["ls-files", "--error-unmatch", "--", relPath]);
  // 128 = "fatal: not a git repository" (or any other fatal usage error) — git itself
  // ran, but root is not inside a working tree it recognizes. null = git could not be
  // run at all (binary missing, spawn failure). Both are fail-open, same as gh-auth.mjs.
  if (lsFilesStatus === null || lsFilesStatus === 128) return notAGitRepo;

  const checkIgnoreStatus = run(["check-ignore", "--", relPath]);
  if (checkIgnoreStatus === null || checkIgnoreStatus === 128) return notAGitRepo;

  return {
    isGitRepo: true,
    tracked: lsFilesStatus === 0,
    ignored: checkIgnoreStatus === 0,
  };
}
