// enumerate.mjs — check-consistency artifact inventory: one collectFiles walk, per-category
// classification, frontmatter reading, and .claude/settings.json hook-script extraction.
// The exported enumerateArtifacts() is the single source of truth both the `enumerate`
// subcommand (check-consistency.mjs) and xref.mjs's reference resolution build on — never a
// second directory walk.
//
// Reuses the aia-harness engine's own pure helpers via dynamic import (same precedent as
// skills/revise-agent-routing-workflow/lib/revise-agent-routing.mjs) instead of duplicating
// their logic.

import { readFileSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

// skills/<any-skill-name>/lib/ → 3 levels up → plugin root → lib/... . Same computation
// as revise-agent-routing.mjs (name-agnostic, survives a skill rename).
const PLUGIN_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");

// ---------- types ----------

/** @typedef {import("../../../lib/util/fs.mjs").CollectedFile} CollectedFile */

/**
 * @typedef {Object} FrontmatterEntry
 * @property {string} key
 * @property {string} value
 */

/**
 * @typedef {Object} SkillEntry
 * @property {string} file
 * @property {string} name
 * @property {string} description
 */

/**
 * @typedef {Object} AgentEntry
 * @property {string} file
 * @property {string} name
 * @property {string} description
 */

/**
 * @typedef {Object} RuleEntry
 * @property {string} file
 * @property {string} name
 */

/**
 * @typedef {Object} CommandEntry
 * @property {string} file
 * @property {string} name
 */

/**
 * @typedef {Object} ScriptEntry
 * @property {string} file
 */

/**
 * @typedef {Object} ClaudeMdEntry
 * @property {string} file
 */

/**
 * @typedef {Object} SettingsHookScript
 * @property {string | null} event
 * @property {string} script
 */

/**
 * @typedef {Object} EnumerateResult
 * @property {string} root
 * @property {boolean} truncated    True when collectFiles hit its file cap — the walk (and
 *   therefore every list below, including allFiles) is incomplete. Same field name as
 *   `scan --json`'s ProjectProfile, same meaning.
 * @property {SkillEntry[]} skills
 * @property {AgentEntry[]} agents
 * @property {RuleEntry[]} rules
 * @property {CommandEntry[]} commands
 * @property {ScriptEntry[]} scripts
 * @property {ClaudeMdEntry[]} claudeMd
 * @property {SettingsHookScript[]} settingsHookScripts
 * @property {string[]} allFiles     Every relative path collectFiles walked, unclassified —
 *   not just the four artifact lists above. A skill's `references/`/`scripts/` files, a
 *   nested agent, or any other file this classifier doesn't have a bucket for is still in
 *   here. xref.mjs's dangling check resolves a mention against this set too, so a real
 *   file outside the classified shapes is never reported as missing. In-process only:
 *   `check-consistency.mjs`'s `enumerate` subcommand strips this field before writing to
 *   stdout (it can be huge on a real project) — it never appears in that CLI's own output.
 */

// ---------- small shared helpers ----------

/**
 * Build a real, platform-correct path from a POSIX-separated `rel` (as returned by
 * collectFiles) — never string-concatenate or pass `rel` straight to `join`. Exported:
 * xref.mjs needs the same conversion to read the same files.
 * @param {string} root
 * @param {string} rel
 * @returns {string}
 */
export function absPath(root, rel) {
  return join(root, ...rel.split("/"));
}

/**
 * @param {FrontmatterEntry[]} entries
 * @param {string} key
 * @returns {string | undefined}
 */
function fmValue(entries, key) {
  return entries.find((e) => e.key === key)?.value;
}

// ---------- enumerate (shared by both subcommands) ----------

const SKILL_RE = /^\.claude\/skills\/([^/]+)\/SKILL\.md$/;
const AGENT_RE = /^\.claude\/agents\/([^/]+)\.md$/;
const RULES_PREFIX = ".claude/rules/";
const COMMANDS_PREFIX = ".claude/commands/";
const HOOKS_PREFIX = ".claude/hooks/";
const SCRIPTS_PREFIX = ".claude/scripts/";

/**
 * Walk `root` once with the engine's own collector and categorize every artifact.
 * Both `enumerate` and `xref` call this — never a second directory walk.
 * @param {string} root  Absolute project root.
 * @returns {Promise<EnumerateResult>}
 */
export async function enumerateArtifacts(root) {
  // Node's ESM loader parses the import() specifier as a URL. A raw Windows absolute
  // path (e.g. "C:\...") parses the drive letter as the URL scheme and throws
  // ERR_UNSUPPORTED_ESM_URL_SCHEME — pathToFileURL().href is Node's documented fix.
  const { collectFiles } = await import(pathToFileURL(join(PLUGIN_ROOT, "lib/util/fs.mjs")).href);
  const { splitFrontmatter } = await import(
    pathToFileURL(join(PLUGIN_ROOT, "lib/ecc/transform.mjs")).href
  );
  const { parseFrontmatter } = await import(
    pathToFileURL(join(PLUGIN_ROOT, "lib/util/frontmatter-yaml.mjs")).href
  );

  /** @type {{ files: CollectedFile[], dirs: Set<string>, truncated: boolean }} */
  const { files, truncated } = collectFiles(root, {});

  /**
   * Frontmatter entries for a file, or [] when there is no frontmatter block —
   * the file still enumerates, falling back to the path-derived name.
   * @param {string} rel
   * @returns {FrontmatterEntry[]}
   */
  function readEntry(rel) {
    try {
      const content = readFileSync(absPath(root, rel), "utf8");
      /** @type {{ frontmatter: string, body: string }} */
      const { frontmatter } = splitFrontmatter(content);
      return frontmatter ? parseFrontmatter(frontmatter) : [];
    } catch {
      // Deleted or unreadable between the walk and this read (rare, but real on a live
      // project) — fall back exactly like "no frontmatter block": the file still
      // enumerates under its path-derived name, the whole run doesn't crash over one file.
      return [];
    }
  }

  /** @type {SkillEntry[]} */
  const skills = [];
  /** @type {AgentEntry[]} */
  const agents = [];
  /** @type {RuleEntry[]} */
  const rules = [];
  /** @type {CommandEntry[]} */
  const commands = [];
  /** @type {ScriptEntry[]} */
  const scripts = [];
  /** @type {ClaudeMdEntry[]} */
  const claudeMd = [];

  for (const f of files) {
    const rel = f.rel;
    const skillMatch = rel.match(SKILL_RE);
    const agentMatch = rel.match(AGENT_RE);
    if (skillMatch) {
      const dirName = /** @type {string} */ (skillMatch[1]);
      const entries = readEntry(rel);
      skills.push({
        file: rel,
        name: fmValue(entries, "name") || dirName,
        description: fmValue(entries, "description") || "",
      });
    } else if (agentMatch) {
      const stem = /** @type {string} */ (agentMatch[1]);
      const entries = readEntry(rel);
      agents.push({
        file: rel,
        name: fmValue(entries, "name") || stem,
        description: fmValue(entries, "description") || "",
      });
    } else if (rel.startsWith(RULES_PREFIX) && rel.endsWith(".md")) {
      rules.push({ file: rel, name: rel.slice(RULES_PREFIX.length, -3) });
    } else if (rel.startsWith(COMMANDS_PREFIX) && rel.endsWith(".md")) {
      commands.push({ file: rel, name: rel.slice(COMMANDS_PREFIX.length, -3) });
    } else if (
      (rel.startsWith(HOOKS_PREFIX) || rel.startsWith(SCRIPTS_PREFIX)) &&
      f.ext === ".mjs"
    ) {
      scripts.push({ file: rel });
    }
    if (f.base === "CLAUDE.md") claudeMd.push({ file: rel });
  }

  return {
    root,
    // Early on purpose: on the one project where truncation actually fires (the oversized
    // one), this is the field most worth surviving an output cap — allFiles below is the
    // largest field in this object by far, so anything downstream that only reads the
    // first N bytes should still see this.
    truncated,
    skills,
    agents,
    rules,
    commands,
    scripts,
    claudeMd,
    settingsHookScripts: readSettingsHookScripts(root),
    allFiles: files.map((f) => f.rel),
  };
}

// ---------- settingsHookScripts ----------

// Matches a forward-slash path exactly as the harness itself always generates it
// (renderSettings, the vendored hook installers) — a hand-written settings.json using a
// literal Windows backslash path would not match. Every other path comparison in this
// module works off collectFiles's POSIX-normalized `rel`, so this is the one spot that
// reads a raw string straight from user-authored JSON without normalizing it first.
const SETTINGS_SCRIPT_RE = /\.claude\/(?:hooks|scripts)\/[\w./-]+\.mjs/g;

/**
 * Parse a .claude/*.json settings file, tolerating absence and a syntax error (both
 * yield null).
 * @param {string} root
 * @param {string} filename
 * @returns {unknown}
 */
function readSettingsJson(root, filename) {
  try {
    return JSON.parse(readFileSync(join(root, ".claude", filename), "utf8"));
  } catch {
    return null;
  }
}

/**
 * Every `.claude/(hooks|scripts)/….mjs` path string found anywhere inside
 * .claude/settings.json **and** .claude/settings.local.json, paired with the top-level
 * `hooks` event key it was found under (null when found outside the top-level `hooks`
 * object). Both files are scanned because Claude Code merges them at runtime — a hook
 * wired only in the gitignored settings.local.json (a personal-only hook) is still
 * genuinely active; reading settings.json alone would make it look unwired and report a
 * false orphan.
 * @param {string} root
 * @returns {SettingsHookScript[]}
 */
function readSettingsHookScripts(root) {
  /** @type {SettingsHookScript[]} */
  const results = [];

  /**
   * @param {unknown} node
   * @param {string | null} event
   * @returns {void}
   */
  function visit(node, event) {
    if (typeof node === "string") {
      for (const m of node.matchAll(SETTINGS_SCRIPT_RE)) results.push({ event, script: m[0] });
      return;
    }
    if (Array.isArray(node)) {
      for (const item of node) visit(item, event);
      return;
    }
    if (node && typeof node === "object") {
      for (const value of Object.values(node)) visit(value, event);
    }
  }

  for (const filename of ["settings.json", "settings.local.json"]) {
    const data = readSettingsJson(root, filename);
    if (!data || typeof data !== "object" || Array.isArray(data)) continue;
    for (const [key, value] of Object.entries(data)) {
      if (key === "hooks" && value && typeof value === "object" && !Array.isArray(value)) {
        for (const [eventName, eventValue] of Object.entries(value)) visit(eventValue, eventName);
      } else {
        visit(value, null);
      }
    }
  }

  return results;
}
