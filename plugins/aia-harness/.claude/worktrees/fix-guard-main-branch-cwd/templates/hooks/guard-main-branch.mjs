#!/usr/bin/env node
/**
 * PreToolUse guard: intercepts `git commit` and `git push` when the current
 * branch (or explicit push target) is `main` or `master`, then asks the user
 * for confirmation via the permission dialog before allowing the operation.
 *
 * Wire in .claude/settings.json under PreToolUse with matcher "Bash".
 * Non-invasive: fails open on any I/O or parse error (exit 0).
 */
import fs from "node:fs";
import { execFileSync } from "node:child_process";

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

const command = /** @type {string} */ (event?.tool_input?.command ?? "");

const isCommit = /\bgit\s+commit\b/.test(command);
const isPush = /\bgit\s+push\b/.test(command);

if (!isCommit && !isPush) process.exit(0);

/** @returns {string} */
function currentBranch() {
  // event.cwd reflects the session's actual active directory (tracks EnterWorktree);
  // $CLAUDE_PROJECT_DIR stays pinned to the original repo root for the whole session,
  // so preferring it here would check the wrong checkout's branch when the session
  // has switched into a git worktree.
  const dir = event?.cwd || process.env.CLAUDE_PROJECT_DIR || process.cwd();
  try {
    return execFileSync("git", ["branch", "--show-current"], {
      cwd: dir,
      encoding: "utf8",
      timeout: 5000,
      windowsHide: true,
    }).trim();
  } catch {
    return "";
  }
}

const MAIN_BRANCHES = /^(main|master)$/;

const branch = currentBranch();
const onMain = MAIN_BRANCHES.test(branch);

// For push, also guard when the command explicitly names main/master as target.
const pushTargetsMain = isPush && /\b(main|master)\b/.test(command);

if (!onMain && !pushTargetsMain) process.exit(0);

const verb = isCommit ? "commit" : "push";
const target = branch || (command.match(/\b(main|master)\b/)?.[0] ?? "main");

const permissionDecisionReason = [
  `guard-main-branch: blocked direct ${verb} to \`${target}\`.`,
  "Direct commits/pushes to the main branch bypass code review and CI gates.",
  "Create a feature branch instead:",
  "  git checkout -b feat/your-feature-name",
  "Then open a PR to merge into main.",
].join("\n");

process.stdout.write(
  JSON.stringify({
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      permissionDecision: "deny",
      permissionDecisionReason,
    },
  }),
);

process.exit(0);
