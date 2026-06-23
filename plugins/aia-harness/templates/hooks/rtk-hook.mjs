#!/usr/bin/env node
/**
 * PreToolUse hook: rewrite Bash tool calls through rtk for token savings.
 * Cross-platform: uses Node.js binary discovery instead of bash `command -v`.
 * Always exits 0 (fail-open): a missing rtk binary is silent no-op.
 */
import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";

/** Locate the rtk binary. Returns null if not found. */
function findRtk() {
  const cmd = process.platform === "win32" ? "where" : "which";
  const r = spawnSync(cmd, ["rtk"], { encoding: "utf8" });
  if (r.status !== 0) return null;
  return r.stdout.trim().split(/\r?\n/)[0] || null;
}

const rtk = process.env.RTK_BIN || findRtk();
if (!rtk || !fs.existsSync(rtk)) process.exit(0);

try {
  execFileSync(rtk, ["hook", "claude"], { stdio: "inherit" });
} catch {
  // rtk unavailable or not configured → no-op, never block.
  process.exit(0);
}
