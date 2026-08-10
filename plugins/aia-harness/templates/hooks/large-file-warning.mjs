#!/usr/bin/env node
/**
 * Large-file guard. One script, two actionable modes selected by which event
 * settings.json wires it under (it branches on hook_event_name):
 *
 *   • Stop (BLOCK mode, greenfield) — scans the files edited this session and,
 *     if any source file exceeds 350 lines, returns {decision:"block"} so the
 *     agent refactors into smaller units BEFORE finishing. Anti-loop: a stop
 *     already retriggered by a previous block (stop_hook_active) is let through,
 *     so it blocks at most once per stop-chain (mirrors verify-on-stop.mjs).
 *
 *   • PostToolUse (ADVISORY mode, legacy) — checks only the just-edited file and
 *     injects hookSpecificOutput.additionalContext telling the agent to OFFER a
 *     refactor and confirm with the user — never blocking, never refactoring
 *     unprompted. De-duped to once per (session, file).
 *
 * DDD-aligned extraction is suggested either way. Always exits 0; both outputs
 * satisfy the Stop / PostToolUse hook schemas.
 */
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { sessionScratchDir } from "./session-scratch.mjs";
import { parseHookEvent, readStdinRaw } from "./hook-io.mjs";

const MAX_LINES = 350;

/** Extensions that represent source/business-logic code worth checking. */
const SOURCE_EXTS = new Set([
  ".ts",
  ".tsx",
  ".js",
  ".jsx",
  ".mjs",
  ".cjs",
  ".mts",
  ".cts",
  ".py",
  ".java",
  ".kt",
  ".kts",
  ".go",
  ".rb",
  ".php",
  ".swift",
  ".rs",
  ".cs",
  ".dart",
  ".ex",
  ".exs",
  ".vue",
  ".svelte",
]);

/**
 * Directory segments that indicate generated, vendored, or build output —
 * files inside these are never checked.
 */
const IGNORED_DIRS = new Set([
  "node_modules",
  "build",
  "dist",
  "target",
  ".next",
  "out",
  "__pycache__",
  ".gradle",
  "vendor",
  "coverage",
  ".git",
  ".build",
  "DerivedData",
  "Pods",
  ".cache",
  "tmp",
  ".tmp",
  "generated",
  "gen",
  "__generated__",
  "migrations",
  "migration",
  "fixtures",
  "mocks",
  "__mocks__",
  "stubs",
  "lang",
  "i18n",
  "locales",
  "assets",
  "static",
  "public",
  "templates",
  // aia-harness scaffolds all its artifacts under .claude/ (hooks, plus vendored
  // runners in .claude/scripts that legitimately exceed the budget) — none of it
  // is target-project source the user should be forced to refactor, so ignore the
  // whole directory. Matched as an exact path segment, so app code like
  // src/hooks/useThing.ts (no ".claude" segment) is still checked normally.
  ".claude",
]);

/**
 * Returns true when the file is a real source/business file worth
 * enforcing a line-count budget on.
 *
 * IGNORED_DIRS matching is scoped to the path *relative to `baseDir`* (the
 * project/exec root), never to absolute filesystem ancestry above it.
 * Matching the raw absolute path would treat the OS's own temp root as an
 * "ignored" project subdirectory whenever a project happens to live directly
 * under it: os.tmpdir() resolves to exactly "/tmp" on stock Linux (no custom
 * TMPDIR/TMP/TEMP — the default on GitHub Actions ubuntu runners), and "tmp"
 * is itself one of the IGNORED_DIRS names below (meant to skip a project-
 * local tmp/ folder) — so every file under a Linux /tmp/<x>/... path,
 * including this project's own test fixtures, was silently treated as
 * ignored/vendored and never flagged, no matter how large.
 * @param {string} absPath
 * @param {string} baseDir
 * @returns {boolean}
 */
function isSourceFile(absPath, baseDir) {
  const ext = path.extname(absPath).toLowerCase();
  if (!SOURCE_EXTS.has(ext)) return false;
  // TypeScript declaration files are type-only, not logic.
  if (absPath.endsWith(".d.ts")) return false;

  const rel = path.relative(baseDir, absPath);
  const dirs = rel.split(path.sep).slice(0, -1);
  for (const seg of dirs) {
    if (IGNORED_DIRS.has(seg)) return false;
  }

  const base = path.basename(absPath);
  // Test / story / config files — not primary logic.
  if (/\.(test|spec|stories|config|conf)\.[^.]+$/.test(base)) return false;
  // Pure type / constant / barrel re-export files.
  if (/^(index|types?|interfaces?|constants?|dtos?|enums?|vo)\.[^.]+$/.test(base)) return false;

  return true;
}

/**
 * @param {string} absPath
 * @returns {number|null}
 */
