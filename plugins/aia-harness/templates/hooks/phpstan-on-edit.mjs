#!/usr/bin/env node
/**
 * PostToolUse hook: run PHPStan on the PHP file Claude just edited and feed any
 * findings back to Claude so it self-corrects (like a per-edit verify loop).
 *
 * Shipped by aia-harness for PHP stacks. FAIL-OPEN on all infrastructure — it
 * only ever exits 0 (clean/skipped) or 2 (findings), per the hook schema:
 *   - non-PHP file, missing tool_input, invalid stdin           → exit 0 (silent)
 *   - no vendor/bin/phpstan, no phpstan config, spawn/timeout    → exit 0 (silent)
 *   - Windows only: file path has an unsafe shell character      → exit 0 (silent)
 *   - phpstan ran clean (exit 0)                                 → exit 0 (silent)
 *   - phpstan reported errors (exit 1, with output)              → exit 2 (stderr → Claude)
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

// Composer installs vendor/bin/phpstan as an extension-less Unix script; on
// Windows it additionally generates vendor/bin/phpstan.bat, the one that
// actually runs there — probe it first, same extension-ordering idea as
// findBinary in lib/detect/system-deps.mjs. See the spawnSync call below for
// why running the .bat candidate needs shell:true (confirmed on real Windows
// CI — a resolved absolute .bat path is NOT auto-invocable without one).
const isWin = process.platform === "win32";
const vendorBinPhpstan = path.join(projectDir, "vendor", "bin", "phpstan");
const phpstanCandidates = isWin
  ? [vendorBinPhpstan + ".bat", vendorBinPhpstan]
  : [vendorBinPhpstan];
const phpstan = phpstanCandidates.find((p) => fs.existsSync(p));
if (!phpstan) process.exit(0);

const hasConfig = ["phpstan.neon", "phpstan.neon.dist", "phpstan.dist.neon"].some((f) =>
  fs.existsSync(path.join(projectDir, f)),
);
if (!hasConfig) process.exit(0);

// A .bat is not a PE image, so Windows' CreateProcess cannot launch it directly —
// spawnSync without a shell silently fails to start it (status comes back non-1), which
// the fail-open check below then reads as "no findings" instead of "never ran". This is
// confirmed on real Windows CI, not just theory. shell:true is Node's documented
// mechanism for this exact case, same precedent as the npm/pnpm/yarn/bun install and
// `claude` CLI invocations in worktree-seed.mjs / lib/version-check.mjs, and it is
// scoped to win32 only — the POSIX extension-less script keeps running directly via its
// shebang, no shell involved, so none of this changes non-Windows behavior.
//
// Two different concerns follow from turning shell:true on, handled separately:
//   1. Correctness — cmd.exe needs one command line, not a command + argv array.
//      Passing a non-empty `args` array alongside shell:true makes Node itself warn
//      (DEP0190: "arguments are not escaped, only concatenated") because it just joins
//      [command, ...args] with spaces — no per-argument quoting. `phpstan` is built from
//      projectDir, which can contain spaces on a real Windows box, so the join would
//      split it into extra tokens. Fix: build ONE pre-quoted command string ourselves and
//      pass it with an empty `args` array — same concatenation Node would do, but
//      quoted correctly and without the warning polluting stderr (which Claude reads
//      verbatim on the exit-2 path below).
//   2. Security — `file` is hook input (tool_input.file_path), not a value this hook
//      derived itself, unlike `phpstan`/`projectDir`. cmd.exe treats & | ^ < > ( ) % ! "
//      and newlines as command syntax even *inside* a quoted argument — quoting alone
//      cannot make an arbitrary string safe (this is the class of gap Node's own
//      CVE-2024-27980 hardened but did not eliminate for spawning a .bat/.cmd through a
//      shell). SAFE_WINDOWS_ARG allow-lists plain-path characters before `file` ever
//      reaches the shell — same gate-before-shell shape as SAFE_MARKETPLACE in
//      lib/version-check.mjs — and the hook fails open (exit 0) on a miss: this is
//      best-effort per-edit feedback, never a required gate, so silently skipping one
//      oddly-named file costs nothing. Do not "simplify" this back to a bare shell:true
//      + args array without it.
const SAFE_WINDOWS_ARG = /^[\w .:\\/-]+$/;
if (isWin && !SAFE_WINDOWS_ARG.test(file)) process.exit(0);

const analyseArgs = ["analyse", "--no-progress", "--error-format=raw", file];
const [cmd, cmdArgs] = isWin
  ? [[phpstan, ...analyseArgs].map((s) => `"${s}"`).join(" "), []]
  : [phpstan, analyseArgs];

const res = spawnSync(cmd, cmdArgs, {
  cwd: projectDir,
  encoding: "utf8",
  timeout: 55000,
  maxBuffer: 4 * 1024 * 1024,
  windowsHide: true,
  shell: isWin,
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
