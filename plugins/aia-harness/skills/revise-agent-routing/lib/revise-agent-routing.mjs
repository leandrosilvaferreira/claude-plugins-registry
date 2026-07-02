#!/usr/bin/env node
// revise-agent-routing.mjs — deterministic layer for the revise-agent-routing skill.
//
// Subcommands:
//   list   → enumerate .claude/agents/*.md, parse frontmatter (name, description).
//   check  → validate one description string against the routing-description standard.
//   table  → parse the root CLAUDE.md's "## Workflow & Agents" table into rows.
//   grep   → find literal mentions of an agent name across every CLAUDE.md in the project.
//
// Read-only. Never writes a file — the calling skill shows diffs and edits after consent.
// Reuses the aia-harness engine's own pure helpers via dynamic import (same precedent as
// condense.mjs's `frontmatter` subcommand, which imports lib/validate/frontmatter.mjs the
// same way) instead of duplicating their logic.

import { readFileSync, existsSync, readdirSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

// skills/revise-agent-routing/lib/ → 3 levels up → plugin root → lib/... . Same depth and
// same computation as condense.mjs's cmdFrontmatter.
const PLUGIN_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");

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

// ---------- list ----------

/** @param {string[]} args */
async function cmdList(args) {
  const root = flag(args, "--root") || process.cwd();
  const dir = join(root, ".claude", "agents");
  const { splitFrontmatter } = await import(join(PLUGIN_ROOT, "lib/ecc/transform.mjs"));
  const { parseFrontmatter } = await import(join(PLUGIN_ROOT, "lib/util/frontmatter-yaml.mjs"));

  /** @type {{ file: string, name: string, description: string }[]} */
  const agents = [];
  /** @type {{ file: string, reason: string }[]} */
  const skipped = [];

  const files = existsSync(dir)
    ? readdirSync(dir, { withFileTypes: true })
        .filter((d) => d.isFile() && d.name.endsWith(".md"))
        .map((d) => join(dir, d.name))
        .sort()
    : [];

  for (const file of files) {
    const content = readFileSync(file, "utf8");
    const { frontmatter } = splitFrontmatter(content);
    if (!frontmatter) {
      skipped.push({ file, reason: "no frontmatter block" });
      continue;
    }
    const entries = parseFrontmatter(frontmatter);
    const name = entries.find(
      (/** @type {{ key: string, value: string }} */ e) => e.key === "name",
    )?.value;
    const description = entries.find(
      (/** @type {{ key: string, value: string }} */ e) => e.key === "description",
    )?.value;
    if (!name) {
      skipped.push({ file, reason: "missing name field" });
      continue;
    }
    if (!description) {
      skipped.push({ file, reason: "missing description field" });
      continue;
    }
    agents.push({ file, name, description });
  }

  process.stdout.write(JSON.stringify({ agents, skipped }));
}

// ---------- check ----------

/** @param {string[]} args */
async function cmdCheck(args) {
  const text = flag(args, "--text");
  if (text === null) fail('check: pass --text "<value>"');
  const { checkAgentDescription } = await import(
    join(PLUGIN_ROOT, "lib/validate/agent-description.mjs")
  );
  process.stdout.write(JSON.stringify(checkAgentDescription(text)));
}

// ---------- table ----------

const TABLE_HEADING = "## Workflow & Agents";
// `| \`name\` | whenToUse |` — same row shape agentsWorkflowBlock() renders
// (lib/generate/claude-md.mjs).
const ROW_RE = /^\|\s*`([^`]+)`\s*\|\s*(.*?)\s*\|$/;

/**
 * @param {string} text
 * @returns {{ sectionExists: boolean, rows: { name: string, whenToUse: string, line: number }[] }}
 */
function parseAgentTable(text) {
  const lines = text.split("\n");
  const headingIdx = lines.findIndex((l) => l.trim() === TABLE_HEADING);
  if (headingIdx === -1) return { sectionExists: false, rows: [] };

  let i = headingIdx + 1;
  while (i < lines.length && lines[i].trim() !== "| Agent | When to use |") {
    if (/^#{1,6}\s/.test(lines[i])) return { sectionExists: true, rows: [] };
    i++;
  }
  if (i >= lines.length) return { sectionExists: true, rows: [] };
  i += 2; // skip the header row + the |---|---| separator row

  /** @type {{ name: string, whenToUse: string, line: number }[]} */
  const rows = [];
  while (i < lines.length) {
    const m = lines[i].match(ROW_RE);
    if (!m) break;
    rows.push({ name: m[1], whenToUse: m[2], line: i + 1 });
    i++;
  }
  return { sectionExists: true, rows };
}

/** @param {string[]} args */
function cmdTable(args) {
  const root = flag(args, "--root") || process.cwd();
  const file = join(root, "CLAUDE.md");
  if (!existsSync(file)) {
    process.stdout.write(JSON.stringify({ fileExists: false, sectionExists: false, rows: [] }));
    return;
  }
  const { sectionExists, rows } = parseAgentTable(readFileSync(file, "utf8"));
  process.stdout.write(JSON.stringify({ fileExists: true, sectionExists, rows }));
}

// ---------- grep ----------

/** @param {string} s @returns {string} */
function escapeRegExp(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** @param {string[]} args */
async function cmdGrep(args) {
  const root = flag(args, "--root") || process.cwd();
  const name = flag(args, "--name");
  if (!name) fail("grep: pass --name <agent-name>");
  const { collectFiles } = await import(join(PLUGIN_ROOT, "lib/util/fs.mjs"));

  /**
   * @type {{
   *   files: { rel: string, ext: string, base: string, size: number }[],
   *   dirs: Set<string>,
   *   truncated: boolean
   * }}
   */
  const { files } = collectFiles(root, {});
  const claudeMdFiles = files.filter((f) => f.base === "CLAUDE.md");
  const nameRe = new RegExp(`(?<![\\w-])${escapeRegExp(name)}(?![\\w-])`);

  /** @type {{ file: string, line: number, text: string }[]} */
  const matches = [];
  for (const f of claudeMdFiles) {
    const abs = join(root, f.rel);
    const lines = readFileSync(abs, "utf8").split("\n");
    lines.forEach((line, idx) => {
      if (nameRe.test(line)) matches.push({ file: f.rel, line: idx + 1, text: line.trim() });
    });
  }
  process.stdout.write(JSON.stringify({ matches }));
}

// ---------- main ----------

const [, , cmd, ...rest] = process.argv;
if (cmd === "list") cmdList(rest).catch((e) => fail(e.message));
else if (cmd === "check") cmdCheck(rest).catch((e) => fail(e.message));
else if (cmd === "table") cmdTable(rest);
else if (cmd === "grep") cmdGrep(rest).catch((e) => fail(e.message));
else fail("usage: revise-agent-routing.mjs <list|check|table|grep> [...args]");
