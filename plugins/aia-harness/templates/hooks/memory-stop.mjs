#!/usr/bin/env node
/**
 * Stop hook: complexity-gated memory nudge.
 *
 * Emits a systemMessage asking Claude to reflect on session learnings, but
 * ONLY when the session was complex enough to have generated real knowledge:
 *
 *   Gate 1 — at least one source-code file was edited (not docs/images/locks)
 *   Gate 2 — session had ≥ 15 total file ops OR ≥ 3 unique source files edited
 *
 * Reads the session flag file written by set-files-changed.mjs (same infra).
 * Never blocks — always exits 0. Fails open on any error.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";

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
  // ignore parse errors
}

// Anti-loop guard: skip when already inside a stop-hook chain.
if (event?.stop_hook_active) process.exit(0);

const projectDir = process.env.CLAUDE_PROJECT_DIR ?? process.cwd();

// Read the session flag file populated by set-files-changed.mjs (one path per line).
const h = createHash("sha1").update(projectDir).digest("hex").slice(0, 12);
const flag = path.join(os.tmpdir(), `aia-harness-changed-${h}`);

let raw = "";
try {
  raw = fs.readFileSync(flag, "utf8");
} catch {
  process.exit(0); // No flag file → nothing was edited this session.
}

const allOps = raw.split("\n").filter((l) => l.trim().length > 0);

// Extensions that carry real code knowledge (things a future session cares about).
const SOURCE_EXTS = new Set([
  ".mjs",
  ".js",
  ".cjs",
  ".ts",
  ".tsx",
  ".jsx",
  ".py",
  ".go",
  ".java",
  ".kt",
  ".groovy",
  ".php",
  ".rs",
  ".cs",
  ".c",
  ".cpp",
  ".h",
  ".hpp",
  ".rb",
  ".swift",
  ".dart",
  ".scala",
  ".ex",
  ".exs",
  ".sql",
]);

// File name suffixes that are never source knowledge even if extension matches.
const SKIP_SUFFIXES = [
  "package-lock.json",
  "yarn.lock",
  "pnpm-lock.yaml",
  "go.sum",
  ".lock",
  ".sum",
  ".snap",
];

/**
 * @param {string} f
 * @returns {boolean}
 */
function isSourceFile(f) {
  const ext = path.extname(f).toLowerCase();
  if (!SOURCE_EXTS.has(ext)) return false;
  for (const suffix of SKIP_SUFFIXES) {
    if (f.endsWith(suffix)) return false;
  }
  return true;
}

const uniqueSource = [...new Set(allOps)].filter(isSourceFile);

// Gate 1: at least one source file must have been edited.
if (uniqueSource.length === 0) process.exit(0);

// Gate 2: session must have been complex enough.
if (allOps.length < 15 && uniqueSource.length < 3) process.exit(0);

// Check memory index saturation → add sanitation reminder if needed.
const memoryIndexPath = path.join(projectDir, ".claude", "memory", "MEMORY.md");
let sanitationNote = "";
try {
  const memContent = fs.readFileSync(memoryIndexPath, "utf8");
  const indexLines = memContent.split("\n").filter((l) => l.trim().length > 0).length;
  if (indexLines >= 130) {
    sanitationNote =
      " ⚠️  MEMORY.md has ≥ 130 entries — run sanitation before saving:" +
      " archive low-value memories, rewrite the index to ≤ 100 lines.";
  }
} catch {
  // Index doesn't exist yet; fine — first session writes it.
}

const message =
  `[memory-stop] Session ended: ${uniqueSource.length} source file(s) changed,` +
  ` ${allOps.length} file operations total.` +
  ` Before finishing: reflect on whether this session generated real project knowledge` +
  ` — a pattern discovered after failures, a recurring mistake now corrected,` +
  ` a non-obvious business rule or architectural decision.` +
  ` If yes, save it in .claude/memory/ following INSTRUCTIONS.md.` +
  ` If this was a routine change with nothing surprising, skip — not every session needs a memory.` +
  sanitationNote;

process.stdout.write(JSON.stringify({ systemMessage: message }));
process.exit(0);
