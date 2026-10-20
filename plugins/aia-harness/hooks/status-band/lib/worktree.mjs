const WT_RE = /[/\\]\.claude[/\\]worktrees[/\\]/;

/**
 * @typedef {object} WorktreeInfo
 * @property {string} name Worktree name; multi-segment names keep their `/`.
 * @property {string} root Worktree root directory.
 * @property {string} realRoot Main checkout that owns `.claude/worktrees`.
 */

/**
 * Resolves the worktree a directory belongs to.
 * @param {string} cwd Session working directory (`/` or `\` separators).
 * @param {(p: string) => boolean} exists Reports whether a path exists.
 * @returns {WorktreeInfo | null} Null outside a worktree.
 */
export function resolveWorktree(cwd, exists) {
  const m = WT_RE.exec(cwd);
  if (!m) return null;
  const realRoot = cwd.slice(0, m.index);
  const sepBefore = m[0].slice(-1);
  const base = cwd.slice(0, m.index + m[0].length);
  const segments = cwd.slice(base.length).split(/[/\\]/).filter(Boolean);
  // Shortest prefix holding a `.git` is the worktree root.
  for (let i = 1; i <= segments.length; i++) {
    const root = base + segments.slice(0, i).join(sepBefore);
    if (exists(root + sepBefore + ".git")) {
      return { name: segments.slice(0, i).join("/"), root, realRoot };
    }
  }
  return null;
}
