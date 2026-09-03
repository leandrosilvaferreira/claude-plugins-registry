#!/usr/bin/env node
// condense.mjs — CLI entry for the condense-harness-prompts skill: argument dispatch only.
//
// Subcommands:
//   enumerate    → list target .md files for a given scope (one path per line). See enumerate.mjs.
//   commit       → validate each <file>.condensed.tmp sidecar against original;
//                  overwrite on pass, keep .tmp on fail. See commit.mjs.
//   frontmatter  → validate and auto-fix Claude Code frontmatter for a list of files.
//                  See frontmatter.mjs.
//
// The SEMANTIC compression is done by Opus subagents (they write the .tmp
// sidecars). This script never compresses — it only enumerates and runs the
// deterministic preservation gate, because subagents can misreport success.

import { cmdEnumerate } from "./enumerate.mjs";
import { cmdCommit } from "./commit.mjs";
import { cmdFrontmatter } from "./frontmatter.mjs";
import { fail } from "./cli.mjs";

// ---------- main ----------

const [, , cmd, ...rest] = process.argv;
if (cmd === "enumerate") cmdEnumerate(rest);
else if (cmd === "commit") cmdCommit(rest);
else if (cmd === "frontmatter")
  cmdFrontmatter(rest).catch((e) => {
    process.stderr.write(`${e.message}\n`);
    process.exit(1);
  });
else fail("usage: condense.mjs <enumerate|commit|frontmatter> [...args]");
