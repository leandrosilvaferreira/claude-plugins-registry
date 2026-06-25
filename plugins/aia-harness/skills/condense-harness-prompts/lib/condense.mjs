#!/usr/bin/env node
// condense.mjs — deterministic layer for the condense-harness-prompts skill.
//
// Subcommands:
//   enumerate    → list target .md files for a given scope (one path per line)
//   commit       → validate each <file>.condensed.tmp sidecar against original;
//                  overwrite on pass, keep .tmp on fail.
//   frontmatter  → validate and auto-fix Claude Code frontmatter for a list of files.
//
// The SEMANTIC compression is done by Opus subagents (they write the .tmp
// sidecars). This script never compresses — it only enumerates and runs the
// deterministic preservation gate, because subagents can misreport success.
//
// Gate is a JS port of the caveman-compress plugin validate.py:
// blocks (error) on lost code blocks / URLs / inline-code / heading-count;
// warns (non-blocking) on heading-text reorder / bullet drift / path drift.

import {
  readFileSync,
  writeFileSync,
  existsSync,
  unlinkSync,
  statSync,
  readdirSync,
} from "node:fs";
import { join, resolve, isAbsolute, basename, dirname } from "node:path";
import { fileURLToPath } from "node:url";

// Safety guardrails adopted from caveman-compress compress.py.
const MAX_FILE_SIZE = 500_000; // 500KB — refuse oversized prompts.

// Strip an outer ```markdown … ``` fence the subagent may wrap its whole
// output in. Without this, a wrapped sidecar would fail the code-block gate
// as a false positive (it looks like an extra code block).
const OUTER_FENCE_RE = /^\s*(`{3,}|~{3,})[^\n]*\n([\s\S]*)\n\1\s*$/;
function stripLlmWrapper(text) {
  const m = text.match(OUTER_FENCE_RE);
  return m ? m[2] : text;
}

// Hard denylist for files that must never be shipped to the model. Compressing
// sends raw bytes to a subagent (Anthropic API boundary); a .env / key / creds
// file pointed at via --file would otherwise leak. Ported from compress.py.
const SENSITIVE_BASENAME_RE =
  /^(\.env(\..+)?|\.netrc|credentials(\..+)?|secrets?(\..+)?|passwords?(\..+)?|id_(rsa|dsa|ecdsa|ed25519)(\.pub)?|authorized_keys|known_hosts|.*\.(pem|key|p12|pfx|crt|cer|jks|keystore|asc|gpg))$/i;
const SENSITIVE_PATH_COMPONENTS = new Set([".ssh", ".aws", ".gnupg", ".kube", ".docker"]);
const SENSITIVE_NAME_TOKENS = [
  "secret",
  "credential",
  "password",
  "passwd",
  "apikey",
  "accesskey",
  "token",
  "privatekey",
];
function isSensitivePath(p) {
  const name = basename(p);
  if (SENSITIVE_BASENAME_RE.test(name)) return true;
  const parts = p.split(/[/\\]/).map((s) => s.toLowerCase());
  if (parts.some((x) => SENSITIVE_PATH_COMPONENTS.has(x))) return true;
  const lower = name.toLowerCase().replace(/[_\-\s.]/g, "");
  return SENSITIVE_NAME_TOKENS.some((t) => lower.includes(t));
}

// ---------- preservation gate (port of validate.py) ----------

const HEADING_RE = /^(#{1,6})\s+(.*)$/gm;
const URL_RE = /https?:\/\/[^\s)]+/g;
const FENCE_OPEN_RE = /^(\s{0,3})(`{3,}|~{3,})(.*)$/;
const BULLET_RE = /^\s*[-*+]\s+/gm;
// Same shape as validate.py PATH_REGEX: needs a path prefix (./ ../ / drive:\)
// or an internal slash/backslash. Path drift is a WARNING, never a block.
// Unicode-aware (\p{L}\p{N} + u flag) to match Python 3's unicode \w — so
// accented path segments (e.g. café/, naïve/) still match defensively.
const PATH_RE =
  /(?:\.\/|\.\.\/|\/|[A-Za-z]:\\)[\p{L}\p{N}_\-/\\.]+|[\p{L}\p{N}_\-.]+[/\\][\p{L}\p{N}_\-/\\.]+/gu;

