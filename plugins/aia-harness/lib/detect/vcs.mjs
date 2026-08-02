/**
 * Git / version-control detection.
 * @module detect/vcs
 */
import path from "node:path";
import { exists, readText } from "../util/fs.mjs";

/**
 * Resolve the two directories holding this checkout's git metadata.
 *
 * In an ordinary checkout `.git` is a directory and both live there. In a
 * linked worktree `.git` is a FILE containing `gitdir: <path>`, and the split
 * matters: HEAD lives in that per-worktree directory, while `config` lives in
 * the common directory the worktree's own `commondir` file points at. Reading
 * `<root>/.git/HEAD` blindly descends into a file and yields nothing, which is
 * why a worktree used to report a null branch and a null remote while still
 * reporting `isGit: true` — the profile looked fine and was silently wrong.
 *
 * `readText` returns null on a directory (it catches EISDIR), so the pointer
 * read doubles as the file-vs-directory discriminator; no statSync needed.
 *
 * @param {string} root
 * @returns {{ gitDir: string, commonDir: string }|null} null when not a git checkout.
 */
function resolveGitDirs(root) {
  const dotGit = path.join(root, ".git");
  if (!exists(dotGit)) return null;

  const pointer = readText(dotGit);
  const match = pointer?.match(/^gitdir:\s*(.+)$/m);
  if (!match) return { gitDir: dotGit, commonDir: dotGit };

  // The pointer is absolute in practice, but git may write it relative to the
  // worktree; path.resolve handles both.
  const gitDir = path.resolve(root, match[1].trim());
  const commonRel = readText(path.join(gitDir, "commondir"));
  const commonDir = commonRel ? path.resolve(gitDir, commonRel.trim()) : gitDir;
  return { gitDir, commonDir };
}

/**
 * @param {string} root
 * @returns {import('../profile.mjs').VcsInfo}
 */
export function detectVcs(root) {
  const dirs = resolveGitDirs(root);
  /** @type {string|null} */
  let defaultBranch = null;
  /** @type {string|null} */
  let remoteUrl = null;

  if (dirs) {
    const head = readText(path.join(dirs.gitDir, "HEAD"));
    if (head) {
      const m = head.match(/ref:\s*refs\/heads\/(.+)\s*$/m);
      if (m) defaultBranch = m[1].trim();
    }
    const config = readText(path.join(dirs.commonDir, "config"));
    if (config) {
      const m = config.match(/url\s*=\s*(.+)/);
      if (m) remoteUrl = m[1].trim();
    }
  }

  const isGit = dirs !== null;
  return { isGit, worktreeReady: isGit, defaultBranch, remoteUrl };
}
