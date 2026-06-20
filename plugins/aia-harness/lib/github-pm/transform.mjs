/**
 * Pure transforms applied to github-pm-ext skill files when vendoring them.
 * No IO here so the logic is unit-testable without network.
 *
 * @module github-pm/transform
 */

const FRONTMATTER_RE = /^(---\n[\s\S]*?\n---\n)/;

/**
 * Split YAML frontmatter from body.
 * @param {string} content
 * @returns {{ frontmatter: string, body: string }}
 */
export function splitFrontmatter(content) {
  const m = content.match(FRONTMATTER_RE);
  if (!m) return { frontmatter: "", body: content };
  return { frontmatter: m[1], body: content.slice(m[1].length) };
}

/**
 * Build a provenance comment string for a vendored file.
 * @param {string} repo   e.g. "github/awesome-copilot"
 * @param {string} commit pinned SHA
 * @param {string} filePath path within the repo
 * @param {string} license SPDX expression
 * @returns {string}
 */
export function provenanceComment(repo, commit, filePath, license) {
  return `<!-- vendored from https://github.com/${repo}/blob/${commit}/${filePath} | license: ${license} -->\n`;
}

/**
 * Stamp provenance into a SKILL.md (or other Markdown) file from an upstream
 * GitHub repo, preserving any existing frontmatter.
 *
 * @param {string} content    Raw file content from upstream
 * @param {Object} meta
 * @param {string} meta.repo      e.g. "github/awesome-copilot"
 * @param {string} meta.commit    pinned SHA
 * @param {string} meta.filePath  path within the repo
 * @param {string} meta.license   SPDX expression
 * @returns {string}
 */
export function transformSkill(content, { repo, commit, filePath, license }) {
  const stamp = provenanceComment(repo, commit, filePath, license);
  const { frontmatter, body } = splitFrontmatter(content);
  if (frontmatter) {
    return `${frontmatter}\n${stamp}\n${body.replace(/^\n+/, "")}`;
  }
  return `${stamp}\n${content.replace(/^\n+/, "")}`;
}