function countLines(absPath) {
  try {
    if (!fs.existsSync(absPath)) return null;
    return fs.readFileSync(absPath, "utf8").split(/\r?\n/).length;
  } catch {
    return null;
  }
}

const event = parseHookEvent(readStdinRaw());
if (event === null) process.exit(0);

const projectDir = process.env.CLAUDE_PROJECT_DIR ?? process.cwd();
const execDir = (typeof event.cwd === "string" && event.cwd && event.cwd) || projectDir;

/** Shared DDD-aligned extraction guidance. */
const DDD_HINTS = [
  "Refactor into smaller, focused units (DDD-aligned):",
  "  – Business logic → domain service or use-case class",
  "  – Repeated UI blocks → reusable sub-component",
  "  – Data access code → repository / adapter class",
  "  – Cluster of helpers → domain-specific utility module",
  `Keep each file under ${MAX_LINES} lines with a single clear responsibility.`,
].join("\n");

/**
 * ADVISORY (PostToolUse): nudge on the just-edited file, once per session+file.
 * Never blocks; tells the agent to offer a refactor and confirm with the user.
 */
function advisory() {
  const ti = event.tool_input || {};
  const file = ti.file_path ?? ti.path;
  if (!file || typeof file !== "string") return;
  const abs = path.isAbsolute(file) ? file : path.join(execDir, file);
  if (!isSourceFile(abs, execDir)) return;
  const lines = countLines(abs);
  if (lines == null || lines <= MAX_LINES) return;

  // De-dup: notify at most once per (session, file). The scratch dir is
  // itself session-scoped, so the file no longer needs a session prefix —
  // see templates/hooks/session-scratch.mjs.
  const sessionId = typeof event.session_id === "string" ? event.session_id : "nosession";
  const notifiedFlag = path.join(sessionScratchDir(sessionId), "largefile-notified");
  try {
    if (fs.readFileSync(notifiedFlag, "utf8").split(/\r?\n/).includes(abs)) return;
  } catch {
    // No flag yet — first notice this session.
  }
  try {
    fs.appendFileSync(notifiedFlag, abs + "\n");
  } catch {
    // Best-effort; a missed de-dup only repeats the (harmless) advice.
  }

  const rel = path.relative(execDir, abs) || path.basename(abs);
  const additionalContext = [
    `${rel} has ${lines} lines (over the ${MAX_LINES}-line budget).`,
    "Tell the user and OFFER to refactor it into smaller units. Do NOT refactor without the user's approval.",
    DDD_HINTS,
  ].join("\n");
  process.stdout.write(
    JSON.stringify({ hookSpecificOutput: { hookEventName: "PostToolUse", additionalContext } }),
  );
}

/**
 * BLOCK (Stop): if any session-edited source file is over budget, block the
 * stop so the agent refactors first. Anti-loop via stop_hook_active.
 */
function blockOnStop() {
  // A stop already retriggered by a previous block must be allowed through.
  if (event && event.stop_hook_active) return;

  /** @type {string[]} */
  let candidates = [];
  const sessionId = typeof event.session_id === "string" ? event.session_id : "nosession";
  const flag = path.join(sessionScratchDir(sessionId), "files-changed");

  // Primary: session-tracked files recorded by set-files-changed.mjs.
  try {
    const raw = fs.readFileSync(flag, "utf8");
    candidates = [...new Set(raw.split(/\r?\n/).filter(Boolean))];
  } catch {
    // Fallback: working-tree changes visible via git.
    try {
      const status = execFileSync("git", ["status", "--porcelain"], {
        cwd: execDir,
        encoding: "utf8",
        windowsHide: true,
      });
      candidates = status
        .split(/\r?\n/)
        .filter(Boolean)
        .map((line) => path.join(execDir, line.slice(3).trim()));
    } catch {
      return;
    }
  }

  /** @type {{ file: string; lines: number }[]} */
  const oversized = [];
  for (const f of candidates) {
    const abs = path.isAbsolute(f) ? f : path.join(execDir, f);
    if (!isSourceFile(abs, execDir)) continue;
    const lines = countLines(abs);
    if (lines != null && lines > MAX_LINES) {
      oversized.push({ file: path.relative(execDir, abs), lines });
    }
  }
  if (oversized.length === 0) return;

  const sorted = oversized.sort((a, b) => b.lines - a.lines);
  const list = sorted.map(({ file, lines }) => `  • ${file} (${lines} lines)`).join("\n");
  const reason = [
    `${sorted.length} source file(s) exceed ${MAX_LINES} lines:`,
    list,
    "",
    "Refactor them into smaller, single-responsibility units BEFORE finishing.",
    DDD_HINTS,
  ].join("\n");
  process.stdout.write(JSON.stringify({ decision: "block", reason }));
}

if (event.hook_event_name === "PostToolUse") {
  advisory();
} else {
  blockOnStop();
}

process.exit(0);
