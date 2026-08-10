/**
 * Shared stdin/JSON parsing for hook scripts. Every hook should read its
 * event via `parseHookEvent(readStdinRaw())` instead of hand-rolling
 * `JSON.parse(readStdin() || "{}")` locally — that idiom does not guard
 * against a literal JSON `null` on stdin (valid JSON, parses without
 * throwing), which then crashes the first unguarded `event.x` property
 * access with an uncaught TypeError (exit 1, stack to stderr) instead of
 * failing open. `typeof event.x` does NOT protect against this either —
 * the property access happens before `typeof` sees the result. See
 * .claude/memory/hook-stdin-null-crash.md.
 *
 * Not a hook itself — a shared helper other hooks `import` by relative
 * path, same pattern as session-scratch.mjs. Deliberately dependency-free
 * (no vault/worktree/tool-specific imports) so every hook can use it
 * regardless of which pillar installed it.
 *
 * A copy of templates/hooks/hook-io.mjs, duplicated here (rather than
 * imported across directories) because graphify-orient.mjs deploys via a
 * single-file copy (lib/plan/vendored-artifacts.mjs), landing flat next to
 * this exact same file's deployed copy under templates/hooks/'s own
 * PROJECT_HOOK_FILES entry — both end up siblings in the target's
 * .claude/hooks/. This source-tree copy exists only so the relative import
 * resolves for local typecheck/test runs, which spawn graphify-orient.mjs
 * directly from its templates/tools/graphify/hooks/ source location (see
 * .claude/rules/scripts-cross-platform.md's vendored-tool-script-import-vs-tsc
 * precedent for the general pattern — this case additionally has a runtime
 * test that spawns the file, so unlike that precedent, excluding the
 * directory from tsconfig alone is not enough).
 *
 * @module hooks/hook-io
 */
import fs from "node:fs";

/**
 * Reads all of stdin as utf8, or "" if it can't be read (e.g. not connected
 * to a pipe). Never throws.
 * @returns {string}
 */
export function readStdinRaw() {
  try {
    return fs.readFileSync(0, "utf8");
  } catch {
    return "";
  }
}

/**
 * Parses a hook's stdin JSON, returning null for anything that isn't a
 * genuine object — including unparseable input AND the literal JSON value
 * `null` (valid JSON that parses without throwing, so `JSON.parse(x || "{}")`
 * alone does not catch it).
 * @param {string} raw
 * @returns {any | null}
 */
export function parseHookEvent(raw) {
  try {
    const event = JSON.parse(raw || "{}");
    return typeof event === "object" && event !== null ? event : null;
  } catch {
    return null;
  }
}
