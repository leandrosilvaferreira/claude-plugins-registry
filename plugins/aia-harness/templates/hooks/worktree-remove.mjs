#!/usr/bin/env node
/**
 * WorktreeRemove hook. Fires on worktree cleanup (session exit without
 * changes, explicit ExitWorktree "remove", etc).
 *
 * stdin (WorktreeRemoveHookInput, per the installed @anthropic-ai/claude-agent-sdk
 * sdk.d.ts): {hook_event_name:"WorktreeRemove", worktree_path: string, cwd, ...}.
 * NOTE the field is `worktree_path` (snake_case), not `path`.
 *
 * Deliberately does not delete the branch — only the worktree checkout.
 * Deleting a branch is a destructive, out-of-scope action (it may hold real
 * commits); that decision is left to the user/agent.
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";

/** @type {any} */
let event = {};
try {
  event = JSON.parse(fs.readFileSync(0, "utf8") || "{}");
} catch {
  process.exit(0);
}

const wtPath = typeof event.worktree_path === "string" ? event.worktree_path : "";
const cwd =
  typeof event.cwd === "string" && event.cwd
    ? event.cwd
    : process.env.CLAUDE_PROJECT_DIR || process.cwd();
if (!wtPath) process.exit(0);

try {
  execFileSync("git", ["worktree", "remove", "--force", wtPath], {
    cwd,
    stdio: "ignore",
    windowsHide: true,
  });
} catch {
  /* falls through to the rm below regardless */
}
try {
  fs.rmSync(wtPath, { recursive: true, force: true });
} catch {
  /* best-effort */
}
try {
  execFileSync("git", ["worktree", "prune"], { cwd, stdio: "ignore", windowsHide: true });
} catch {
  /* best-effort */
}
process.exit(0);
