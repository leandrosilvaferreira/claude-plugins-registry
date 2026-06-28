#!/usr/bin/env node
/**
 * PreToolUse hook (Read|Glob matcher): if the file/pattern being read is a
 * source file and graphify-out/graph.json exists, inject a reminder to use
 * graphify before raw-reading source files. Never blocks — always exits 0.
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

const ti = event?.tool_input ?? {};

// Combine all path-like fields, normalise to forward slashes, lower-case.
const s = [ti.file_path, ti.pattern, ti.path]
  .filter((v) => typeof v === "string")
  .join(" ")
  .toLowerCase()
  .replace(/\\/g, "/");

// Skip reads that are already inside graphify-out/ (no recursion).
if (s.includes("graphify-out/")) process.exit(0);

const SOURCE_EXTS = [
  ".py",
  ".js",
  ".ts",
  ".tsx",
  ".jsx",
  ".go",
  ".rs",
  ".java",
  ".rb",
  ".c",
  ".h",
  ".cpp",
  ".hpp",
  ".cc",
  ".cs",
  ".kt",
  ".swift",
  ".php",
  ".scala",
  ".lua",
  ".sh",
  ".md",
  ".rst",
  ".txt",
  ".mdx",
];
if (!SOURCE_EXTS.some((e) => s.includes(e))) process.exit(0);

const projectDir = process.env.CLAUDE_PROJECT_DIR ?? process.cwd();
if (!fs.existsSync(path.join(projectDir, "graphify-out", "graph.json"))) process.exit(0);

process.stdout.write(
  JSON.stringify({
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      additionalContext:
        "MANDATORY: graphify-out/graph.json exists. You MUST run graphify before reading source files. " +
        'Use: `graphify query "<question>"` (scoped subgraph), `graphify explain "<concept>"`, or `graphify path "<A>" "<B>"`. ' +
        "Only read raw files after graphify has oriented you, or to modify/debug specific lines. " +
        "This rule applies to subagents too — include it in every subagent prompt involving code exploration.",
    },
  }),
);
process.exit(0);
