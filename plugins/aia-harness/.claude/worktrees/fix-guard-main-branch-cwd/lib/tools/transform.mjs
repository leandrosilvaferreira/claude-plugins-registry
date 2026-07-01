/**
 * Pure transforms for vendoring external tools (caveman, ponytail) into a
 * project `.claude/`. No IO — unit-testable.
 *
 * @module tools/transform
 */
import { splitFrontmatter } from "../ecc/transform.mjs";

/**
 * @typedef {Object} VendorMeta
 * @property {string} repo
 * @property {string} commit
 * @property {string} sourcePath
 * @property {string} license
 */

/**
 * @param {VendorMeta} meta
 * @returns {string}
 */
function htmlComment(meta) {
  return `<!-- Vendored from ${meta.repo} @ ${meta.commit} :: ${meta.sourcePath}. ${meta.license}. -->\n`;
}

/**
 * @param {VendorMeta} meta
 * @returns {string}
 */
function lineComment(meta) {
  return `// Vendored from ${meta.repo} @ ${meta.commit} :: ${meta.sourcePath}. ${meta.license}.\n`;
}

/**
 * Stamp provenance into a Markdown file (after any YAML frontmatter).
 * @param {string} content
 * @param {VendorMeta} meta
 * @returns {string}
 */
export function stampMarkdown(content, meta) {
  const { frontmatter, body } = splitFrontmatter(content);
  return `${frontmatter}${htmlComment(meta)}\n${body.replace(/^\n+/, "")}`;
}

/**
 * Stamp provenance into a JS file, preserving a shebang line if present.
 * @param {string} content
 * @param {VendorMeta} meta
 * @returns {string}
 */
export function stampJs(content, meta) {
  if (content.startsWith("#!")) {
    const nl = content.indexOf("\n");
    const shebang = nl >= 0 ? content.slice(0, nl + 1) : content + "\n";
    const rest = nl >= 0 ? content.slice(nl + 1) : "";
    return `${shebang}${lineComment(meta)}${rest}`;
  }
  return `${lineComment(meta)}${content}`;
}

/**
 * Rewrite `${CLAUDE_PLUGIN_ROOT}` / `process.env.CLAUDE_PLUGIN_ROOT` references
 * (which only resolve for a real plugin) to a vendored project location.
 * @param {string} content
 * @param {string} replacement  e.g. process.env.CLAUDE_PROJECT_DIR + "/.claude/hooks/<id>"
 * @returns {string}
 */
export function rewritePluginRoot(content, replacement) {
  return content
    .replace(/\$\{CLAUDE_PLUGIN_ROOT\}/g, replacement)
    .replace(/process\.env\.CLAUDE_PLUGIN_ROOT/g, JSON.stringify(replacement));
}
