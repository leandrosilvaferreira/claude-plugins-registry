/**
 * Detect exec-form Claude Code hooks whose `args` reference a bare
 * (unbraced) path placeholder. Exec-form hooks (an `args` array present)
 * spawn without a shell, so Claude Code only substitutes the braced
 * `${VAR}` form into `args` elements — a bare `$VAR` is passed through
 * literally and `node` throws MODULE_NOT_FOUND resolving it as a relative
 * path. (Bare form IS fine in shell-form hooks — a single `command` string
 * with no `args` — since that runs through a real shell, and bash expands
 * `$VAR`/`${VAR}` identically. This module only looks at `args`.)
 * @module detect/hook-hygiene
 */
import path from "node:path";
import { readText } from "../util/fs.mjs";

const PLACEHOLDER_RE = /\$(?!\{)(CLAUDE_PROJECT_DIR|CLAUDE_PLUGIN_ROOT|CLAUDE_PLUGIN_DATA)\b/;

/**
 * Pure: no I/O. Walks an already-parsed settings.json object for exec-form
 * hook `args` entries using a bare path placeholder.
 * @param {unknown} settingsJson
 * @returns {import('../profile.mjs').HookPlaceholderIssue[]}
 */
export function detectHookPlaceholderIssues(settingsJson) {
  /** @type {import('../profile.mjs').HookPlaceholderIssue[]} */
  const issues = [];
  if (!settingsJson || typeof settingsJson !== "object") return issues;
  const hooks = /** @type {{ hooks?: unknown }} */ (settingsJson).hooks;
  if (!hooks || typeof hooks !== "object" || Array.isArray(hooks)) return issues;

  for (const [event, groups] of Object.entries(hooks)) {
    if (!Array.isArray(groups)) continue;
    for (const group of groups) {
      const g = /** @type {{ matcher?: unknown, hooks?: unknown }} */ (group ?? {});
      const matcher = typeof g.matcher === "string" ? g.matcher : "";
      const hookList = Array.isArray(g.hooks) ? g.hooks : [];
      for (const hook of hookList) {
        const h = /** @type {{ args?: unknown }} */ (hook ?? {});
        const args = Array.isArray(h.args) ? h.args : [];
        for (const arg of args) {
          if (typeof arg !== "string") continue;
          const m = arg.match(PLACEHOLDER_RE);
          if (m) {
            issues.push({
              event,
              matcher,
              script: arg.split("/").pop() ?? arg,
              arg,
              placeholder:
                /** @type {"CLAUDE_PROJECT_DIR"|"CLAUDE_PLUGIN_ROOT"|"CLAUDE_PLUGIN_DATA"} */ (
                  m[1]
                ),
            });
          }
        }
      }
    }
  }
  return issues;
}

/**
 * Reads and parses the target project's `.claude/settings.json` (if
 * present) and runs the pure detector above. Fail-open on every I/O or
 * parse error, matching this codebase's existing posture for optional
 * config inspection (e.g. `validate-settings-schema.mjs`).
 * @param {string} root            Absolute project root.
 * @param {boolean} hasSettings    `profile.existingHarness.settings` — avoids a redundant stat.
 * @returns {import('../profile.mjs').HookHygieneInfo}
 */
export function detectHookHygiene(root, hasSettings) {
  if (!hasSettings) return { placeholderIssues: [] };
  const text = readText(path.join(root, ".claude", "settings.json"));
  if (!text) return { placeholderIssues: [] };
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { placeholderIssues: [] };
  }
  return { placeholderIssues: detectHookPlaceholderIssues(parsed) };
}
