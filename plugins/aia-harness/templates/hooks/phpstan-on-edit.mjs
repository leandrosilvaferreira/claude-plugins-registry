#!/usr/bin/env node
/**
 * PostToolUse hook: run PHPStan on the PHP file Claude just edited and feed any
 * findings back to Claude so it self-corrects (like a per-edit verify loop).
 *
 * Shipped by aia-harness for PHP stacks. FAIL-OPEN on all infrastructure — it
 * only ever exits 0 (clean/skipped) or 2 (findings), per the hook schema:
 *   - non-PHP file, missing tool_input, invalid stdin          → exit 0 (silent)
 *   - no vendor/bin/phpstan, no phpstan config, spawn/timeout   → exit 0 (silent)
 *   - phpstan ran clean (exit 0)                                → exit 0 (silent)
 *   - phpstan reported errors (exit 1, with output)            → exit 2 (stderr → Claude)
 *
 * Gating on a PHPStan config (phpstan.neon[.dist] / phpstan.dist.neon) is
 * deliberate: single-file analysis without a level/autoload config is noise.
 */
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

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
const file = ti.file_path || ti.path;
if (!file || typeof file !== "string") process.exit(0);

const ext = path.extname(file).toLowerCase();
if (ext !== ".php" && ext !== ".phtml") process.exit(0);

const cwdArg = typeof event.cwd === "string" && event.cwd ? event.cwd : "";
const projectDir = cwdArg || process.env.CLAUDE_PROJECT_DIR || process.cwd();

const phpstan = path.join(projectDir, "vendor", "bin", "phpstan");
if (!fs.existsSync(phpstan)) process.exit(0);

const hasConfig = ["phpstan.neon", "phpstan.neon.dist", "phpstan.dist.neon"].some((f) =>
  fs.existsSync(path.join(projectDir, f)),
);
if (!hasConfig) process.exit(0);

const res = spawnSync(phpstan, ["analyse", "--no-progress", "--error-format=raw", file], {
  cwd: projectDir,
  encoding: "utf8",
  timeout: 55000,
  maxBuffer: 4 * 1024 * 1024,
  windowsHide: true,
});

// status 0 = no errors; status 1 = errors found; null/other = signal, timeout,
// or crash → infrastructure problem, fail open.
if (!res || res.status === 0 || res.status !== 1) process.exit(0);

const out = ((res.stdout || "") + (res.stderr || "")).trim();
if (!out) process.exit(0);

const lines = out.split("\n");
const shown = lines.slice(0, 40).join("\n");
const more = lines.length > 40 ? `\n… +${lines.length - 40} more line(s)` : "";
process.stderr.write(`PHPStan found issues in ${file} — fix before continuing:\n${shown}${more}\n`);
process.exit(2);
