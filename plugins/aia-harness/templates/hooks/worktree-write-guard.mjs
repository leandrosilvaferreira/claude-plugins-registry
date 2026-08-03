#!/usr/bin/env node
/**
 * Worktree write guard (PreToolUse / Write|Edit|MultiEdit). Fires before any
 * file write/edit.
 *
 * Reads `event.cwd` — Claude's dynamic current working directory. If the cwd
 * is inside a git worktree (`.claude/worktrees/<name>`) but the target file is
 * outside that worktree, returns permissionDecision:"ask" so the agent confirms
 * with the user before proceeding. This catches the common failure mode where a
 * long session causes the agent to forget it should operate inside the worktree
 * and accidentally writes absolute paths pointing to the project root.
 *
 * Uses `event.cwd` directly (no state files): Claude Code propagates the
 * dynamic cwd into every hook event, so detection is always current.
 *
 * No-op when cwd is the project root or any non-worktree path. Also no-op
 * for writes into Claude Code's own per-session scratchpad, which by design
 * lives outside every worktree.
 * Always exits 0 (never hard-blocks: "ask" lets the user decide).
 */
import fs from "node:fs";
import path from "node:path";

/** @returns {string} */
function readStdin() {
  try {
    return fs.readFileSync(0, "utf8");
  } catch {
    return "";
  }
}

/** @type {any} */
let event = {};
try {
  event = JSON.parse(readStdin() || "{}");
} catch {
  process.exit(0);
}

const cwd = typeof event.cwd === "string" ? event.cwd : "";
const projectDir = process.env.CLAUDE_PROJECT_DIR ?? process.cwd();

// Only active when cwd is inside a worktree.
const m = cwd.match(/^(.+?\.claude[/\\]worktrees[/\\][^/\\]+)/);
if (!m) process.exit(0);

const wtPath = path.resolve(m[1]);

const ti = event.tool_input ?? {};
const targetPath =
  typeof ti.file_path === "string" ? ti.file_path : typeof ti.path === "string" ? ti.path : "";

if (!targetPath) process.exit(0);

// Always resolve — never branch on path.isAbsolute(). On Windows, a POSIX-style
// path (e.g. "/Users/dev/proj/...", as used by cross-platform callers/tests) is
// already isAbsolute()===true (root-relative, no drive letter), so the old
// isAbsolute-guarded ternary skipped path.resolve() and left it un-normalized —
// no drive letter, forward slashes — while wtPath below always goes through
// path.resolve() (drive letter, backslashes). The two then never compared equal,
// misclassifying every file actually inside the worktree as outside it.
// path.resolve(cwd, targetPath) is a no-op for an already-resolved absolute path,
// so this is safe for the relative-path case too.
const absTarget = path.resolve(cwd, targetPath);

// Allow writes inside the worktree (or to the worktree root itself).
if (absTarget === wtPath || absTarget.startsWith(wtPath + path.sep)) process.exit(0);

// Claude Code's own per-session scratchpad
// (<tmp>/claude-*/<project-slug>/<session-id>/scratchpad/...) sits outside
// every worktree by design, so without this it always reads as a
// cross-tree write and asks — on every temp file. Matched structurally
// (claude-*/.../scratchpad), never a hardcoded temp root, so it holds on
// every platform. Same layout session-scratch.mjs's findClaudeScratchRoot()
// walks on disk — this guard stays regex-only (no fs access) since it runs
// on every write, but keep both in sync if that layout ever changes.
if (/[/\\]claude-[^/\\]+[/\\][^/\\]+[/\\][^/\\]+[/\\]scratchpad([/\\]|$)/.test(absTarget)) {
  process.exit(0);
}

// Display with forward slashes regardless of host OS: these are read by the
// agent/user as message text, not compared against a filesystem path, so a
// consistent "/" reads correctly everywhere instead of Windows' native "\".
const toDisplay = (/** @type {string} */ p) => p.split(path.sep).join("/");
const relTarget = toDisplay(path.relative(projectDir, absTarget));
const relWt = toDisplay(path.relative(projectDir, wtPath));
const wtDisplay = toDisplay(wtPath);

const reason = [
  `Target file "${relTarget}" is outside the active worktree "${relWt}".`,
  `Active worktree: ${wtDisplay}`,
  `Intended? If you meant to edit the worktree copy, use the path inside "${wtDisplay}".`,
].join("\n");

process.stdout.write(
  JSON.stringify({
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      permissionDecision: "ask",
      permissionDecisionReason: reason,
    },
  }),
);

process.exit(0);
