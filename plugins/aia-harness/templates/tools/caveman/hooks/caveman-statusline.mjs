#!/usr/bin/env node
/**
 * Caveman statusline badge — cross-platform Node.js equivalent of caveman-statusline.sh.
 * Reads the caveman mode flag and outputs a colored badge string.
 * Usage in settings.json: "statusLine": { "type": "command", "command": "node", "args": ["/path/to/caveman-statusline.mjs"] }
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const configDir = process.env.CLAUDE_CONFIG_DIR ?? path.join(os.homedir(), ".claude");
const FLAG = path.join(configDir, ".caveman-active");

// lstatSync (NOT statSync) — statSync follows symlinks so isSymbolicLink() is never
// true on a followed link. lstatSync returns the link's own metadata.
const lstat = fs.lstatSync(FLAG, { throwIfNoEntry: false });
if (!lstat) process.exit(0);
if (lstat.isSymbolicLink()) process.exit(0);
if (!lstat.isFile()) process.exit(0);
// Hard-cap at 64 bytes.
if (lstat.size > 64) process.exit(0);

const raw = fs.readFileSync(FLAG, "utf8").replace(/[\r\n]/g, "").toLowerCase();
// Strip anything outside [a-z0-9-].
const mode = raw.replace(/[^a-z0-9-]/g, "");

const VALID = new Set(["off", "lite", "full", "ultra", "wenyan-lite", "wenyan", "wenyan-full", "wenyan-ultra", "commit", "review", "compress"]);
if (!VALID.has(mode)) process.exit(0);
if (mode === "off") process.exit(0);

if (!mode || mode === "full") {
  process.stdout.write("\x1b[38;5;172m[CAVEMAN]\x1b[0m");
} else {
  process.stdout.write(`\x1b[38;5;172m[CAVEMAN:${mode.toUpperCase()}]\x1b[0m`);
}

// Savings suffix (same hardening as flag file).
if ((process.env.CAVEMAN_STATUSLINE_SAVINGS ?? "1") !== "0") {
  const suffixFile = path.join(configDir, ".caveman-statusline-suffix");
  const sStat = fs.lstatSync(suffixFile, { throwIfNoEntry: false });
  if (sStat && !sStat.isSymbolicLink() && sStat.isFile() && sStat.size <= 64) {
    const savings = fs.readFileSync(suffixFile, "utf8")
      .replace(/[\x00-\x1f]/g, "").trim();
    if (savings) process.stdout.write(` \x1b[38;5;172m${savings}\x1b[0m`);
  }
}
