#!/usr/bin/env node
/**
 * Stop hook: a non-blocking reminder. If the working tree has uncommitted
 * changes, surface a system message nudging a lint/test run. Never blocks.
 */
import { execFileSync } from "node:child_process";

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
