/**
 * Resolves Claude Code's own per-session scratchpad directory — the one
 * location a hook can write to without triggering a permission prompt, and
 * whose path is inherently unique per session (so parallel sessions/worktrees
 * of the same project never share state through it). See
 * .claude/rules/hooks-cwd-resolution.md for why per-project hashing (the
 * pattern this module replaces) collides across parallel sessions.
 *
 * Not a hook itself — a shared helper other hooks `import` by relative path.
 * Ships alongside them in .claude/hooks/ via PROJECT_HOOK_FILES.
 *
 * @module hooks/session-scratch
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const NAMESPACE = "aia-harness";

/**
 * Safely read a directory's entries, returning an empty array on any error
 * (permission denied, nonexistent path, etc.) instead of throwing.
 * @param {string} dir
 * @returns {fs.Dirent[]}
 */
function safeReaddir(dir) {
  try {
    return fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return [];
  }
}

/**
 * Candidate roots to search for Claude Code's own `claude-*` scratch
 * directory. os.tmpdir() covers Linux/Windows (where it IS the real temp
 * root); "/tmp" covers macOS, where os.tmpdir() returns a per-user
 * /var/folders/... path that is NOT where Claude Code puts its scratchpad —
 * confirmed empirically: on macOS the real root lives under /private/tmp,
 * and "/tmp" is a symlink to it, so Node's fs calls resolve it transparently
 * without hardcoding the /private/tmp literal.
 * @returns {string[]}
 */
function defaultRoots() {
  return [os.tmpdir(), "/tmp"];
}

/**
 * @param {string} [sessionId]  From event.session_id. Falls back to a fixed
 *   key when absent/empty so callers always get a valid, existing directory.
 * @param {string[]} [roots]  Candidate search roots — override only in tests.
 * @returns {string} absolute path to this harness's scratch dir for the
 *   session — created if it doesn't exist yet.
 */
export function sessionScratchDir(sessionId, roots) {
  const searchRoots = roots ?? defaultRoots();
  const raw = typeof sessionId === "string" && sessionId.trim() ? sessionId.trim() : "nosession";
  const sid = raw.replace(/[^a-zA-Z0-9_-]/g, "_");
  const found = findClaudeScratchRoot(sid, searchRoots);
  const dir = found ?? fallbackRoot(sid);
  try {
    fs.mkdirSync(dir, { recursive: true });
  } catch {
    // Best-effort; a caller's own read/write will fail-open on a missing directory.
  }
  return dir;
}

/**
 * Searches each candidate root for a `claude-*` directory holding
 * `<anything>/<sessionId>/scratchpad` — Claude Code's own per-session scratch
 * root. Returns null wherever no matching layout is found (older Claude
 * Code, unrecognized platform), leaving the caller to use the fallback.
 * @param {string} sid
 * @param {string[]} roots
 * @returns {string|null} the harness's namespaced subdir inside the real
 *   scratchpad, or null if nothing matched.
 */
function findClaudeScratchRoot(sid, roots) {
  const seen = new Set();
  for (const base of roots) {
    if (!base || seen.has(base)) continue;
    seen.add(base);

    const entries = safeReaddir(base);
    for (const entry of entries) {
      if (!entry.isDirectory() || !entry.name.startsWith("claude-")) continue;
      const claudeDir = path.join(base, entry.name);
      const projectSlugs = safeReaddir(claudeDir);
      for (const slugEntry of projectSlugs) {
        if (!slugEntry.isDirectory()) continue;
        const scratchpad = path.join(claudeDir, slugEntry.name, sid, "scratchpad");
        if (isDirectory(scratchpad)) return path.join(scratchpad, NAMESPACE);
      }
    }
  }
  return null;
}

/** @param {string} p @returns {boolean} */
function isDirectory(p) {
  try {
    return fs.statSync(p).isDirectory();
  } catch {
    return false;
  }
}

/**
 * Used only when the real scratchpad can't be located (unrecognized Claude
 * Code version/platform). Still keyed by session id alone — never by a
 * project-dir hash — so this fallback still avoids cross-session/cross-
 * worktree collisions even though it may not be permission-prompt-free.
 * @param {string} sid  Already sanitized by the caller.
 * @returns {string}
 */
function fallbackRoot(sid) {
  return path.join(os.tmpdir(), `${NAMESPACE}-session`, sid);
}
