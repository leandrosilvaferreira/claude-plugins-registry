#!/usr/bin/env node
/**
 * PostToolUse hook (strict mode): record files Claude edits this session so the
 * strict Stop hook (verify-on-stop.mjs) only runs lint/typecheck when code
 * actually changed. Appends the edited path to this session's scratch dir
 * (see session-scratch.mjs) — never a shared per-project file, so parallel
 * sessions/worktrees of the same project never mix each other's edited paths
 * (see .claude/rules/hooks-cwd-resolution.md). Never blocks: any failure exits 0.
 */
import fs from "node:fs";
import path from "node:path";
import { sessionScratchDir } from "./session-scratch.mjs";

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

const file = event?.tool_input?.file_path ?? event?.tool_input?.path;
if (!file || typeof file !== "string") process.exit(0);

const sessionId = typeof event.session_id === "string" ? event.session_id : "nosession";
const flag = path.join(sessionScratchDir(sessionId), "files-changed");

try {
  fs.appendFileSync(flag, file + "\n");
} catch {
  // Tracking is best-effort; never block the edit.
}

process.exit(0);
