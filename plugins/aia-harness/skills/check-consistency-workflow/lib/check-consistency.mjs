#!/usr/bin/env node
// check-consistency.mjs — CLI entry for the check-consistency skill: argument parsing,
// subcommand dispatch, JSON to stdout. No logic lives here.
//
// Subcommands:
//   enumerate → list every skill/agent/rule/command/hook-or-script/CLAUDE.md file, plus
//               every hook script wired into .claude/settings.json. See enumerate.mjs.
//   xref      → cross-reference those files for dangling path references, uncertain
//               backticked names, and orphaned artifacts. See xref.mjs.
//
// Read-only. Never writes a file — the calling skill/agent decides what to do with the
// findings. Structure mirrors
// skills/revise-agent-routing-workflow/lib/revise-agent-routing.mjs.

import { resolve } from "node:path";
import { enumerateArtifacts } from "./enumerate.mjs";
import { xrefArtifacts } from "./xref.mjs";

/** @param {string[]} args @param {string} name @returns {string | null} */
function flag(args, name) {
  const i = args.indexOf(name);
  return i >= 0 && i + 1 < args.length ? args[i + 1] : null;
}

/** @param {string} msg @returns {never} */
function fail(msg) {
  process.stderr.write(`${msg}\n`);
  process.exit(1);
}

/** @param {string[]} args */
async function cmdEnumerate(args) {
  const root = resolve(flag(args, "--root") || process.cwd());
  // allFiles is every relative path the walk saw (large on a real project) and has
  // exactly one consumer, xrefArtifacts, which calls enumerateArtifacts() in-process and
  // never needs it serialized — drop it from this CLI's stdout so `enumerate --root`
  // stays small; it's still on the in-process return value untouched.
  const { allFiles: _allFiles, ...result } = await enumerateArtifacts(root);
  process.stdout.write(JSON.stringify(result));
}

/** @param {string[]} args */
async function cmdXref(args) {
  const root = resolve(flag(args, "--root") || process.cwd());
  const result = await xrefArtifacts(root);
  process.stdout.write(JSON.stringify(result));
}

// ---------- main ----------

const [, , cmd, ...rest] = process.argv;
if (cmd === "enumerate") cmdEnumerate(rest).catch((e) => fail(e.message));
else if (cmd === "xref") cmdXref(rest).catch((e) => fail(e.message));
else fail("usage: check-consistency.mjs <enumerate|xref>");
