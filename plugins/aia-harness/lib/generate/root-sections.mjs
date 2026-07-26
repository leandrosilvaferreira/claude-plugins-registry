/**
 * Single source of truth for which sections belong in a target project's root
 * `CLAUDE.md`, plus a pure audit comparing a target's CURRENT root file
 * against that manifest. Consumed by `/aia-harness:doctor` to report missing
 * sections and how to fix each (CLI wiring is a separate, later change).
 *
 * @module generate/root-sections
 */

import { BEHAVIORAL_MARKER, FIXED_RULES_MARKER } from "./claude-md.mjs";
import { AGENT_ROUTING_MARKER, PARALLEL_SDD_MARKER } from "./claude-md-agents.mjs";
import { GRAPHIFY_ROOT_MARKER } from "./misc.mjs";

/**
 * Sentinel comment marking the root-CLAUDE.md obsidian-vault section. Defined
 * here rather than in a `render*()` function because the obsidian root section
 * is a static template (`templates/tools/obsidian/claude-md-section.md`), not
 * generated code — this constant and that template's marker line MUST match
 * byte-for-byte (enforced by a later integrity test).
 */
export const OBSIDIAN_ROOT_MARKER =
  "<!-- aia-harness:obsidian-root — vault memory pillar; merged section, do not remove -->";

/**
 * @typedef {Object} RootClaudeMdSection
 * @property {string} id        Stable identifier for this section.
 * @property {string} label     Human-readable name.
 * @property {string} heading   Verbatim heading (or `@`-import line) that identifies the
 *   section in a root CLAUDE.md. Detection is a full-line (trimmed) match — same mechanism
 *   for headings and the `@`-import line, no special-casing.
 * @property {string} [marker]  Sentinel HTML comment guarding the section, when one exists.
 * @property {boolean} required Whether a project missing this section (while it applies) is
 *   non-compliant vs merely incomplete.
 * @property {'render'|'graphify'|'obsidian'} source  Where the section comes from: rendered
 *   into the base root CLAUDE.md, the graphify merge-section, or the obsidian merge-section.
 * @property {'force-root'|'merge:claude-md:graphify-root'|'command:/aia-harness:add-obsidian'} fix
 *   How to remediate a missing section. Each value names the remediation *unit*, never a
 *   CLI flag: `force-root` means the whole base-generated root file is what has to be
 *   re-applied (as opposed to one merge-section id, or running another command). Its
 *   only consumer, `/aia-harness:doctor`, acts on it with
 *   `apply --merge --only=claude-md-root` plus conflict adjudication — never with
 *   `--force`, which would wipe the project's `/aia-harness:init` enrichment.
 */

/**
 * Ordered, in-root-file-order manifest of every section a scaffolded root
 * `CLAUDE.md` should contain. Single source of truth for
 * `auditRootClaudeMdSections()` and any future doctor/CLI reporting.
 * @type {RootClaudeMdSection[]}
 */
