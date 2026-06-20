/**
 * Git / version-control detection.
 * @module detect/vcs
 */
import path from "node:path";
import { exists, readText } from "../util/fs.mjs";

/**
 * @param {string} root
 * @returns {import('../profile.mjs').VcsInfo}
 */
export function detectVcs(root) {
  const isGit = exists(path.join(root, ".git"));
  /** @type {string|null} */
  let defaultBranch = null;
  /** @type {string|null} */
  let remoteUrl = null;
  const head = readText(path.join(root, ".git", "HEAD"));
  if (head) {
    const m = head.match(/ref:\s*refs\/heads\/(.+)\s*$/m);
    if (m) defaultBranch = m[1].trim();
  }
  const config = readText(path.join(root, ".git", "config"));
  if (config) {
    const m = config.match(/url\s*=\s*(.+)/);
    if (m) remoteUrl = m[1].trim();
  }
  return { isGit, worktreeReady: isGit, defaultBranch, remoteUrl };
}
