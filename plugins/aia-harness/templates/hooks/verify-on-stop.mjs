#!/usr/bin/env node
/**
 * Stop hook: a non-blocking reminder. If the working tree has uncommitted
 * changes, surface a system message nudging a lint/test run. Never blocks.
 */
import { execFileSync } from "node:child_process";
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
  // ignore
}

// Anti-loop guard: skip when already inside a stop-hook chain.
if (event?.stop_hook_active) process.exit(0);

const projectDir = process.env.CLAUDE_PROJECT_DIR ?? process.cwd();

let status = "";
try {
  status = execFileSync("git", ["status", "--porcelain"], { cwd: projectDir, encoding: "utf8" });
} catch {
  process.exit(0);
}

const changed = status.split("\n").filter((l) => l.trim().length > 0).length;
if (changed > 0) {
  const message = `aia-harness: ${changed} uncommitted change(s) — run lint & tests before wrapping up.`;
  process.stdout.write(JSON.stringify({ systemMessage: message }));
}

process.exit(0);