export const ROOT_CLAUDE_MD_SECTIONS = [
  {
    id: "behavioral",
    label: "Behavioral guidelines",
    heading: "## Behavioral guidelines",
    marker: BEHAVIORAL_MARKER,
    required: true,
    source: "render",
    fix: "force-root",
  },
  {
    id: "stack",
    label: "Stack",
    heading: "## Stack",
    required: true,
    source: "render",
    fix: "force-root",
  },
  {
    id: "canonical-commands",
    label: "Canonical commands",
    heading: "## Canonical commands",
    required: true,
    source: "render",
    fix: "force-root",
  },
  {
    id: "skills",
    label: "Skills — for this stack",
    heading: "## Skills — for this stack",
    required: false,
    source: "render",
    fix: "force-root",
  },
  {
    id: "workflow-agents",
    label: "Workflow & Agents",
    heading: "## Workflow & Agents",
    required: false,
    source: "render",
    fix: "force-root",
  },
  {
    id: "agent-routing",
    label: "Superpowers → Project Specialists (mandatory bridging)",
    heading: "### Superpowers → Project Specialists (mandatory bridging)",
    marker: AGENT_ROUTING_MARKER,
    required: false,
    source: "render",
    fix: "force-root",
  },
  {
    id: "parallel-sdd",
    label: "Parallel wave execution (subagent-driven-development)",
    heading: "### Parallel wave execution (subagent-driven-development)",
    marker: PARALLEL_SDD_MARKER,
    required: false,
    source: "render",
    fix: "force-root",
  },
  {
    id: "architecture-map",
    label: "Architecture map",
    heading: "## Architecture map",
    required: true,
    source: "render",
    fix: "force-root",
  },
  {
    id: "conventions",
    label: "Conventions",
    heading: "## Conventions",
    required: true,
    source: "render",
    fix: "force-root",
  },
  {
    id: "engineering-rules",
    label: "Engineering rules",
    heading: "## Engineering rules",
    marker: FIXED_RULES_MARKER,
    required: true,
    source: "render",
    fix: "force-root",
  },
  {
    id: "memory-imports",
    label: "Memory imports",
    heading: "@.claude/memory/MEMORY.md",
    required: true,
    source: "render",
    fix: "force-root",
  },
  {
    id: "graphify",
    label: "graphify",
    heading: "## graphify",
    marker: GRAPHIFY_ROOT_MARKER,
    required: false,
    source: "graphify",
    fix: "merge:claude-md:graphify-root",
  },
  {
    id: "obsidian",
    // Heading is H2 (`## `) — the canonical level for a root-CLAUDE.md section,
    // matching the template that merges it
    // (`templates/tools/obsidian/claude-md-section.md`) and the `## graphify`
    // section. The marker is the level-robust detector; the heading is the
    // fallback for installs that predate the marker.
    label: "obsidian-vault",
    heading: "## obsidian-vault",
    marker: OBSIDIAN_ROOT_MARKER,
    required: false,
    source: "obsidian",
    fix: "command:/aia-harness:add-obsidian",
  },
];

/** @typedef {Pick<RootClaudeMdSection, "id"|"label"|"required"|"source"|"fix">} RootSectionMissing */

/**
 * @typedef {Object} RootSectionAuditResult
 * @property {RootSectionMissing[]} missing  Expected sections not found in `existingContent`.
 * @property {string[]} present              ids of expected sections found in `existingContent`.
 * @property {string[]} notApplicable        ids of sections that don't apply to this project.
 */

/**
 * True when `needle` appears as a full line (ignoring leading/trailing
 * whitespace) of `content`. Full-line matching (not loose substring) so a
 * heading mentioned inside prose/an AI-ENRICH comment, or a heading that is a
 * prefix of a longer one (`## Stack` vs `## Stacked`), never counts as present.
 * @param {string} content
 * @param {string} needle
 * @returns {boolean}
 */
function hasLine(content, needle) {
  return content.split(/\r?\n/).some((line) => line.trim() === needle);
}

/**
 * Pure audit of a target project's root `CLAUDE.md` against
 * `ROOT_CLAUDE_MD_SECTIONS`. Deterministic — no IO, no `Date.now`/`Math.random` —
 * the same inputs always produce the same result. Preserves manifest order in
 * every output array.
 *
 * @param {Object} params
 * @param {string} params.freshContent    Freshly generated root file content (the plan's
 *   `claude-md-root` artifact content); decides whether a `render`-sourced section applies
 *   to this project. `""` is allowed.
 * @param {string} params.existingContent The target project's CURRENT root CLAUDE.md
 *   content, or `""` if the file doesn't exist yet.
 * @param {{ graphify: boolean, obsidian: boolean }} params.installed  Whether the graphify /
 *   obsidian pillars are installed in the target project.
 * @returns {RootSectionAuditResult}
 */
export function auditRootClaudeMdSections({ freshContent, existingContent, installed }) {
  /** @type {RootSectionMissing[]} */
  const missing = [];
  /** @type {string[]} */
  const present = [];
  /** @type {string[]} */
  const notApplicable = [];

  for (const entry of ROOT_CLAUDE_MD_SECTIONS) {
    const detect = entry.marker ?? entry.heading;
    const expected =
      entry.source === "render"
        ? hasLine(freshContent, detect)
        : entry.source === "graphify"
          ? installed.graphify === true
          : installed.obsidian === true;

    if (!expected) {
      notApplicable.push(entry.id);
      continue;
    }

    const isPresent =
      hasLine(existingContent, entry.heading) ||
      (entry.marker ? hasLine(existingContent, entry.marker) : false);

    if (isPresent) {
      present.push(entry.id);
    } else {
      missing.push({
        id: entry.id,
        label: entry.label,
        required: entry.required,
        source: entry.source,
        fix: entry.fix,
      });
    }
  }

  return { missing, present, notApplicable };
}
