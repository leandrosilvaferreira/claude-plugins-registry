/**
 * Filesystem helpers for the detection engine. Synchronous on purpose:
 * a CLI scan is short-lived and deterministic ordering is easier to test.
 *
 * @module util/fs
 */
import fs from "node:fs";
import path from "node:path";

/** Directories never worth scanning for stack detection. */
export const IGNORE_DIRS = new Set([
  ".git",
  "node_modules",
  "bower_components",
  "vendor",
  "dist",
  "build",
  "out",
  "coverage",
  ".next",
  ".nuxt",
  ".svelte-kit",
  ".output",
  ".turbo",
  ".cache",
  ".parcel-cache",
  "target",
  ".gradle",
  ".venv",
  "venv",
  "__pycache__",
  ".mypy_cache",
  ".pytest_cache",
  ".tox",
  ".idea",
  ".vscode-test",
  ".terraform",
  ".serverless",
  "Pods",
  "obj",
  "tmp",
]);

/**
 * @param {string} p
 * @returns {boolean}
 */
export function exists(p) {
  try {
    fs.accessSync(p);
    return true;
  } catch {
    return false;
  }
}

/**
 * @param {string} p
 * @returns {boolean}
 */
export function isDir(p) {
  try {
    return fs.statSync(p).isDirectory();
  } catch {
    return false;
  }
}

/**
 * @param {string} p
 * @returns {string|null}
 */
export function readText(p) {
  try {
    return fs.readFileSync(p, "utf8");
  } catch {
    return null;
  }
}

/**
 * Parse a JSON file, tolerating absence and syntax errors.
 * @param {string} p
 * @returns {any}
 */
export function readJson(p) {
  const text = readText(p);
  if (text == null) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

/**
 * List immediate child directory names of a directory (sorted, ignores hidden
 * build dirs from IGNORE_DIRS but keeps dot-config dirs like `.claude`).
 * @param {string} dir
 * @returns {string[]}
 */
export function listDirs(dir) {
  /** @type {string[]} */
  const result = [];
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return result;
  }
  for (const e of entries) {
    if (e.isDirectory() && !IGNORE_DIRS.has(e.name)) result.push(e.name);
  }
  return result.sort();
}

/**
 * @typedef {Object} CollectedFile
 * @property {string} rel  Path relative to root, POSIX separators.
 * @property {string} ext  Lowercase extension including dot, or "" if none.
 * @property {string} base Basename.
 * @property {number} size Size in bytes.
 */

/**
 * @typedef {Object} CollectResult
 * @property {CollectedFile[]} files
 * @property {Set<string>} dirs   Relative directory paths (POSIX).
 * @property {boolean} truncated
 */

/**
 * @param {string} parent  Resolved real path of the ancestor directory.
 * @param {string} child   Resolved real path to test.
 * @returns {boolean} true if child is parent itself or a path-segment-aware descendant of it
 *   (a bare `startsWith` would wrongly count "/a/bc" as inside "/a/b").
 */
function isPathInside(parent, child) {
  if (child === parent) return true;
  const withSep = parent.endsWith(path.sep) ? parent : parent + path.sep;
  return child.startsWith(withSep);
}

/**
 * Recursively collect files under root, skipping ignored directories.
 *
 * Symlinks are followed: `Dirent.isFile()`/`isDirectory()` are false for a
 * symlink itself (they describe the link, not its target), so a symlinked
 * entry is resolved via `fs.statSync` (which follows the link) to decide
 * whether it behaves as a file or a directory. A symlinked directory is
 * subject to the exact same `IGNORE_DIRS`/`.egg-info`/depth rules as a real
 * one. Descending into a directory (real or reached through one or more
 * symlink hops) records its resolved real path in `visitedDirs`; refusing to
 * re-descend into an already-visited real path is what stops a symlink cycle
 * (self-referential, or pointing at an ancestor) from walking forever —
 * without it, a link back up the tree turns every subsequent directory
 * beneath it into an endlessly regenerating "new" node for the stack, since
 * those inner directories are ordinary (non-symlink) dirents once the first
 * hop has been taken. A symlink is also refused if its resolved real path
 * falls outside `root` itself — a link to a sibling package, a mounted
 * volume, `$HOME`, or `/` would otherwise make the walk do real I/O over
 * content that isn't this project's, bounded only by `maxDepth`; the entry
 * is still recorded in `dirs` (the scan can show the symlink exists) but
 * never descended into. A broken symlink, or any permission/race error, is
 * skipped for that one entry rather than thrown — this walk must never
 * crash on a hostile or half-broken working tree.
 * @param {string} root
 * @param {{ maxFiles?: number, maxDepth?: number }} [opts]
 * @returns {CollectResult}
 */