function extractHeadings(text) {
  const out = [];
  HEADING_RE.lastIndex = 0;
  let m;
  while ((m = HEADING_RE.exec(text))) out.push(`${m[1]} ${m[2].trim()}`);
  return out;
}

// Line-based fenced block extractor: ``` or ~~~, variable length, nested.
function extractCodeBlocks(text) {
  const blocks = [];
  const lines = text.split("\n");
  let i = 0;
  const n = lines.length;
  while (i < n) {
    const m = lines[i].match(FENCE_OPEN_RE);
    if (!m) {
      i++;
      continue;
    }
    const fenceChar = m[2][0];
    const fenceLen = m[2].length;
    const block = [lines[i]];
    i++;
    let closed = false;
    while (i < n) {
      const cm = lines[i].match(FENCE_OPEN_RE);
      if (cm && cm[2][0] === fenceChar && cm[2].length >= fenceLen && cm[3].trim() === "") {
        block.push(lines[i]);
        closed = true;
        i++;
        break;
      }
      block.push(lines[i]);
      i++;
    }
    if (closed) blocks.push(block.join("\n"));
  }
  return blocks;
}

function extractUrls(text) {
  return new Set(text.match(URL_RE) || []);
}

function extractPaths(text) {
  return new Set(text.match(PATH_RE) || []);
}

