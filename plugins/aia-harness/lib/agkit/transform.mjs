/**
 * Pure transforms applied to ag-kit files when vendoring them into
 * templates/ag-kit/. ag-kit targets Antigravity, so frontmatters are
 * converted to Claude Code conventions. No IO here -> unit-testable.
 *
 * @module agkit/transform
 */
import { splitFrontmatter } from "../ecc/transform.mjs";
import { normalizeToolsValue } from "../validate/frontmatter.mjs";
import { parseFrontmatter, renderFrontmatter } from "../util/frontmatter-yaml.mjs";
import { applyCanonicalDescription } from "../validate/agent-description.mjs";

export { parseFrontmatter, renderFrontmatter };

/** Antigravity agent tools that map onto a Claude Code equivalent. */
const AGENT_TOOL_MAP = /** @type {Record<string,string>} */ ({ FindByName: "Glob", Agent: "Task" });
/** Antigravity-only tools with no Claude Code equivalent -> dropped. */
const AGENT_TOOL_DROP = new Set(["ViewCodeItem"]);
/** Tools a Claude Code subagent may declare. Unknown tools are dropped. */
const CLAUDE_AGENT_TOOLS = new Set([
  "Read",
  "Write",
  "Edit",
  "Grep",
  "Glob",
  "Bash",
  "WebFetch",
  "WebSearch",
  "TodoWrite",
  "NotebookEdit",
  "Task",
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

/**
 * Convert an ag-kit agent `tools:` value to Claude Code tool names: map known
 * Antigravity tools, drop unknown/unsupported ones, dedupe, preserve order.
 * @param {string} value
 * @returns {string}
 */
export function mapAgentTools(value) {
  // Parse JSON arrays and unquote tokens before processing
  const cleaned = normalizeToolsValue(value);
  /** @type {string[]} */
  const out = [];
  for (const raw of cleaned
    .split(",")
    .map((t) => t.trim())
    .filter(Boolean)) {
    if (AGENT_TOOL_DROP.has(raw)) continue;
    // Drop MCP tools for servers we don't wire into the generated harness
    if (raw.startsWith("mcp__code-review-graph__")) continue;
    // Other MCP tools pass through unchanged
    if (raw.startsWith("mcp__")) {
      if (!out.includes(raw)) out.push(raw);
      continue;
    }
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
  let entries = parseFrontmatter(frontmatter).filter(
    (e) => e.key !== "skills" && e.key !== "model",
  );
  for (const e of entries) {
    if (e.key === "tools") e.value = mapAgentTools(e.value);
  }
  const name = entries.find((e) => e.key === "name")?.value ?? "";
  entries = applyCanonicalDescription(entries, name);
  entries.push({ key: "model", value: "sonnet" });
  const fm = renderFrontmatter(entries, { fold: new Set(["description"]) });
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
