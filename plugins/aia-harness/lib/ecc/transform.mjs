/**
 * Pure transforms applied to ECC files when vendoring them. No IO here so the
 * logic is unit-testable without network.
 *
 * @module ecc/transform
 */

import { parseFrontmatter, renderFrontmatter } from "../util/frontmatter-yaml.mjs";
import { applyCanonicalDescription } from "../validate/agent-description.mjs";
import { ECC_COMMON, allEccAssets } from "../data/ecc-catalog.mjs";

const FRONTMATTER_RE = /^(---\n[\s\S]*?\n---\n)/;

/**
 * @param {string} content
 * @returns {{ frontmatter: string, body: string }}
 */
export function splitFrontmatter(content) {
  const m = content.match(FRONTMATTER_RE);
  if (!m) return { frontmatter: "", body: content };
  return { frontmatter: m[1], body: content.slice(m[1].length) };
}

/**
 * Remove a Markdown section starting at a heading matching `headingRe`, up to
 * the next H1/H2 heading or end of file.
 * @param {string} body
 * @param {RegExp} headingRe
 * @returns {string}
 */
export function removeSection(body, headingRe) {
  const lines = body.split("\n");
  /** @type {string[]} */
  const out = [];
  let skipping = false;
  for (const line of lines) {
    if (skipping) {
      if (/^##?\s/.test(line))
        skipping = false; // reached next H1/H2
      else continue;
    }
    if (headingRe.test(line)) {
      skipping = true;
      continue;
    }
    out.push(line);
  }
  return out.join("\n");
}

/**
 * @param {{ sourcePath: string, commit: string }} meta
 * @returns {string}
 */
function provenanceComment(meta) {
  return `<!-- Vendored from ECC (github.com/affaan-m/ECC) @ ${meta.commit} :: ${meta.sourcePath}. MIT (c) Affaan Mustafa. -->\n`;
}

/**
 * Clean an ECC agent markdown file for redistribution: drop the shared
 * "Prompt Defense Baseline" block and the dangling "## Related" cross-refs,
 * drop the `tools` frontmatter field entirely (unrestricted tool/MCP access
 * instead of the vendored allowlist — validateFrontmatter treats a missing
 * `tools:` as a warning, not an error; mirrors ag-kit's cleanAgentMarkdown in
 * lib/agkit/transform.mjs), and stamp provenance.
 * @param {string} content
 * @param {{ sourcePath: string, commit: string }} meta
 * @returns {string}
 */
export function cleanAgentMarkdown(content, meta) {
  const { frontmatter, body } = splitFrontmatter(content);
  let entries = parseFrontmatter(frontmatter).filter((e) => e.key !== "tools");
  const name = entries.find((e) => e.key === "name")?.value ?? "";
  entries = applyCanonicalDescription(entries, name);
  const fm = renderFrontmatter(entries, { fold: new Set(["description"]) });
  let cleaned = removeSection(body, /^##\s+Prompt Defense/i);
  cleaned = removeSection(cleaned, /^##\s+Related/i);
  cleaned = cleaned.replace(/\n{3,}/g, "\n\n").trim();
  return `${fm}${provenanceComment(meta)}\n${cleaned}\n`;
}

/**
 * Keep a file verbatim but stamp provenance after any frontmatter.
 * @param {string} content
 * @param {{ sourcePath: string, commit: string }} meta
 * @returns {string}
 */
export function stampProvenance(content, meta) {
  const { frontmatter, body } = splitFrontmatter(content);
  return `${frontmatter}${provenanceComment(meta)}\n${body.replace(/^\n+/, "")}`;
}

/** @returns {Set<string>} Every ECC agent id this harness ever installs (ECC_COMMON ∪ every ECC_BY_STACK entry). */
function knownEccAgentIds() {
  return new Set(allEccAssets().agents);
}

/** @returns {string[]} Real ECC agent ids installed only for a matching detected stack (not in ECC_COMMON). */
function stackGatedEccAgentIds() {
  const common = new Set(ECC_COMMON.agents);
  return allEccAssets().agents.filter((a) => !common.has(a));
}

const TABLE_AGENT_ROW_RE = /^\|\s*\*{0,2}([a-z][a-z0-9]*(?:-[a-z0-9]+)*)\*{0,2}\s*\|/;

/**
 * Drop markdown table rows whose first cell names an ECC agent id this
 * harness never installs under any stack (no ECC_COMMON/ECC_BY_STACK entry
 * in ecc-catalog.mjs). ECC's own `rules/common/agents.md` lists its full
 * upstream agent roster unconditionally, including names this harness never
 * vendors (e.g. `planner`, `architect`) — a row naming one reads as if
 * invoking it would work, when it never does under any stack. Real agent
 * rows (common or stack-gated) are left in place; header/separator rows
 * never match (their first cell isn't a lowercase agent-id token) so they
 * survive untouched. Checked against the live catalog, so this tracks
 * automatically as ECC is re-vendored or the catalog changes.
 * @param {string} body
 * @returns {string}
 */
export function dropFictionalAgentRows(body) {
  const known = knownEccAgentIds();
  return body
    .split("\n")
    .filter((line) => {
      const m = line.match(TABLE_AGENT_ROW_RE);
      return !m || known.has(m[1]);
    })
    .join("\n");
}

const BOLD_AGENT_MENTION_RE = /\*\*([a-z][a-z0-9]*(?:-[a-z0-9]+)*)\*\*\s+agent\b/g;
const GENERIC_AGENT_MENTION = "an appropriate specialist agent (check `.claude/agents/`)";

/**
 * Replace inline "**<agent-id>** agent" prose mentions of an ECC agent id
 * this harness never installs (see {@link dropFictionalAgentRows}) with a
 * generic pointer at the real installed roster. Real agent mentions (common
 * or stack-gated) are left byte-identical.
 * @param {string} body
 * @returns {string}
 */
export function genericizeFictionalAgentMentions(body) {
  const known = knownEccAgentIds();
  return body.replace(BOLD_AGENT_MENTION_RE, (whole, name) =>
    known.has(name) ? whole : GENERIC_AGENT_MENTION,
  );
}

const ECC_AGENT_AVAILABILITY_NOTE =
  "> **Note on agent names below:** ECC's stack-specific reviewer/build-resolver agents " +
  "(e.g. `typescript-reviewer`, `go-reviewer`, `rust-reviewer`) are only installed when " +
  "your project's detected stack matches — check `.claude/agents/` for what is actually " +
  "present before assuming one of these ran. `code-reviewer` and `security-reviewer` are " +
  "installed for every project.\n\n";

/**
 * Prepend {@link ECC_AGENT_AVAILABILITY_NOTE} when the body mentions a real
 * but stack-gated ECC agent id (see {@link stackGatedEccAgentIds}) — mirrors
 * ag-kit's `withAgentAvailabilityNote` (lib/agkit/transform.mjs).
 * @param {string} body
 * @returns {string}
 */
export function withEccAgentAvailabilityNote(body) {
  const gated = stackGatedEccAgentIds();
  if (gated.length === 0) return body;
  const re = new RegExp(`\\b(?:${gated.join("|")})\\b`);
  return re.test(body) ? ECC_AGENT_AVAILABILITY_NOTE + body : body;
}

/**
 * Clean an ECC `rules/common/**` file for redistribution: drop the dangling
 * "## Agent Support" section (upstream junk — see below), drop table rows
 * and genericize inline mentions naming an ECC agent this harness never
 * installs, prepend the stack-gated-agent availability note when relevant,
 * and stamp provenance. Scoped to `rules/common/` (installed unconditionally
 * for every project, any stack) by the caller in scripts/sync-ecc.mjs — see
 * dropFictionalAgentRows/genericizeFictionalAgentMentions for why this is
 * needed at all.
 * @param {string} content
 * @param {{ sourcePath: string, commit: string }} meta
 * @returns {string}
 */
export function cleanCommonRulesMarkdown(content, meta) {
  const { frontmatter, body } = splitFrontmatter(content);
  let cleaned = body.replace(/^\n+/, "");
  // testing.md's "## Agent Support" section is a single bullet entirely about
  // a fictional agent (tdd-guide) with no other content — nothing legitimate
  // survives dropping the whole section (no-op on every other common/ file).
  cleaned = removeSection(cleaned, /^##\s+Agent Support/i);
  cleaned = dropFictionalAgentRows(cleaned);
  cleaned = genericizeFictionalAgentMentions(cleaned);
  cleaned = cleaned.replace(/\n{3,}/g, "\n\n").trim();
  cleaned = withEccAgentAvailabilityNote(cleaned);
  return `${frontmatter}${provenanceComment(meta)}\n${cleaned}\n`;
}
