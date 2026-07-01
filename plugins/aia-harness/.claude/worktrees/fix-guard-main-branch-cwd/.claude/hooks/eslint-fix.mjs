#!/usr/bin/env node
/**
 * PostToolUse hook (this repo's own dev harness): run `eslint --fix` on the
 * `.mjs` file Claude just edited, using the project's local ESLint. Never
 * blocks — any failure exits 0. Reads the hook event JSON from stdin.
 *
 * ESLint is launched via the resolved Node (process.execPath) + its JS entry
 * point rather than the .bin shim, so it never depends on a PATH shebang.
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

const projectDir = process.env.CLAUDE_PROJECT_DIR ?? process.cwd();
const eslintBin = path.join(projectDir, "node_modules", "eslint", "bin", "eslint.js");
if (!fs.existsSync(eslintBin)) process.exit(0);

try {
  execFileSync(process.execPath, [eslintBin, "--fix", file], {
    cwd: projectDir,
    stdio: "ignore",
    windowsHide: true,
  });
} catch {
  // Lint --fix is best-effort; never block the edit on remaining errors.
}

process.exit(0);
