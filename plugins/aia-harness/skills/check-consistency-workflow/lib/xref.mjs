// xref.mjs — check-consistency forward reference resolution: does a mention resolve to a
// real file (dangling) or a real name (uncertain). Reverse resolution — is an artifact
// ever mentioned at all — lives in orphans.mjs; the two share only the fromFiles array
// built here.

import { readFileSync } from "node:fs";
import { absPath, enumerateArtifacts } from "./enumerate.mjs";
import { findOrphans } from "./orphans.mjs";

/** @typedef {import("./enumerate.mjs").EnumerateResult} EnumerateResult */
/** @typedef {import("./orphans.mjs").OrphanEntry} OrphanEntry */

/**
 * @typedef {Object} FromFile
 * @property {string} file     rel path, as it appears in the enumerate result.
 * @property {string} content  Full raw text of the file.
 */

/**
 * @typedef {Object} DanglingEntry
 * @property {string} from
 * @property {number} line
 * @property {string} kind
 * @property {string} mention
 * @property {string} text
 */

/**
 * @typedef {Object} UncertainEntry
 * @property {string} from
 * @property {number} line
 * @property {"name"} kind
 * @property {string} mention
 * @property {string} text
 */

/**
 * @typedef {Object} XrefResult
 * @property {DanglingEntry[]} dangling
 * @property {UncertainEntry[]} uncertain
 * @property {OrphanEntry[]} orphans
 */

/** @param {EnumerateResult} enumerated @returns {Set<string>} */
function collectKnownNames(enumerated) {
  return new Set([
    ...enumerated.skills.map((s) => s.name),
    ...enumerated.agents.map((a) => a.name),
    ...enumerated.rules.map((r) => r.name),
    ...enumerated.commands.map((c) => c.name),
  ]);
}

// Path-shaped references (the only thing allowed into `dangling`).
const PATH_RE = /(?<![\w./-])@?\.claude\/(skills|agents|rules|commands|hooks|scripts)\/[\w./-]+/g;
/** @type {Record<string, string>} */
const KIND_BY_DIR = {
  skills: "skill",
  agents: "agent",
  rules: "rule",
  commands: "command",
  hooks: "script",
  scripts: "script",
};

/**
 * @param {FromFile[]} fromFiles
 * @param {Set<string>} knownFiles
 * @returns {DanglingEntry[]}
 */
function findDangling(fromFiles, knownFiles) {
  /** @type {DanglingEntry[]} */
  const dangling = [];
  for (const { file, content } of fromFiles) {
    content.split("\n").forEach((line, idx) => {
      for (const m of line.matchAll(PATH_RE)) {
        const raw = m[0];
        const stripped = raw.startsWith("@") ? raw.slice(1) : raw;
        // Trailing sentence punctuation ("see foo.md.", "(foo.md)") is not part of the
        // path — PATH_RE's [\w./-]+ class captures a sentence-ending "." into the match
        // since "." is also a legitimate mid-path character (the extension dot). Trim it
        // off before resolving; a file that genuinely ends in one of these characters
        // does not exist in practice, so trimming is always safe, and a real extension
        // dot ("hooks-cross-platform.md") is never at the very end of the raw match, so
        // it's untouched.
        const mention = stripped.replace(/[.,;:)]+$/, "");
        // A path ending in "/" is a directory, not a reference. The "*" check is
        // defensive and currently unreachable: PATH_RE's [\w./-]+ class can't match "*"
        // itself (a match just stops right before it), but keep the guard in case the
        // regex is ever widened to actually capture glob characters.
        if (mention.endsWith("/") || mention.includes("*")) continue;
        // dangling audits actual harness artifacts only — a .md or .mjs file under one of
        // the six artifact directories, which is exactly what enumerate tracks. A .json,
        // .log, or any other extension under the same directories is a runtime output
        // (e.g. a hook's own log file under .claude/hooks/log/), never a trackable
        // artifact, so it's never a dangling-reference candidate in the first place —
        // deliberate, not an accident of the regex.
        if (!/\.(md|mjs)$/.test(mention)) continue;
        if (knownFiles.has(mention)) continue;
        const dir = /** @type {string} */ (m[1]);
        dangling.push({
          from: file,
          line: idx + 1,
          kind: KIND_BY_DIR[dir],
          mention,
          text: line.trim(),
        });
      }
    });
  }
  return dangling;
}

// Name-shaped references (the only thing allowed into `uncertain`).
const BACKTICK_RE = /`([^`\n]+)`/g;
const NAME_RE = /^[a-z0-9][a-z0-9-]{2,}$/;
const RESERVED = new Set(["claude-code", "aia-harness", "check-consistency"]);

/**
 * @param {FromFile[]} fromFiles
 * @param {Set<string>} knownNames
 * @returns {UncertainEntry[]}
 */
function findUncertain(fromFiles, knownNames) {
  /** @type {UncertainEntry[]} */
  const uncertain = [];
  for (const { file, content } of fromFiles) {
    content.split("\n").forEach((line, idx) => {
      for (const m of line.matchAll(BACKTICK_RE)) {
        const token = /** @type {string} */ (m[1]);
        if (!NAME_RE.test(token)) continue;
        if (!token.includes("-")) continue;
        if (RESERVED.has(token)) continue;
        if (knownNames.has(token)) continue;
        uncertain.push({
          from: file,
          line: idx + 1,
          kind: "name",
          mention: token,
          text: line.trim(),
        });
      }
    });
  }
  return uncertain;
}

/**
 * Cross-reference every CLAUDE.md/rule/skill/agent/command file's raw text against the
 * enumerate result: dangling path references, uncertain backticked names, and orphaned
 * artifacts. Calls enumerateArtifacts() — never a second directory walk.
 * @param {string} root  Absolute project root.
 * @returns {Promise<XrefResult>}
 */
export async function xrefArtifacts(root) {
  const enumerated = await enumerateArtifacts(root);

  // Read every "from" file's full text once: claudeMd, rules, skills, agents, commands,
  // and scripts. Scripts are included because a hook importing a shared helper
  // (`import { … } from "./hook-io.mjs"`) is the single most common way a script gets
  // used in this codebase — excluding scripts here was the root cause of high-confidence
  // false-positive orphans (a script imported only by other scripts looked unreferenced).
  const entries = [
    ...enumerated.claudeMd,
    ...enumerated.rules,
    ...enumerated.skills,
    ...enumerated.agents,
    ...enumerated.commands,
    ...enumerated.scripts,
  ];
  /** @type {FromFile[]} */
  const fromFiles = [];
  for (const e of entries) {
    try {
      fromFiles.push({ file: e.file, content: readFileSync(absPath(root, e.file), "utf8") });
    } catch {
      // Enumerated moments ago but gone or unreadable now (deleted mid-run, a permission
      // change) — skip it rather than crash the whole xref run over one file.
    }
  }

  // enumerated.allFiles is the complete walked file list — a strict superset of the four
  // classified artifact lists, since every classified file comes from the same walk — so
  // a mention landing in a skill's references/scripts subdirectory or a nested agent
  // (neither of which enumerate.mjs classifies) still resolves correctly.
  const knownFiles = new Set(enumerated.allFiles);
  const dangling = findDangling(fromFiles, knownFiles);
  const uncertain = findUncertain(fromFiles, collectKnownNames(enumerated));
  const orphans = findOrphans(enumerated, fromFiles);
  return { dangling, uncertain, orphans };
}
