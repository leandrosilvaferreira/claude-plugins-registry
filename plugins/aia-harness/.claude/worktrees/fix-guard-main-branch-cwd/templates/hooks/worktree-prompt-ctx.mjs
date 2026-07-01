#!/usr/bin/env node
/**
 * Worktree prompt context (UserPromptSubmit). Fires on every user prompt.
 *
 * Handles post-compaction recovery: after context compaction, the model can
 * forget it is inside a worktree and write to the project root instead.
 * This hook reinjects a compact worktree reminder on every prompt so the
 * model never loses track of which path to write to.
 *
 * Reads `event.cwd` — the session's current working directory at prompt time.
 * If the cwd is inside a git worktree (`.claude/worktrees/<name>`), injects
 * a compact additionalContext reminder.
 *
 * No-op when cwd is the project root or any non-worktree path.
 * Always exits 0 (fail-open).
 */
import fs from "node:fs";

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

// Detect worktree: cwd must contain .claude/worktrees/<name>
const m = cwd.match(/^(.+?\.claude[/\\]worktrees[/\\][^/\\]+)/);
if (!m) process.exit(0);

const wtPath = m[1];

const additionalContext = `WORKTREE: ${wtPath}. All edits must target this path, not the project root.`;

process.stdout.write(
  JSON.stringify({
    hookSpecificOutput: { hookEventName: "UserPromptSubmit", additionalContext },
  }),
);

process.exit(0);
