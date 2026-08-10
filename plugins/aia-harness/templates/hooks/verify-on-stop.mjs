#!/usr/bin/env node
/**
 * Stop hook: a non-blocking reminder. If the working tree has uncommitted
 * changes, surface a system message nudging a lint/test run. Never blocks.
 */
import { execFileSync } from "node:child_process";
import { parseHookEvent, readStdinRaw } from "./hook-io.mjs";

// Parse failure (malformed OR literal `null`) falls back to {} rather than
// exiting — this hook still runs its git-status check with the cwd fallback
// below even when it can't read a usable event (see .claude/memory/hook-stdin-null-crash.md).
const event = parseHookEvent(readStdinRaw()) ?? {};

// Anti-loop guard: skip when already inside a stop-hook chain.
if (event?.stop_hook_active) process.exit(0);

const cwdArg = typeof event.cwd === "string" && event.cwd ? event.cwd : "";
const projectDir = cwdArg || process.env.CLAUDE_PROJECT_DIR || process.cwd();

let status = "";
try {
  status = execFileSync("git", ["status", "--porcelain"], {
    cwd: projectDir,
    encoding: "utf8",
    windowsHide: true,
  });
} catch {
  process.exit(0);
}

const changed = status.split(/\r?\n/).filter((l) => l.trim().length > 0).length;
if (changed > 0) {
  const message = `aia-harness: ${changed} uncommitted change(s) — run lint & tests before wrapping up.`;
  process.stdout.write(JSON.stringify({ systemMessage: message }));
}

process.exit(0);
