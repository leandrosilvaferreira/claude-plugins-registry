#!/usr/bin/env node
/**
 * Worktree subagent context (SubagentStart). Fires before every subagent spawn.
 *
 * Reads `event.cwd` — the parent session's current working directory when the
 * subagent is spawned. If the cwd is inside a git worktree
 * (`.claude/worktrees/<name>`), injects additionalContext so the subagent knows
 * it must read/write files inside the worktree path, not the project root.
 *
 * Uses `event.cwd` directly (no state files needed): Claude Code propagates the
 * dynamic cwd into every hook event, so this hook is always current.
 *
 * No-op when cwd is the project root or any non-worktree path.
 * Always exits 0 (fail-open).
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
const projectDir = process.env.CLAUDE_PROJECT_DIR ?? "";

// Detect worktree: cwd must contain .claude/worktrees/<name>
const m = cwd.match(/^(.+?\.claude\/worktrees\/[^/]+)/);
if (!m) process.exit(0);

const wtPath = m[1];
const rel = projectDir ? path.relative(projectDir, wtPath) : path.basename(wtPath);

const additionalContext = [
  `WORKTREE ACTIVE: this session is working inside the git worktree at "${wtPath}" (relative: "${rel}").`,
  `All file reads, writes, and edits MUST target paths inside "${wtPath}".`,
  ...(projectDir ? [`The project root "${projectDir}" is READ-ONLY unless the task explicitly requires editing it.`] : []),
  `When spawning sub-tasks, pass this worktree path so they do not accidentally write to the project root.`,
].join("\n");

process.stdout.write(JSON.stringify({
  hookSpecificOutput: { hookEventName: "SubagentStart", additionalContext },
}));

process.exit(0);
