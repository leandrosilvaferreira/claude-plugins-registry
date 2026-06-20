/**
 * Pure transforms applied to ag-kit files when vendoring them into
 * templates/ag-kit/. ag-kit targets Antigravity, so frontmatters are
 * converted to Claude Code conventions. No IO here -> unit-testable.
 *
 * @module agkit/transform
 */
import { splitFrontmatter } from "../ecc/transform.mjs";

/** Antigravity agent tools that map onto a Claude Code equivalent. */
const AGENT_TOOL_MAP = /** @type {Record<string,string>} */ ({ FindByName: "Glob", Agent: "Task" });
/** Antigravity-only tools with no Claude Code equivalent -> dropped. */
const AGENT_TOOL_DROP = new Set(["ViewCodeItem"]);
/** Tools a Claude Code subagent may declare. Unknown tools are dropped. */
const CLAUDE_AGENT_TOOLS = new Set([
  "Read", "Write", "Edit", "Grep", "Glob", "Bash",
  "WebFetch", "WebSearch", "TodoWrite", "NotebookEdit", "Task",
]);

/** @param {string} sourcePath @param {string} commit @returns {string} */
function provenanceComment(sourcePath, commit) {
  return `<!-- Vendored from ag-kit (github.com/vudovn/ag-kit) @ ${commit} :: ${sourcePath}. MIT (c) vudovn. -->\n`;
}

/** @param {string} v @returns {string} */
function unquote(v) {
  const t = v.trim();
  if ((t.startsWith('"') && t.endsWith('"')) || (t.startsWith("'") && t.endsWith("'"))) {
    return t.slice(1, -1);
  }
  return t;
}

/** @param {string} v @returns {boolean} */
function needsQuote(v) {
  return /:\s/.test(v) || /^[\s"'#&*!|>%@`]/.test(v) || v.includes('"');
}

/** @param {string} v @returns {string} */
function quoteIfNeeded(v) {
  return needsQuote(v) ? `"${v.replace(/"/g, '\\"')}"` : v;
}

/**
 * Parse a flat YAML frontmatter block into ordered entries. Assumes one
 * `key: value` per line (true for ag-kit agent/skill/workflow frontmatters).
 * @param {string} frontmatter  Includes the --- fences.
 * @returns {{ key: string, value: string }[]}
 */
export function parseFrontmatter(frontmatter) {
  /** @type {{ key: string, value: string }[]} */
  const entries = [];
  for (const line of frontmatter.split("\n")) {
    if (line === "---" || line.trim() === "") continue;
    const m = line.match(/^([A-Za-z0-9_-]+):\s?(.*)$/);
    if (m) entries.push({ key: m[1], value: m[2] });
  }
  return entries;
}

/**
 * @param {{ key: string, value: string }[]} entries
 * @returns {string}  Frontmatter block including --- fences and trailing newline.
 */
export function renderFrontmatter(entries) {
  const body = entries.map((e) => `${e.key}: ${quoteIfNeeded(e.value)}`).join("\n");
  return `---\n${body}\n---\n`;
}

/**
 * Convert an ag-kit agent `tools:` value to Claude Code tool names: map known
 * Antigravity tools, drop unknown/unsupported ones, dedupe, preserve order.
 * @param {string} value
 * @returns {string}
 */
export function mapAgentTools(value) {
  /** @type {string[]} */
  const out = [];
  for (const raw of value.split(",").map((t) => t.trim()).filter(Boolean)) {
    if (AGENT_TOOL_DROP.has(raw)) continue;
    const mapped = AGENT_TOOL_MAP[raw] ?? raw;
    if (!CLAUDE_AGENT_TOOLS.has(mapped)) continue;
    if (!out.includes(mapped)) out.push(mapped);
  }
  return out.join(", ");
}

/**
 * Convert an ag-kit agent markdown for Claude Code: drop `skills:`, force
 * `model: sonnet`, rewrite `tools:`, stamp provenance.
 * @param {string} content
 * @param {{ sourcePath: string, commit: string }} meta
 * @returns {string}
 */
export function cleanAgentMarkdown(content, meta) {
  const { frontmatter, body } = splitFrontmatter(content);
  const entries = parseFrontmatter(frontmatter).filter((e) => e.key !== "skills" && e.key !== "model");
  for (const e of entries) {
    if (e.key === "tools") e.value = mapAgentTools(e.value);
  }
  entries.push({ key: "model", value: "sonnet" });
  const fm = renderFrontmatter(entries);
  return `${fm}${provenanceComment(meta.sourcePath, meta.commit)}\n${body.replace(/^\n+/, "")}`;
}

/**
 * Convert an ag-kit SKILL.md for Claude Code: fold `when_to_use` into
 * `description` (Claude Code triggers on description, ignores when_to_use),
 * drop the when_to_use key, keep name/allowed-tools, stamp provenance.
 * @param {string} content
 * @param {{ sourcePath: string, commit: string }} meta
 * @returns {string}
 */
export function cleanSkillMarkdown(content, meta) {
  const { frontmatter, body } = splitFrontmatter(content);
  const entries = parseFrontmatter(frontmatter);
  const whenIdx = entries.findIndex((e) => e.key === "when_to_use");
  const descIdx = entries.findIndex((e) => e.key === "description");
  if (whenIdx !== -1) {
    const when = unquote(entries[whenIdx].value);
    if (descIdx !== -1 && when) {
      const desc = unquote(entries[descIdx].value);
      entries[descIdx].value = `${desc} ${when}`.trim();
    }
    entries.splice(whenIdx, 1);
  }
  const fm = renderFrontmatter(entries);
  return `${fm}${provenanceComment(meta.sourcePath, meta.commit)}\n${body.replace(/^\n+/, "")}`;
}

/**
 * Stamp any markdown file with provenance after its optional frontmatter.
 * Works with or without a frontmatter block.
 * @param {string} content
 * @param {{ sourcePath: string, commit: string }} meta
 * @returns {string}
 */
export function stampMarkdown(content, meta) {
  const { frontmatter, body } = splitFrontmatter(content);
  return `${frontmatter}${provenanceComment(meta.sourcePath, meta.commit)}\n${body.replace(/^\n+/, "")}`;
}

/**
 * Keep a command verbatim (already Claude-Code-shaped: $ARGUMENTS, description
 * frontmatter) but stamp provenance after the frontmatter.
 * @param {string} content
 * @param {{ sourcePath: string, commit: string }} meta
 * @returns {string}
 */
export function cleanCommandMarkdown(content, meta) {
  return stampMarkdown(content, meta);
}

/**
 * Strip "AG Kit" branding from a Python helper and stamp provenance (after the
 * shebang if present).
 * @param {string} content
 * @param {{ sourcePath: string, commit: string }} meta
 * @returns {string}
 */
export function cleanScript(content, meta) {
  const stripped = content.replace(/ ?- ?AG Kit/g, "").replace(/AG Kit/g, "ag-kit");
  const prov = `# Vendored from ag-kit (github.com/vudovn/ag-kit) @ ${meta.commit} :: ${meta.sourcePath}. MIT (c) vudovn.\n`;
  if (stripped.startsWith("#!")) {
    const nl = stripped.indexOf("\n");
    return stripped.slice(0, nl + 1) + prov + stripped.slice(nl + 1);
  }
  return prov + stripped;
}
