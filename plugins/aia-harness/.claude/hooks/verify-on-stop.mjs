#!/usr/bin/env node
/**
 * Stop hook (this repo's own dev harness): when the working tree has
 * uncommitted changes, run the verification trio — typecheck (tsc --checkJs),
 * lint (eslint), unit tests (node --test) — and report the result as a
 * non-blocking systemMessage. NEVER blocks: always exits 0, so a red bar is a
 * nudge, not a wall. Each tool is launched via the resolved Node
 * (process.execPath) so it works when `node` is not on PATH.
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
  // ignore parse errors — cwd fallback below still works
}

const cwdArg = typeof event.cwd === "string" && event.cwd ? event.cwd : "";
const projectDir = cwdArg || process.env.CLAUDE_PROJECT_DIR || process.cwd();

/** @returns {boolean} */
function hasChanges() {
  try {
    const out = execFileSync("git", ["status", "--porcelain"], {
      cwd: projectDir,
      encoding: "utf8",
      windowsHide: true,
    });
    return out.split("\n").some((l) => l.trim().length > 0);
  } catch {
    return false;
  }
}

if (!hasChanges()) process.exit(0);

/**
 * Run a local Node-based tool via the resolved runtime. Returns true on success.
 * @param {string} binRelPath  Path under node_modules to the tool's JS entry.
 * @param {string[]} extraArgs
 * @returns {boolean|null}  null when the tool isn't installed (skipped).
 */
function run(binRelPath, extraArgs) {
  const bin = path.join(projectDir, binRelPath);
  if (!fs.existsSync(bin)) return null;
  try {
    execFileSync(process.execPath, [bin, ...extraArgs], {
      cwd: projectDir,
      stdio: "ignore",
      windowsHide: true,
    });
    return true;
  } catch {
    return false;
  }
}

/** @type {string[]} */
const failed = [];

const typecheck = run(path.join("node_modules", "typescript", "bin", "tsc"), []);
if (typecheck === false) failed.push("typecheck");

const lint = run(path.join("node_modules", "eslint", "bin", "eslint.js"), ["."]);
if (lint === false) failed.push("lint");

// Unit tests: the resolved Node's own test runner (auto-discovers tests/*.test.mjs).
let unit = null;
try {
  execFileSync(process.execPath, ["--test"], {
    cwd: projectDir,
    stdio: "ignore",
    windowsHide: true,
  });
  unit = true;
} catch {
  unit = false;
  failed.push("tests");
}
void unit;

const message =
  failed.length === 0
    ? "aia-harness verify: typecheck + lint + tests all green ✅"
    : `aia-harness verify: FAILING → ${failed.join(", ")}. Run \`npm test\` for details before wrapping up.`;

process.stdout.write(JSON.stringify({ systemMessage: message }));
process.exit(0);
