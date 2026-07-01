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
 * @property {{ id: string, relPath: string, category: string }[]} differs
 */

/**
 * Merge incoming settings.json hook arrays into existing settings.json content.
 * Pure function — no IO. All other fields from existing are preserved as-is.
 *
 * For each hook event key in incoming.hooks:
 *   - If absent in existing → added wholesale.
 *   - If present → matcher groups are unioned by matcher string; within each
 *     group, hooks[] entries are unioned by serialized {command, args} identity
 *     (other fields such as timeout are intentionally excluded; existing entry wins).
 *
 * @param {string} existingJson
 * @param {string} incomingJson
 * @returns {string} merged JSON string (2-space indent, trailing newline)
 */
export function mergeSettingsHooks(existingJson, incomingJson) {
  const existing = JSON.parse(existingJson);
  const incoming = JSON.parse(incomingJson);

  if (!incoming.hooks || typeof incoming.hooks !== "object" || Array.isArray(incoming.hooks)) {
    return existingJson;
  }

  const merged = { ...existing };
  if (!merged.hooks || typeof merged.hooks !== "object" || Array.isArray(merged.hooks)) {
    merged.hooks = {};
  }

  /**
   * Normalizes placeholder bracing for key computation ONLY — the stored
   * hook object (whichever one wins) is never rewritten by this function.
   * A bare $CLAUDE_PROJECT_DIR and a braced ${CLAUDE_PROJECT_DIR} refer to
   * the same hook; without this, a routine re-apply after a placeholder
   * fix would add a duplicate instead of recognizing the hook as already
   * present.
   * @param {unknown} v
   */
  const normalizePlaceholders = (v) =>
    typeof v === "string"
      ? v.replace(/\$(?!\{)(CLAUDE_PROJECT_DIR|CLAUDE_PLUGIN_ROOT|CLAUDE_PLUGIN_DATA)\b/g, "${$1}")
      : v;

  /** @param {{ command?: unknown, args?: unknown }} h */
  const hookKey = (h) =>
    JSON.stringify({
      command: normalizePlaceholders(h.command),
      args: Array.isArray(h.args) ? h.args.map(normalizePlaceholders) : h.args,
    });

  for (const [eventKey, incomingGroups] of Object.entries(incoming.hooks)) {
    if (!Array.isArray(incomingGroups)) continue;

    if (!Array.isArray(merged.hooks[eventKey])) {
      merged.hooks[eventKey] = incomingGroups;
      continue;
    }

    const existingGroups = merged.hooks[eventKey];
    const result = [...existingGroups];

    for (const inGroup of incomingGroups) {
      const matcherStr = inGroup.matcher ?? "";
      const exIdx = result.findIndex((g) => (g.matcher ?? "") === matcherStr);

      if (exIdx === -1) {
        result.push(inGroup);
        continue;
      }

      const exGroup = result[exIdx];
      const exHooks = Array.isArray(exGroup.hooks) ? exGroup.hooks : [];
      const inHooks = Array.isArray(inGroup.hooks) ? inGroup.hooks : [];

      const seen = new Set(exHooks.map(hookKey));
      const unioned = [...exHooks];
      for (const h of inHooks) {
        const key = hookKey(h);
        if (!seen.has(key)) {
          seen.add(key);
          unioned.push(h);
        }
      }

      result[exIdx] = { ...exGroup, hooks: unioned };
    }

    merged.hooks[eventKey] = result;
  }

  return JSON.stringify(merged, null, 2) + "\n";
}

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
  const result = { created: [], updated: [], skipped: [], errors: [], dryRun, differs: [] };

  for (const a of plan.artifacts) {
    if (selected ? !selected.has(a.id) : !a.defaultSelected) continue;

    const target = path.join(root, a.relPath);

    // Directory artifact (e.g. a vendored ECC skill or mirrored rule dir).
    if (a.content == null && a.copyFrom && isDir(a.copyFrom)) {
      const dirExists = fs.existsSync(target);
      // Existing dirs are left intact unless `force` — then refresh (rm + recopy)
      // so a vendored skill/hook dir can be upgraded by `/patch --force`.
      if (dirExists && !force) {
        result.skipped.push(`${a.relPath}/ (exists)`);
        continue;
      }
      if (!dryRun) {
        if (dirExists) fs.rmSync(target, { recursive: true, force: true });
        fs.cpSync(a.copyFrom, target, { recursive: true });
      }
      result[dirExists ? "updated" : "created"].push(`${a.relPath}/`);
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
              `[apply] frontmatter: ${a.relPath}: auto-fixed: ${fmErrors.join("; ")}\n`,
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
        if (a.mergeStrategy === "merge-hooks") {
          if (cur == null) {
            result.errors.push({
              path: a.relPath,
              error: "could not read existing file for merge",
            });
            continue;
          }
          try {
            content = mergeSettingsHooks(cur, content);
          } catch (e) {
            result.errors.push({
              path: a.relPath,
              error: `mergeSettingsHooks failed: ${e instanceof Error ? e.message : String(e)}`,
            });
            continue;
          }
          if (content === cur) {
            result.skipped.push(`${a.relPath} (identical after merge)`);
            continue;
          }
          // fall through to write
        } else {
          result.differs.push({ id: a.id, relPath: a.relPath, category: a.category });
          result.skipped.push(`${a.relPath} (exists, differs — left unchanged)`);
          continue;
        }
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
