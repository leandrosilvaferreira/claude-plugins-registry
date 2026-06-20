/**
 * Pure transforms applied to ECC files when vendoring them. No IO here so the
 * logic is unit-testable without network.
 *
 * @module ecc/transform
 */

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
      if (/^##?\s/.test(line)) skipping = false; // reached next H1/H2
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
 * keep frontmatter, and stamp provenance.
 * @param {string} content
 * @param {{ sourcePath: string, commit: string }} meta
 * @returns {string}
 */
export function cleanAgentMarkdown(content, meta) {
  const { frontmatter, body } = splitFrontmatter(content);
  let cleaned = removeSection(body, /^##\s+Prompt Defense/i);
  cleaned = removeSection(cleaned, /^##\s+Related/i);
  cleaned = cleaned.replace(/\n{3,}/g, "\n\n").trim();
  return `${frontmatter}${provenanceComment(meta)}\n${cleaned}\n`;
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
