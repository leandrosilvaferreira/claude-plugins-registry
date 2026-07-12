#!/usr/bin/env node
/**
 * PreToolUse orientation guard for graphify. When a knowledge graph exists
 * (`graphify-out/graph.json`), inject a reminder to query the graph before
 * grepping the codebase (Bash search tools) or reading source files
 * (Read/Glob). Pure context injection — emits `additionalContext` only, never a
 * permission decision, so it never blocks or auto-approves a tool.
 *
 * When no graph exists yet, kick off a one-time background `graphify .` build
 * (detached, non-blocking — same spawn pattern as
 * templates/tools/graphify/git-hooks/post-commit) so a later tool call finds
 * the graph ready, then stay inert for this one.
 *
 * Cross-platform: plain Node (no `python3`, no POSIX shell), wired exec-form
 * (`node <path>`) like every other harness hook, so it runs identically on
 * Linux, macOS, and Windows. Replaces the `sh -c "... python3 ..."` inline
 * hooks `graphify install --project` would register.
 *
 * Wire in .claude/settings.json under PreToolUse with matcher "Bash|Read|Glob".
 * Non-invasive: fails open on any I/O or parse error (exit 0, no output).
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";

/** @returns {string} */
function readStdin() {
  try {
    return fs.readFileSync(0, "utf8");
  } catch {
    return "";
  }
}

/**
 * Fire-and-forget `graphify .` to build the graph for the first time.
 * `graphifyOutDir` doubles as an atomic lock — `mkdirSync` throws if it
 * already exists — so a burst of parallel tool calls can't launch duplicate
 * concurrent builds. Detached + unref so this hook never waits on it; errors
 * (e.g. graphify not on PATH) are swallowed, same pattern as
 * templates/tools/graphify/git-hooks/post-commit's background update.
 * @param {string} cwd
 * @param {string} graphifyOutDir
 */
function spawnGraphifyBuild(cwd, graphifyOutDir) {
  try {
    fs.mkdirSync(graphifyOutDir);
  } catch {
    return; // a build already claimed this dir (in progress or done)
  }
  try {
    // Prepend $HOME/.local/bin so uv-installed graphify is found in non-interactive shells
    const uvBin = path.join(os.homedir(), ".local", "bin");
    const child = spawn("graphify", ["."], {
      cwd,
      detached: true,
      stdio: "ignore",
      windowsHide: true,
      env: {
        ...process.env,
        PYTHONHASHSEED: "0",
        PATH: `${uvBin}${process.platform === "win32" ? ";" : ":"}${process.env.PATH || ""}`,
      },
    });
    child.on("error", () => {}); // silently skip if graphify not on PATH
    child.unref();
  } catch {
    // never block orientation on hook plumbing failures
  }
}

/** @type {any} */
let event = {};
try {
  event = JSON.parse(readStdin() || "{}");
} catch {
  process.exit(0);
}

const cwdArg = typeof event.cwd === "string" && event.cwd ? event.cwd : "";
const projectDir = cwdArg || process.env.CLAUDE_PROJECT_DIR || process.cwd();
const graphifyOutDir = path.join(projectDir, "graphify-out");

// Inert until a graph exists — same gate as graphify's own hooks. Kick off a
// background build first so a later tool call finds the graph ready.
if (!fs.existsSync(path.join(graphifyOutDir, "graph.json"))) {
  spawnGraphifyBuild(projectDir, graphifyOutDir);
  process.exit(0);
}

const tool = /** @type {string} */ (event?.tool_name ?? "");
const input = event?.tool_input ?? {};

// Search-tool detection for Bash, mirroring graphify's glob set
// (*grep*|*rg |*ripgrep*|*find |*fd |*ack |*ag ).
const SEARCH = /grep|ripgrep|rg |find |fd |ack |ag /;

// Source-file extensions for Read/Glob, mirroring graphify's hook plus .mjs/.cjs
// (graphify's own list omits them, but ESM/CJS files are source — and this
// engine is entirely .mjs, so without them the guard would never fire here).
const SOURCE_EXTS = [
  ".py",
  ".js",
  ".mjs",
  ".cjs",
  ".ts",
  ".tsx",
  ".jsx",
  ".astro",
  ".vue",
  ".svelte",
  ".go",
  ".rs",
  ".java",
  ".rb",
  ".cpp",
  ".hpp",
  ".cc",
  ".cs",
  ".c",
  ".h",
  ".kt",
  ".swift",
  ".php",
  ".scala",
  ".lua",
  ".sh",
  ".md",
  ".mdx",
  ".rst",
  ".txt",
];

// Match an extension only at a real suffix boundary, not mid-word: the negative
// lookahead stops ".h" matching "index.html" and ".c" matching "data.csv".
// Longer extensions precede their prefixes in SOURCE_EXTS so the alternation
// prefers e.g. ".mdx" over ".md" and ".cpp" over ".c".
const SOURCE_EXT_RE = new RegExp(
  "\\.(" + SOURCE_EXTS.map((e) => e.slice(1)).join("|") + ")(?![a-z0-9])",
);

const BASH_CONTEXT =
  'MANDATORY: graphify-out/graph.json exists. You MUST run `graphify query "<question>"` ' +
  "before grepping raw files. Only grep after graphify has oriented you, or to modify/debug " +
  "specific lines.";

const READ_CONTEXT =
  "MANDATORY: graphify-out/graph.json exists. You MUST run graphify before reading source " +
  'files. Use: `graphify query "<question>"` (scoped subgraph), `graphify explain "<concept>"`, ' +
  'or `graphify path "<A>" "<B>"`. Only read raw files after graphify has oriented you, or to ' +
  "modify/debug specific lines. This rule applies to subagents too — include it in every " +
  "subagent prompt involving code exploration.";

/** @returns {string|null} additionalContext to inject, or null to stay silent. */
function orientation() {
  if (tool === "Bash") {
    const command = String(input.command ?? "");
    return SEARCH.test(command) ? BASH_CONTEXT : null;
  }
  if (tool === "Read" || tool === "Glob") {
    const haystack = `${input.file_path ?? ""} ${input.pattern ?? ""} ${input.path ?? ""}`
      .toLowerCase()
      .replace(/\\/g, "/");
    // Skip reads of graphify's own output to avoid self-triggering.
    if (haystack.includes("graphify-out/")) return null;
    return SOURCE_EXT_RE.test(haystack) ? READ_CONTEXT : null;
  }
  return null;
}

const additionalContext = orientation();
if (additionalContext) {
  process.stdout.write(
    JSON.stringify({
      hookSpecificOutput: { hookEventName: "PreToolUse", additionalContext },
    }),
  );
}

process.exit(0);
