// commit.mjs — condense-harness-prompts `commit` subcommand: validate each
// <file>.condensed.tmp sidecar against its original; overwrite on pass, keep .tmp on fail.
// Pure move out of condense.mjs — see condense.mjs's header for the full subcommand list.
//
// Gate is a JS port of the caveman-compress plugin validate.py:
// blocks (error) on lost code blocks / URLs / inline-code / heading-count;
// warns (non-blocking) on heading-text reorder / bullet drift / path drift.

import { readFileSync, writeFileSync, existsSync, unlinkSync, statSync } from "node:fs";
import { fail } from "./cli.mjs";

// Strip an outer ```markdown … ``` fence the subagent may wrap its whole
// output in. Without this, a wrapped sidecar would fail the code-block gate
// as a false positive (it looks like an extra code block).
const OUTER_FENCE_RE = /^\s*(`{3,}|~{3,})[^\n]*\n([\s\S]*)\n\1\s*$/;
/** @param {string} text @returns {string} */
function stripLlmWrapper(text) {
  const m = text.match(OUTER_FENCE_RE);
  return m ? m[2] : text;
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

/** @param {string} text @returns {string[]} */
function extractHeadings(text) {
  const out = [];
  HEADING_RE.lastIndex = 0;
  let m;
  while ((m = HEADING_RE.exec(text))) out.push(`${m[1]} ${m[2].trim()}`);
  return out;
}

// Line-based fenced block extractor: ``` or ~~~, variable length, nested.
/** @param {string} text @returns {string[]} */
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

/** @param {string} text @returns {Set<string>} */
function extractUrls(text) {
  return new Set(text.match(URL_RE) || []);
}

/** @param {string} text @returns {Set<string>} */
function extractPaths(text) {
  return new Set(text.match(PATH_RE) || []);
}

// Regex used only inside extractInlineCodes — matches fences at ANY indentation
// level (^\s* instead of FENCE_OPEN_RE's \s{0,3}). Fences indented 4+ spaces
// appear inside list items in GFM; the strict regex leaves their backticks in
// place, which creates spurious multi-line inline-code spans → false gate failures.
const PERMISSIVE_FENCE_RE = /^\s*(`{3,}|~{3,})/;

/** @param {string} text @returns {string[]} */
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

/** @param {string} text @returns {number} */
function countBullets(text) {
  return (text.match(BULLET_RE) || []).length;
}

/** @param {string[]} arr @returns {Map<string, number>} */
function counter(arr) {
  const c = new Map();
  for (const x of arr) c.set(x, (c.get(x) || 0) + 1);
  return c;
}

/** @param {unknown[]} a @param {unknown[]} b @returns {boolean} */
function arrEq(a, b) {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

/** @param {Set<string>} a @param {Set<string>} b @returns {{ lost: string[], added: string[] }} */
function setDiff(a, b) {
  const lost = [...a].filter((x) => !b.has(x));
  const added = [...b].filter((x) => !a.has(x));
  return { lost, added };
}

// Deterministic preservation gate — mirrors caveman-compress validate.py.
// Same 6 checks, same error/warning split. Errors block the commit; warnings
// are informational. Order kept identical to the original for parity.
/** @param {string} orig @param {string} comp @returns {{ valid: boolean, errors: string[], warnings: string[] }} */
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

// ---------- commit ----------

/** @param {string[]} args */
export function cmdCommit(args) {
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
  const totalSaved = report
    .filter((r) => r.status === "OK")
    .reduce((s, r) => s + (r.saved ?? 0), 0);
  process.stdout.write(
    `${line}\n  ${ok} written · ${blocked} blocked · ${totalSaved}b saved\n${line}\n`,
  );

  // Machine summary (last line, JSON) for the skill to parse if needed.
  process.stdout.write("\nJSON " + JSON.stringify(report) + "\n");
}
