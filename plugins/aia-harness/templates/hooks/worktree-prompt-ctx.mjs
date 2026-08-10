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
 * restarts the session, so SessionStart never re-fires. Deduped via a per-session
 * flag file (see session-scratch.mjs), keyed by worktree name, so the rename
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
import path from "node:path";
import { sessionScratchDir } from "./session-scratch.mjs";
import { parseHookEvent, readStdinRaw } from "./hook-io.mjs";

const event = parseHookEvent(readStdinRaw());
if (event === null) process.exit(0);

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

// Rename once per (session, worktree) — deduped via a per-session flag file
// (this session may visit multiple worktrees, so the row still needs the
// worktree name — but no longer a session prefix, since the file itself is
// already session-scoped) so it never re-fires on later prompts in the same
// worktree (and never clobbers a manual /rename after the first auto-rename).
const sessionId = typeof event.session_id === "string" ? event.session_id : "nosession";
const RENAMED_FLAG = path.join(sessionScratchDir(sessionId), "worktree-renamed");

let alreadyRenamed = false;
try {
  alreadyRenamed = fs.readFileSync(RENAMED_FLAG, "utf8").split(/\r?\n/).includes(wtName);
} catch {
  // No flag yet — first prompt in this worktree for this session.
}

if (!alreadyRenamed) {
  hookSpecificOutput.sessionTitle = wtName;
  try {
    fs.appendFileSync(RENAMED_FLAG, wtName + "\n");
  } catch {
    // Best-effort; a missed write only means the rename may fire once more.
  }
}

process.stdout.write(JSON.stringify({ hookSpecificOutput }));

process.exit(0);