export function collectFiles(root, opts = {}) {
  const maxFiles = opts.maxFiles ?? 20000;
  const maxDepth = opts.maxDepth ?? 12;
  /** @type {CollectedFile[]} */
  const files = [];
  /** @type {Set<string>} */
  const dirs = new Set();
  let truncated = false;

  /** @type {{ abs: string, rel: string, depth: number }[]} */
  const stack = [{ abs: root, rel: "", depth: 0 }];
  /** Real paths of directories already descended into, keyed to break symlink cycles. @type {Set<string>} */
  const visitedDirs = new Set();
  /** Resolved real path of root, so a symlink can't walk the scan outside it. @type {string|null} */
  let rootReal = null;
  try {
    rootReal = fs.realpathSync(root);
    visitedDirs.add(rootReal);
  } catch {
    // root missing/unreadable — the readdirSync below fails the same way and yields an empty result
  }

  while (stack.length > 0) {
    const node = stack.pop();
    if (!node) break;
    if (node.depth > maxDepth) continue;
    let entries;
    try {
      entries = fs.readdirSync(node.abs, { withFileTypes: true });
    } catch {
      continue;
    }
    entries.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
    for (const e of entries) {
      const rel = node.rel ? `${node.rel}/${e.name}` : e.name;
      const abs = path.join(node.abs, e.name);
      let isDirectory = e.isDirectory();
      let isFile = e.isFile();
      /** @type {fs.Stats|null} Reused below for size, so a symlinked file is stat'd only once. */
      let symlinkStat = null;
      if (e.isSymbolicLink()) {
        try {
          symlinkStat = fs.statSync(abs); // follows the link; throws on a broken/dangling target
        } catch {
          continue; // broken symlink or unreadable target — skip, never throw
        }
        isDirectory = symlinkStat.isDirectory();
        isFile = symlinkStat.isFile();
      }
      if (isDirectory) {
        if (IGNORE_DIRS.has(e.name)) continue;
        if (e.name.endsWith(".egg-info")) continue;
        // Cycle + root-escape guard: resolve the real path once. A plain
        // (non-symlink) directory can never structurally resolve outside
        // root or collide with an earlier real path, so a realpath failure
        // here (rare TOCTOU race) just forfeits both guards for this one
        // entry rather than dropping a directory the walk could already
        // see — matching the non-symlink path's existing behavior exactly.
        // A symlink whose target can't be resolved is skipped outright
        // instead: there is no prior behavior to preserve for it (every
        // symlink was invisible before this fix), so failing closed costs
        // nothing.
        let real = null;
        try {
          real = fs.realpathSync(abs);
        } catch {
          if (e.isSymbolicLink()) continue;
        }
        let descend = true;
        if (real !== null) {
          if (visitedDirs.has(real)) continue;
          if (rootReal !== null && !isPathInside(rootReal, real)) {
            // Outside the scan root: record that the symlink exists, but
            // never pay to walk whatever it points at (see function doc).
            descend = false;
          } else {
            visitedDirs.add(real);
          }
        }
        dirs.add(rel);
        if (descend) stack.push({ abs, rel, depth: node.depth + 1 });
      } else if (isFile) {
        if (files.length >= maxFiles) {
          truncated = true;
          continue;
        }
        let size = 0;
        try {
          size = symlinkStat ? symlinkStat.size : fs.statSync(abs).size;
        } catch {
          size = 0;
        }
        const dot = e.name.lastIndexOf(".");
        const ext = dot > 0 ? e.name.slice(dot).toLowerCase() : "";
        files.push({ rel, ext, base: e.name, size });
      }
    }
  }

  files.sort((a, b) => (a.rel < b.rel ? -1 : a.rel > b.rel ? 1 : 0));
  return { files, dirs, truncated };
}
