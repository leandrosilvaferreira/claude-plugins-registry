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
 * No-op when cwd is the project root or any non-worktree path.
 * Always exits 0 (never hard-blocks: "ask" lets the user decide).
 */
import fs from "node:fs";
import path from "node:path";

/** @returns {string} */
function readStdin() {
  try { return fs.readFileSync(0, "utf8"); } catch { return ""; }
}

/** @type {any} */
let event = {};
try { event = JSON.parse(readStdin() || "{}"); } catch { process.exit(0); }

const cwd = typeof event.cwd === "string" ? event.cwd : "";
const projectDir = process.env.CLAUDE_PROJECT_DIR ?? process.cwd();

// Only active when cwd is inside a worktree.
const m = cwd.match(/^(.+?\.claude[/\\]worktrees[/\\][^/\\]+)/);
if (!m) process.exit(0);

const wtPath = path.resolve(m[1]);

const ti = event.tool_input ?? {};
const targetPath = typeof ti.file_path === "string" ? ti.file_path
  : typeof ti.path === "string" ? ti.path
  : "";

if (!targetPath) process.exit(0);

const absTarget = path.isAbsolute(targetPath) ? targetPath : path.resolve(cwd, targetPath);

// Allow writes inside the worktree (or to the worktree root itself).
if (absTarget === wtPath || absTarget.startsWith(wtPath + path.sep)) process.exit(0);

const relTarget = path.relative(projectDir, absTarget);
const relWt = path.relative(projectDir, wtPath);

const reason = [
  `Target file "${relTarget}" is outside the active worktree "${relWt}".`,
  `Active worktree: ${wtPath}`,
  `Intended? If you meant to edit the worktree copy, use the path inside "${wtPath}".`,
].join("\n");

process.stdout.write(JSON.stringify({
  hookSpecificOutput: {
    hookEventName: "PreToolUse",
    permissionDecision: "ask",
    permissionDecisionReason: reason,
  },
}));

process.exit(0);
