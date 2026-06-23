#!/usr/bin/env node
/**
 * Ponytail statusline badge — cross-platform Node.js equivalent of ponytail-statusline.sh.
 * Usage in settings.json: "statusLine": { "type": "command", "command": "node", "args": ["/path/to/ponytail-statusline.mjs"] }
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const configDir = process.env.CLAUDE_CONFIG_DIR ?? path.join(os.homedir(), ".claude");
const FLAG = path.join(configDir, ".ponytail-active");

// lstatSync (NOT statSync) — statSync follows symlinks so isSymbolicLink() is never
// true on a followed link. lstatSync returns the link's own metadata.
const lstat = fs.lstatSync(FLAG, { throwIfNoEntry: false });
if (!lstat) process.exit(0);
if (lstat.isSymbolicLink()) process.exit(0);
if (!lstat.isFile()) process.exit(0);
// Hard-cap at 64 bytes.
if (lstat.size > 64) process.exit(0);

const raw = fs.readFileSync(FLAG, "utf8").replace(/[\r\n]/g, "");
// Strip whitespace — mirrors the shell script's tr -d '[:space:]'.
const mode = raw.replace(/\s/g, "");

if (!mode || mode === "full") {
  process.stdout.write("\x1b[38;5;108m[PONYTAIL]\x1b[0m");
} else {
  process.stdout.write(`\x1b[38;5;108m[PONYTAIL:${mode.toUpperCase()}]\x1b[0m`);
}
