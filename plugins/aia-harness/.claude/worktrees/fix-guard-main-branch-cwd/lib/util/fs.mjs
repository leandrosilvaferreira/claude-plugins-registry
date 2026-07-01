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
 * Recursively collect files under root, skipping ignored directories.
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
      if (e.isDirectory()) {
        if (IGNORE_DIRS.has(e.name)) continue;
        if (e.name.endsWith(".egg-info")) continue;
        dirs.add(rel);
        stack.push({ abs: path.join(node.abs, e.name), rel, depth: node.depth + 1 });
      } else if (e.isFile()) {
        if (files.length >= maxFiles) {
          truncated = true;
          continue;
        }
        let size = 0;
        try {
          size = fs.statSync(path.join(node.abs, e.name)).size;
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
