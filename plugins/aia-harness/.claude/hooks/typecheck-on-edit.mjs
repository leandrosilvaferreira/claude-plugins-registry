#!/usr/bin/env node
/**
 * PostToolUse guard hook: runs `tsc --noEmit` when a .mjs source file is edited.
 * Exits 2 on type errors so Claude self-corrects before proceeding.
 * Skips files excluded from tsconfig (templates/ecc, templates/tools, fixtures).
 * Reads hook event JSON from stdin.
 */
import fs from "node:fs";
import path from "node:path";
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

const file = event?.tool_input?.file_path ?? event?.tool_input?.path;
if (!file || typeof file !== "string") process.exit(0);
if (path.extname(file).toLowerCase() !== ".mjs") process.exit(0);

const cwdArg = typeof event.cwd === "string" && event.cwd ? event.cwd : "";
const projectDir = cwdArg || process.env.CLAUDE_PROJECT_DIR || process.cwd();

const EXCLUDED = ["templates/ecc", "templates/tools", "tests/fixtures"];
const rel = path.relative(projectDir, file);
if (EXCLUDED.some((ex) => rel.startsWith(ex))) process.exit(0);

const tscBin = path.join(projectDir, "node_modules", "typescript", "bin", "tsc");
if (!fs.existsSync(tscBin)) process.exit(0);

try {
  execFileSync(process.execPath, [tscBin, "--noEmit"], {
    cwd: projectDir,
    stdio: "pipe",
    windowsHide: true,
  });
} catch (/** @type {any} */ err) {
  const output = (err.stdout?.toString() ?? "") + (err.stderr?.toString() ?? "");
  process.stderr.write(`typecheck-on-edit: type errors detected:\n${output}\n`);
  process.exit(2);
}

process.exit(0);
