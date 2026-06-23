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
import os from "node:os";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";

const MAX_LINES = 350;

/** Extensions that represent source/business-logic code worth checking. */
const SOURCE_EXTS = new Set([
  ".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".mts", ".cts",
  ".py", ".java", ".kt", ".kts",
  ".go", ".rb", ".php",
  ".swift", ".rs", ".cs", ".dart",
  ".ex", ".exs", ".vue", ".svelte",
]);

/**
 * Directory segments that indicate generated, vendored, or build output —
 * files inside these are never checked.
 */
const IGNORED_DIRS = new Set([
  "node_modules", "build", "dist", "target", ".next", "out",
  "__pycache__", ".gradle", "vendor", "coverage", ".git",
  ".build", "DerivedData", "Pods", ".cache", "tmp", ".tmp",
  "generated", "gen", "__generated__", "migrations", "migration",
  "fixtures", "mocks", "__mocks__", "stubs",
  "lang", "i18n", "locales", "assets", "static", "public",
  "templates",
]);

/**
 * Returns true when the file is a real source/business file worth
 * enforcing a line-count budget on.
 * @param {string} absPath
 * @returns {boolean}
 */
function isSourceFile(absPath) {
  const ext = path.extname(absPath).toLowerCase();
  if (!SOURCE_EXTS.has(ext)) return false;
  // TypeScript declaration files are type-only, not logic.
  if (absPath.endsWith(".d.ts")) return false;

  const parts = absPath.split(path.sep);
  for (const seg of parts.slice(0, -1)) {
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

const projectDir = process.env.CLAUDE_PROJECT_DIR ?? process.cwd();
const projHash = createHash("sha1").update(projectDir).digest("hex").slice(0, 12);

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
  const abs = path.isAbsolute(file) ? file : path.join(projectDir, file);
  if (!isSourceFile(abs)) return;
  const lines = countLines(abs);
  if (lines == null || lines <= MAX_LINES) return;

  // De-dup: notify at most once per (session, file).
  const sessionId = typeof event.session_id === "string" ? event.session_id : "nosession";
  const notifiedFlag = path.join(os.tmpdir(), `aia-harness-largefile-notified-${projHash}`);
  const key = `${sessionId}\t${abs}`;
  try {
    if (fs.readFileSync(notifiedFlag, "utf8").split(/\r?\n/).includes(key)) return;
  } catch {
    // No flag yet — first notice this session.
  }
  try {
    fs.appendFileSync(notifiedFlag, key + "\n");
  } catch {
    // Best-effort; a missed de-dup only repeats the (harmless) advice.
  }

  const rel = path.relative(projectDir, abs) || path.basename(abs);
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
  const flag = path.join(os.tmpdir(), `aia-harness-changed-${projHash}`);

  // Primary: session-tracked files recorded by set-files-changed.mjs.
  try {
    const raw = fs.readFileSync(flag, "utf8");
    candidates = [...new Set(raw.split(/\r?\n/).filter(Boolean))];
  } catch {
    // Fallback: working-tree changes visible via git.
    try {
      const status = execFileSync("git", ["status", "--porcelain"], {
        cwd: projectDir,
        encoding: "utf8",
      });
      candidates = status
        .split(/\r?\n/)
        .filter(Boolean)
        .map((line) => path.join(projectDir, line.slice(3).trim()));
    } catch {
      return;
    }
  }

  /** @type {{ file: string; lines: number }[]} */
  const oversized = [];
  for (const f of candidates) {
    const abs = path.isAbsolute(f) ? f : path.join(projectDir, f);
    if (!isSourceFile(abs)) continue;
    const lines = countLines(abs);
    if (lines != null && lines > MAX_LINES) {
      oversized.push({ file: path.relative(projectDir, abs), lines });
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
