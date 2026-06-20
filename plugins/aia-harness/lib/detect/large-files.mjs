/**
 * Large-source-file detection — counts pre-existing source files that already
 * exceed the per-file line budget (350). Drives the recommended large-file
 * guard mode: a clean repo is born strict (`block`, the agent refactors before
 * finishing); a legacy repo with big files gets `advisory` (suggest + confirm,
 * never auto-block).
 *
 * Reads only plausibly-large candidates: collectFiles already recorded each
 * file's byte size, so we skip anything too small to hold 350 lines before
 * touching the disk. The source-file predicate intentionally mirrors
 * templates/hooks/large-file-warning.mjs so this recommendation agrees with what
 * the runtime hook will actually flag — keep the two in sync.
 *
 * @module detect/large-files
 */
import path from "node:path";
import { readText } from "../util/fs.mjs";

/** @typedef {import('../profile.mjs').LargeFilesInfo} LargeFilesInfo */
/** @typedef {{ rel: string, ext: string, base: string, size: number }} FileEntry */

/** Per-file line budget — must match the hook's MAX_LINES. */
const MAX_LINES = 350;

/**
 * Skip files too small to plausibly hold MAX_LINES of real code before reading
 * them (≈6 bytes/line floor). A conservative under-count only ever biases the
 * recommendation toward `block`, which the user can still override at init.
 */
const MIN_BYTES = 2000;

/** Source extensions worth a line budget — mirrors the hook's SOURCE_EXTS. */
const SOURCE_EXTS = new Set([
  ".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".mts", ".cts",
  ".py", ".java", ".kt", ".kts",
  ".go", ".rb", ".php",
  ".swift", ".rs", ".cs", ".dart",
  ".ex", ".exs", ".vue", ".svelte",
]);

/**
 * Generated / vendored / non-logic directory segments — mirrors the hook's
 * IGNORED_DIRS. collectFiles already drops the build-output ones; these are the
 * extras (fixtures, locales, generated, …) the hook also refuses to flag.
 */
const IGNORED_DIRS = new Set([
  "node_modules", "build", "dist", "target", ".next", "out",
  "__pycache__", ".gradle", "vendor", "coverage", ".git",
  ".build", "DerivedData", "Pods", ".cache", "tmp", ".tmp",
  "generated", "gen", "__generated__", "migrations", "migration",
  "fixtures", "mocks", "__mocks__", "stubs",
  "lang", "i18n", "locales", "assets", "static", "public",
]);

/**
 * True when a relative path is a real source/business file worth a line budget.
 * Mirrors isSourceFile() in templates/hooks/large-file-warning.mjs.
 * @param {string} rel  POSIX path relative to root.
 * @param {string} ext  Lowercase extension incl. dot.
 * @param {string} base Basename.
 * @returns {boolean}
 */
function isSourceFile(rel, ext, base) {
  if (!SOURCE_EXTS.has(ext)) return false;
  if (base.endsWith(".d.ts")) return false;

  const parts = rel.split("/");
  for (const seg of parts.slice(0, -1)) {
    if (IGNORED_DIRS.has(seg)) return false;
  }

  // Test / story / config files — not primary logic.
  if (/\.(test|spec|stories|config|conf)\.[^.]+$/.test(base)) return false;
  // Pure type / constant / barrel re-export files.
  if (/^(index|types?|interfaces?|constants?|dtos?|enums?|vo)\.[^.]+$/.test(base)) return false;

  return true;
}

/**
 * Detect pre-existing oversized source files from an already-collected file
 * list, reading only byte-size candidates.
 *
 * @param {string} root          Absolute project root.
 * @param {FileEntry[]} files    Files from collectFiles (rel is POSIX).
 * @returns {LargeFilesInfo}
 */
export function detectLargeFiles(root, files) {
  /** @type {{ file: string, lines: number }[]} */
  const oversized = [];

  for (const f of files) {
    if (f.size < MIN_BYTES) continue;
    if (!isSourceFile(f.rel, f.ext, f.base)) continue;
    const text = readText(path.join(root, f.rel));
    if (text == null) continue;
    const lines = text.split("\n").length;
    if (lines > MAX_LINES) oversized.push({ file: f.rel, lines });
  }

  oversized.sort((a, b) => b.lines - a.lines);

  return {
    threshold: MAX_LINES,
    count: oversized.length,
    recommended: oversized.length === 0 ? "block" : "advisory",
    sample: oversized.slice(0, 5),
  };
}
