#!/usr/bin/env node
/**
 * PreToolUse hook (Bash matcher): if the command contains a grep/find/rg/fd/ag
 * pattern and graphify-out/graph.json exists, inject a reminder to use graphify
 * before raw-grepping. Never blocks — always exits 0.
 */
import fs from "node:fs";
import path from "node:path";

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

const command = String(event?.tool_input?.command ?? "");

// Match the same patterns the original shell hook matched.
if (!/\b(grep|rg[ \t]|ripgrep|find[ \t]|fd[ \t]|ack[ \t]|ag[ \t])/.test(command)) {
  process.exit(0);
}

const projectDir = process.env.CLAUDE_PROJECT_DIR ?? process.cwd();
if (!fs.existsSync(path.join(projectDir, "graphify-out", "graph.json"))) process.exit(0);

process.stdout.write(
  JSON.stringify({
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      additionalContext:
        'MANDATORY: graphify-out/graph.json exists. You MUST run `graphify query "<question>"` before grepping raw files. Only grep after graphify has oriented you, or to modify/debug specific lines.',
    },
  }),
);
process.exit(0);
