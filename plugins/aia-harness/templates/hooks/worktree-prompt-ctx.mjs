#!/usr/bin/env node
/**
 * Worktree prompt context (UserPromptSubmit). Fires on every user prompt.
 *
 * Handles post-compaction recovery: after context compaction, the model can
 * forget it is inside a worktree and write to the project root instead.
 * This hook reinjects a compact worktree reminder on every prompt so the
 * model never loses track of which path to write to.
 *
 * Also renames the session to the worktree's name (hookSpecificOutput.sessionTitle)
 * once per (session, worktree) pair. This is the only hook event that can catch
 * entering a worktree mid-session via the EnterWorktree tool: that path never
 * restarts the session, so SessionStart never re-fires. Deduped via a per-project
 * flag file in the OS temp dir (keyed by session_id + worktree name) so the rename
 * fires exactly once even though this hook runs on every prompt — it never
 * re-fires for the same session+worktree, so a later manual /rename is never
 * clobbered.
 *
 * Reads `event.cwd` — the session's current working directory at prompt time.
 * If the cwd is inside a git worktree (`.claude/worktrees/<name>`), injects
 * a compact additionalContext reminder and (once) the sessionTitle.
 *
 * No-op (no additionalContext, no sessionTitle, no state written) when cwd is
 * the project root or any non-worktree path.
 * Always exits 0 (fail-open).
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";

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

// Detect worktree: cwd must contain .claude/worktrees/<name>. Group 2 isolates
// just the name — a plain path.basename(wtPath) would mis-parse a Windows-style
// path ("C:\...\worktrees\name") when this hook runs on a POSIX host, since
// Node's path module picks basename semantics from the host OS, not the string.
const m = cwd.match(/^(.+?\.claude[/\\]worktrees[/\\]([^/\\]+))/);
if (!m) process.exit(0);

const wtPath = m[1];
const wtName = m[2];

const additionalContext = `WORKTREE: ${wtPath}. All edits must target this path, not the project root.`;

/** @type {any} */
const hookSpecificOutput = { hookEventName: "UserPromptSubmit", additionalContext };

// Rename once per (session, worktree) — deduped via a per-project flag file so
// it never re-fires on later prompts in the same worktree (and never clobbers
// a manual /rename after the first auto-rename).
const projectDir = process.env.CLAUDE_PROJECT_DIR ?? process.cwd();
const projHash = createHash("sha1").update(projectDir).digest("hex").slice(0, 12);
const RENAMED_FLAG = path.join(os.tmpdir(), `aia-harness-worktree-renamed-${projHash}`);
const sessionId = typeof event.session_id === "string" ? event.session_id : "nosession";
const renameKey = `${sessionId}\t${wtName}`;

let alreadyRenamed = false;
try {
  alreadyRenamed = fs.readFileSync(RENAMED_FLAG, "utf8").split(/\r?\n/).includes(renameKey);
} catch {
  // No flag yet — first prompt in this worktree for this session.
}

if (!alreadyRenamed) {
  hookSpecificOutput.sessionTitle = wtName;
  try {
    fs.appendFileSync(RENAMED_FLAG, renameKey + "\n");
  } catch {
    // Best-effort; a missed write only means the rename may fire once more.
  }
}

process.stdout.write(JSON.stringify({ hookSpecificOutput }));

process.exit(0);