// Regex used only inside extractInlineCodes — matches fences at ANY indentation
// level (^\s* instead of FENCE_OPEN_RE's \s{0,3}). Fences indented 4+ spaces
// appear inside list items in GFM; the strict regex leaves their backticks in
// place, which creates spurious multi-line inline-code spans → false gate failures.
const PERMISSIVE_FENCE_RE = /^\s*(`{3,}|~{3,})/;

function extractInlineCodes(text) {
  // Strip ALL fenced code blocks line-by-line before scanning for inline-code
  // spans. Uses PERMISSIVE_FENCE_RE (any leading whitespace) so fences inside
  // list items (indented 4+ spaces) are removed — the strict FENCE_OPEN_RE used
  // by extractCodeBlocks would leave them in place, letting their backticks form
  // spurious multi-line tokens and trigger false "inline code lost" gate failures.
  const lines = text.split("\n");
  const kept = [];
  let i = 0;
  const n = lines.length;
  while (i < n) {
    const m = lines[i].match(PERMISSIVE_FENCE_RE);
    if (!m) {
      kept.push(lines[i]);
      i++;
      continue;
    }
    const fenceChar = m[1][0];
    const fenceLen = m[1].length;
    i++;
    // Skip lines until matching closing fence (same char, >= same length).
    while (i < n) {
      const cm = lines[i].match(PERMISSIVE_FENCE_RE);
      if (cm && cm[1][0] === fenceChar && cm[1].length >= fenceLen) {
        i++;
        break;
      }
      i++;
    }
  }
  const noFences = kept.join("\n");
  const out = [];
  const re = /`([^`]+)`/g;
  let m2;
  while ((m2 = re.exec(noFences))) out.push(m2[1]);
  return out;
}

function countBullets(text) {
  return (text.match(BULLET_RE) || []).length;
}

function counter(arr) {
  const c = new Map();
  for (const x of arr) c.set(x, (c.get(x) || 0) + 1);
  return c;
}

function arrEq(a, b) {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

function setDiff(a, b) {
  const lost = [...a].filter((x) => !b.has(x));
  const added = [...b].filter((x) => !a.has(x));
  return { lost, added };
}

// Deterministic preservation gate — mirrors caveman-compress validate.py.
// Same 6 checks, same error/warning split. Errors block the commit; warnings
// are informational. Order kept identical to the original for parity.
function validate(orig, comp) {
  const errors = [];
  const warnings = [];

  // 1. Headings: count change blocks; text/order change only warns.
  const h1 = extractHeadings(orig);
  const h2 = extractHeadings(comp);
  if (h1.length !== h2.length) errors.push(`Heading count mismatch: ${h1.length} vs ${h2.length}`);
  else if (!arrEq(h1, h2)) warnings.push("Heading text/order changed");

  // 2. Code blocks: must be byte-identical.
  if (!arrEq(extractCodeBlocks(orig), extractCodeBlocks(comp))) {
    errors.push("Code blocks not preserved exactly");
  }

  // 3. URLs: any lost/added blocks.
  const u = setDiff(extractUrls(orig), extractUrls(comp));
  if (u.lost.length || u.added.length) {
    errors.push(`URL mismatch: lost={${u.lost.join(", ")}}, added={${u.added.join(", ")}}`);
  }

  // 4. Paths: drift only warns (heuristic regex, false positives expected).
  const p = setDiff(extractPaths(orig), extractPaths(comp));
  if (p.lost.length || p.added.length) {
    warnings.push(`Path mismatch: lost={${p.lost.join(", ")}}, added={${p.added.join(", ")}}`);
  }

  // 5. Bullets: >15% drift warns (table/list condensing expected to move it).
  const b1 = countBullets(orig);
  const b2 = countBullets(comp);
  if (b1 > 0 && Math.abs(b1 - b2) / b1 > 0.15) warnings.push(`Bullet count drift: ${b1} -> ${b2}`);

  // 6. Inline code: any lost occurrence blocks; newly-added only warns.
  const ic1 = counter(extractInlineCodes(orig));
  const ic2 = counter(extractInlineCodes(comp));
  const lost = [];
  for (const [k, v] of ic1) {
    const v2 = ic2.get(k) || 0;
    if (v2 < v) lost.push(`\`${k}\` (lost ${v - v2}/${v})`);
  }
  const added = [...ic2.keys()].filter((k) => !ic1.has(k));
  if (lost.length) errors.push(`Inline code lost: ${lost.join(", ")}`);
  if (added.length) warnings.push(`Inline code added: ${added.map((k) => `\`${k}\``).join(", ")}`);

  return { valid: errors.length === 0, errors, warnings };
}

// ---------- file discovery ----------

function listMd(dir) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true })
    .filter((d) => d.isFile() && d.name.endsWith(".md"))
    .map((d) => join(dir, d.name))
    .sort();
}

function listMdRecursive(dir) {
  if (!existsSync(dir)) return [];
  const out = [];
  for (const d of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, d.name);
    if (d.isDirectory()) out.push(...listMdRecursive(p));
    else if (d.name.endsWith(".md")) out.push(p);
  }
  return out.sort();
}

function flag(args, name) {
  const i = args.indexOf(name);
  return i >= 0 && i + 1 < args.length ? args[i + 1] : null;
}

function fail(msg) {
  process.stderr.write(`${msg}\n`);
  process.exit(1);
}

function humanSize(n) {
  if (n < 1024) return `${n}b`;
  return `${(n / 1024).toFixed(1)}KB`;
}

// ---------- enumerate ----------

function cmdEnumerate(args) {
  const root = flag(args, "--root") || process.cwd();
  const claude = join(root, ".claude");
  const fileArg = flag(args, "--file");
  const type = flag(args, "--type");
  const name = flag(args, "--name");
  const all = args.includes("--all");

  let files = [];

  if (fileArg) {
    const p = isAbsolute(fileArg) ? fileArg : resolve(root, fileArg);
    if (!existsSync(p)) fail(`File not found: ${p}`);
    files = [p];
  } else if (all) {
    files = [
      ...listMd(join(claude, "agents")),
      ...listMd(join(claude, "commands")),
      ...listMd(join(claude, "rules")),
    ];
  } else if (type === "agents" || type === "commands" || type === "rules") {
    files = listMd(join(claude, type));
  } else if (type === "skills") {
    // Skills: ONE skill per run. --name is the skill directory under .claude/skills.
    if (!name) fail("--type skills requires --name <skill-dir> (one skill at a time)");
    const skillDir = join(claude, "skills", name);
    if (!existsSync(skillDir)) fail(`Skill not found: ${skillDir}`);
    files = listMdRecursive(skillDir);
  } else {
    fail(
      "enumerate: pass --all | --type <agents|commands|rules|skills> [--name X] | --file <path>",
    );
  }

  // Never feed our own backup sidecars back in.
  files = files.filter((f) => !f.endsWith(".condensed.tmp"));

  // Guardrails (compress.py): refuse sensitive / empty / oversized files.
  // Excluded here so they are never sent to a subagent — note each on stderr
  // (not stdout) so the path list the skill consumes stays clean.
  const rows = [];
  const skipped = [];
  for (const f of files) {
    if (isSensitivePath(f)) {
      skipped.push([f, "sensitive (secret/PII heuristic)"]);
      continue;
    }
    const size = statSync(f).size;
    if (size === 0) {
      skipped.push([f, "empty"]);
      continue;
    }
    if (size > MAX_FILE_SIZE) {
      skipped.push([f, `too large (${size}b > ${MAX_FILE_SIZE}b)`]);
      continue;
    }
    rows.push({ path: f, size });
  }

  // Largest first — biggest prompts have the most to gain from condensing.
  rows.sort((a, b) => b.size - a.size);

  for (const [f, why] of skipped) process.stderr.write(`SKIP ${f} — ${why}\n`);

  // Output: "<bytes>\t<human>\t<path>" per line, already sorted desc.
  const out = rows.map((r) => `${r.size}\t${humanSize(r.size)}\t${r.path}`).join("\n");
  process.stdout.write(out + (rows.length ? "\n" : ""));
}

// ---------- commit ----------

function cmdCommit(args) {
  const files = args.filter((a) => !a.startsWith("--"));
  if (!files.length) fail("commit: pass one or more original file paths");

  const report = [];
  for (const orig of files) {
    const tmp = `${orig}.condensed.tmp`;
    if (!existsSync(orig)) {
      report.push({ file: orig, status: "ERROR", reason: "original missing" });
      continue;
    }
    if (!existsSync(tmp)) {
      report.push({ file: orig, status: "NO_TMP", reason: "no .condensed.tmp sidecar" });
      continue;
    }

    const origText = readFileSync(orig, "utf8");
    // Strip any outer ```markdown fence the subagent wrapped its output in,
    // so a wrapped sidecar doesn't false-fail the code-block gate.
    const compText = stripLlmWrapper(readFileSync(tmp, "utf8"));

    if (!compText.trim()) {
      report.push({ file: orig, status: "BLOCKED", reason: "empty output", tmp });
      continue;
    }
    if (compText.trim() === origText.trim()) {
      unlinkSync(tmp);
      report.push({ file: orig, status: "NOOP", reason: "identical to original" });
      continue;
    }

    const { valid, errors, warnings } = validate(origText, compText);
    if (!valid) {
      report.push({ file: orig, status: "BLOCKED", reason: errors.join("; "), warnings, tmp });
      continue;
    }

    const before = statSync(orig).size;
    writeFileSync(orig, compText);
    const after = Buffer.byteLength(compText);
    unlinkSync(tmp);
    const pct = before > 0 ? Math.round(((before - after) * 100) / before) : 0;
    report.push({ file: orig, status: "OK", before, after, saved: before - after, pct, warnings });
  }

  // Human report
  const line = "─".repeat(60);
  process.stdout.write(`\n${line}\n  condense-harness-prompts — commit report\n${line}\n`);
  for (const r of report) {
    if (r.status === "OK") {
      const w = r.warnings?.length ? `  (warn: ${r.warnings.join(", ")})` : "";
      process.stdout.write(
        `✅ ${r.file}\n   ${r.before}b → ${r.after}b  (-${r.saved}b, ${r.pct}%)${w}\n`,
      );
    } else if (r.status === "BLOCKED") {
      process.stdout.write(`⛔ ${r.file}\n   BLOCKED: ${r.reason}\n   .tmp kept: ${r.tmp}\n`);
    } else if (r.status === "NOOP") {
      process.stdout.write(`➖ ${r.file}\n   ${r.reason} (no change)\n`);
    } else {
      process.stdout.write(`⚠️  ${r.file}\n   ${r.status}: ${r.reason}\n`);
    }
  }
  const ok = report.filter((r) => r.status === "OK").length;
  const blocked = report.filter((r) => r.status === "BLOCKED").length;
  const totalSaved = report.filter((r) => r.status === "OK").reduce((s, r) => s + r.saved, 0);
  process.stdout.write(
    `${line}\n  ${ok} written · ${blocked} blocked · ${totalSaved}b saved\n${line}\n`,
  );

  // Machine summary (last line, JSON) for the skill to parse if needed.
  process.stdout.write("\nJSON " + JSON.stringify(report) + "\n");
}

// ---------- frontmatter validate+fix ----------

async function cmdFrontmatter(args) {
  const files = args.filter((a) => !a.startsWith("--"));
  if (!files.length) fail("frontmatter: pass one or more file paths");

  // Import the aia-harness frontmatter validator. Relative path:
  // skills/condense-harness-prompts/lib/ → 3 levels up → plugin root → lib/validate/.
  // Works both in development and at installed plugin path (~/.claude/plugins/aia-harness/).
  const pluginRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
  const { validateFrontmatter, detectAssetType } = await import(
    join(pluginRoot, "lib/validate/frontmatter.mjs")
  );

  const report = [];
  for (const f of files) {
    if (!existsSync(f)) {
      report.push({ file: f, status: "MISSING" });
      continue;
    }

    const type = detectAssetType(f);
    if (!type) {
      report.push({ file: f, status: "SKIP", reason: "unrecognized artifact type" });
      continue;
    }

    const content = readFileSync(f, "utf8");
    const { valid, errors, warnings, normalized } = validateFrontmatter(content, type);

    if (!valid) {
      writeFileSync(f, normalized);
      report.push({ file: f, status: "FIXED", type, errors, warnings });
    } else if (warnings.length) {
      report.push({ file: f, status: "OK_WARNINGS", type, errors: [], warnings });
    } else {
      report.push({ file: f, status: "OK", type, errors: [], warnings: [] });
    }
  }

  // Human report
  const line = "─".repeat(60);
  process.stdout.write(`\n${line}\n  frontmatter validation + fix report\n${line}\n`);
  let fixed = 0;
  for (const r of report) {
    if (r.status === "FIXED") {
      fixed++;
      process.stdout.write(`🔧 [${r.type}] ${r.file}\n   FIXED: ${r.errors.join("; ")}\n`);
      if (r.warnings.length) process.stdout.write(`   warn: ${r.warnings.join("; ")}\n`);
    } else if (r.status === "OK_WARNINGS") {
      process.stdout.write(`⚠️  [${r.type}] ${r.file}\n   warn: ${r.warnings.join("; ")}\n`);
    } else if (r.status === "OK") {
      process.stdout.write(`✅ [${r.type}] ${r.file}\n`);
    } else {
      process.stdout.write(`➖ ${r.file}  (${r.status}${r.reason ? ": " + r.reason : ""})\n`);
    }
  }
  const ok = report.filter((r) => r.status === "OK").length;
  const warnCount = report.filter((r) => r.status === "OK_WARNINGS").length;
  process.stdout.write(
    `${line}\n  ${fixed} fixed · ${ok} ok · ${warnCount} with warnings\n${line}\n`,
  );

  // Machine summary (last line, JSON) for the command to parse if needed.
  process.stdout.write("\nJSON " + JSON.stringify(report) + "\n");
}

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
