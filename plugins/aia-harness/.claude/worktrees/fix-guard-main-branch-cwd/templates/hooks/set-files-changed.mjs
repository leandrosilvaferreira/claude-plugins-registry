#!/usr/bin/env node
/**
 * PostToolUse hook (strict mode): record files Claude edits this session so the
 * strict Stop hook (verify-on-stop.mjs) only runs lint/typecheck when code
 * actually changed. Appends the edited path to a per-project session flag-file
 * under the OS temp dir. Never blocks: any failure exits 0.
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

const file = event?.tool_input?.file_path ?? event?.tool_input?.path;
if (!file || typeof file !== "string") process.exit(0);

const projectDir = process.env.CLAUDE_PROJECT_DIR ?? process.cwd();
const h = createHash("sha1").update(projectDir).digest("hex").slice(0, 12);
const flag = path.join(os.tmpdir(), `aia-harness-changed-${h}`);

try {
  fs.appendFileSync(flag, file + "\n");
} catch {
  // Tracking is best-effort; never block the edit.
}

process.exit(0);
