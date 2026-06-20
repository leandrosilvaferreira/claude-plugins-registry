/**
 * Apply a harness plan to disk. Safe by default: never overwrites an existing,
 * differing file unless `force` is set; updates `.gitignore` idempotently.
 *
 * @module apply
 */
import fs from "node:fs";
import path from "node:path";
import { readText, isDir } from "./util/fs.mjs";

/**
 * @typedef {Object} ApplyResult
 * @property {string[]} created
 * @property {string[]} updated
 * @property {string[]} skipped
 * @property {{ path: string, error: string }[]} errors
 * @property {boolean} dryRun
 */

const GITIGNORE_HEADER = "# aia-harness";

/**
 * @param {string} root
 * @param {string[]} entries
 * @param {boolean} dryRun
 * @returns {boolean} whether the gitignore was (or would be) changed
 */
function ensureGitignore(root, entries, dryRun) {
  const file = path.join(root, ".gitignore");
  const current = readText(file) ?? "";
  const lines = new Set(current.split(/\r?\n/).map((l) => l.trim()));
  const missing = entries.filter((e) => !lines.has(e));
  if (missing.length === 0) return false;
  if (!dryRun) {
    const addition = `${current && !current.endsWith("\n") ? "\n" : ""}${GITIGNORE_HEADER}\n${missing.join("\n")}\n`;
    fs.appendFileSync(file, addition);
  }
  return true;
}

/**
 * @param {import('./plan.mjs').HarnessPlan} plan
 * @param {string} root
 * @param {{ selected?: Set<string>, dryRun?: boolean, force?: boolean }} [opts]
 * @returns {ApplyResult}
 */
export function applyPlan(plan, root, opts = {}) {
  const dryRun = opts.dryRun ?? false;
  const force = opts.force ?? false;
  const selected = opts.selected;

  /** @type {ApplyResult} */
  const result = { created: [], updated: [], skipped: [], errors: [], dryRun };

  for (const a of plan.artifacts) {
    if (selected ? !selected.has(a.id) : !a.defaultSelected) continue;

    const target = path.join(root, a.relPath);

    // Directory artifact (e.g. a vendored ECC skill or mirrored rule dir).
    if (a.content == null && a.copyFrom && isDir(a.copyFrom)) {
      if (fs.existsSync(target)) {
        result.skipped.push(`${a.relPath}/ (exists)`);
        continue;
      }
      if (!dryRun) fs.cpSync(a.copyFrom, target, { recursive: true });
      result.created.push(`${a.relPath}/`);
      continue;
    }

    let content = a.content;
    if (content == null && a.copyFrom) content = readText(a.copyFrom);
    if (content == null) {
      result.errors.push({ path: a.relPath, error: "no inline content and source file missing" });
      continue;
    }

    if (fs.existsSync(target)) {
      const cur = readText(target);
      if (cur === content) {
        result.skipped.push(`${a.relPath} (identical)`);
        continue;
      }
      if (!force) {
        result.skipped.push(`${a.relPath} (exists, differs — left unchanged)`);
        continue;
      }
      if (!dryRun) writeFile(target, content, a.executable);
      result.updated.push(a.relPath);
      continue;
    }

    if (!dryRun) writeFile(target, content, a.executable);
    result.created.push(a.relPath);
  }

  ensureGitignore(root, plan.gitignore, dryRun);
  return result;
}

/**
 * @param {string} target
 * @param {string} content
 * @param {boolean} executable
 */
function writeFile(target, content, executable) {
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, content);
  if (executable) fs.chmodSync(target, 0o755);
}
