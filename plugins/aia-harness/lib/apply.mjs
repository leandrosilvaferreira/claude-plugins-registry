/**
 * Apply a harness plan to disk. Safe by default: never overwrites an existing,
 * differing file unless `force` is set; updates `.gitignore` idempotently.
 *
 * @module apply
 */
import fs from "node:fs";
import path from "node:path";
import { readText, isDir } from "./util/fs.mjs";
import { detectAssetType, validateFrontmatter } from "./validate/frontmatter.mjs";

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

    // Normalize frontmatter for distributed .md assets before writing.
    // Errors are auto-fixed silently; warnings are a dev-time concern already
    // resolved in templates by scripts/normalize-frontmatter.mjs.
    if (a.relPath.endsWith(".md")) {
      // relPath in target project is like .claude/agents/foo.md — extract the
      // segment that detectAssetType understands (agents/, skills/, etc.)
      const segMatch = a.relPath.match(/\/(agents|skills|commands|rules)\//);
      if (segMatch) {
        const fakeRel = `x/${segMatch[1]}/${path.basename(a.relPath)}`;
        const type = detectAssetType(fakeRel);
        if (type) {
          const { valid, errors: fmErrors, normalized } = validateFrontmatter(content, type);
          if (!valid) {
            process.stderr.write(
              `[apply] frontmatter: ${a.relPath}: auto-fixed: ${fmErrors.join("; ")}\n`
            );
            content = normalized;
          }
        }
      }
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
