// orphans.mjs — check-consistency reverse reference resolution: is an artifact ever
// mentioned at all (a script wired or imported, a skill/agent/rule/command named or
// pathed anywhere). Split out of xref.mjs, which owns forward resolution (does a mention
// resolve to something real) — the two share only the fromFiles array xrefArtifacts
// builds.

import { basename } from "node:path";

/** @typedef {import("./enumerate.mjs").EnumerateResult} EnumerateResult */
/** @typedef {import("./enumerate.mjs").ScriptEntry} ScriptEntry */
/** @typedef {import("./xref.mjs").FromFile} FromFile */

/**
 * @typedef {Object} OrphanEntry
 * @property {string} file
 * @property {string} kind
 * @property {"high" | "low"} confidence
 * @property {string} reason
 */

/** @param {string} s @returns {string} */
function escapeRegExp(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Basenames shared by 2+ enumerated scripts. A bare-basename mention of one of these names
 * can't tell which file it means, so it must never be trusted to clear either one — the
 * whole point of the basename shortcut (below) is that an unambiguous name is a safe
 * stand-in for the full path, and that stops being true the moment a second file claims
 * the same name.
 * @param {ScriptEntry[]} scripts
 * @returns {Set<string>}
 */
function ambiguousBasenames(scripts) {
  /** @type {Map<string, number>} */
  const counts = new Map();
  for (const s of scripts) {
    const base = basename(s.file);
    counts.set(base, (counts.get(base) ?? 0) + 1);
  }
  return new Set([...counts].filter(([, n]) => n > 1).map(([base]) => base));
}

/**
 * A script counts as referenced if it's wired in settings.json, OR another scanned file
 * (scripts included) contains its full path, OR — only when its basename is unique among
 * all enumerated scripts — contains that basename as a whole token. Real mentions are
 * almost always by basename (a relative import, a spawn path built from segments, CLAUDE.md
 * prose), never the full `.claude/hooks/…` path, but a basename isn't unique across the
 * tree: trusting it unconditionally can silently clear the WRONG same-named file (a mention
 * of `.claude/hooks/log.mjs` contains "log.mjs", which would also satisfy
 * `.claude/scripts/util/log.mjs`'s basename check even though nothing points at it).
 * `ambiguousBasenames` computes the unsafe set once; an ambiguous script falls back to
 * full-path-only — a missed true positive there is silent and undiscoverable, while an
 * ambiguous name still being reported is merely conservative, so that's the deliberate
 * fallback direction. A tighter reference *shape* (`./name`, a backtick) doesn't solve
 * this: a "properly shaped" reference to `log.mjs` is exactly as ambiguous as a bare one
 * when two files share that name — only knowing the name is unique can disambiguate.
 * The word-boundary regex stops a short basename (`log.mjs`) from matching inside a longer
 * one (`session-log.mjs`). The script's own file is excluded so a self-descriptive header
 * comment can't make it look referenced when nothing else points at it. The full-path
 * check assumes forward slashes (true for anything the harness itself writes); the
 * basename check is slash-agnostic and still catches a hand-written Windows path.
 * @param {ScriptEntry} script
 * @param {FromFile[]} fromFiles
 * @param {Set<string>} wiredScripts
 * @param {Set<string>} ambiguousBasenameSet
 * @returns {boolean}
 */
function isScriptReferenced(script, fromFiles, wiredScripts, ambiguousBasenameSet) {
  if (wiredScripts.has(script.file)) return true;
  const base = basename(script.file);
  const trustBasename = !ambiguousBasenameSet.has(base);
  const baseRe = new RegExp(`(?<![\\w-])${escapeRegExp(base)}(?![\\w-])`);
  return fromFiles.some(
    ({ file, content }) =>
      file !== script.file &&
      (content.includes(script.file) || (trustBasename && baseRe.test(content))),
  );
}

/**
 * @param {EnumerateResult} enumerated
 * @param {FromFile[]} fromFiles
 * @returns {OrphanEntry[]}
 */
export function findOrphans(enumerated, fromFiles) {
  /** @type {OrphanEntry[]} */
  const orphans = [];
  const wiredScripts = new Set(enumerated.settingsHookScripts.map((s) => s.script));
  const ambiguous = ambiguousBasenames(enumerated.scripts);

  for (const s of enumerated.scripts) {
    if (!isScriptReferenced(s, fromFiles, wiredScripts, ambiguous)) {
      orphans.push({
        file: s.file,
        kind: "script",
        confidence: "high",
        reason:
          "not wired in .claude/settings.json and not mentioned by path or basename in any scanned file",
      });
    }
  }

  /** @type {{ list: { file: string, name: string }[], kind: string }[]} */
  const artifactGroups = [
    { list: enumerated.skills, kind: "skill" },
    { list: enumerated.agents, kind: "agent" },
    { list: enumerated.rules, kind: "rule" },
    { list: enumerated.commands, kind: "command" },
  ];
  for (const { list, kind } of artifactGroups) {
    for (const item of list) {
      // Excludes the artifact's own file, same reasoning as isScriptReferenced above: a
      // SKILL.md's frontmatter always contains `name: <its own name>`, so without this
      // exclusion every skill/agent would trivially clear itself and `orphans` could
      // never report one — exactly the false negative that made this slice empty by
      // construction before this fix.
      const mentioned = fromFiles.some(
        ({ file, content }) =>
          file !== item.file && (content.includes(item.name) || content.includes(item.file)),
      );
      if (!mentioned) {
        orphans.push({
          file: item.file,
          kind,
          confidence: "low",
          reason:
            "not referenced by name or path in any scanned file (auto-discovered by Claude Code)",
        });
      }
    }
  }

  return orphans;
}
