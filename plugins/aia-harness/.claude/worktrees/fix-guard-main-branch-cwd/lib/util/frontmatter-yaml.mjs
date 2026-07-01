/**
 * Neutral, folded-scalar-aware flat-YAML frontmatter parse/render. Pure — no IO.
 * Shared by the ecc/agkit transforms, the agent-description propagation, the
 * checker, and the integrity test so there is ONE folded implementation.
 *
 * Supports: one `key: value` per line, and `key: >` folded blocks whose
 * indented continuation lines fold (newlines → spaces) into one logical value.
 *
 * @module util/frontmatter-yaml
 */

/** @param {string} v @returns {boolean} */
function needsQuote(v) {
  return /:\s/.test(v) || /^[\s"'#&*!|>%@`]/.test(v) || v.includes('"');
}

/** @param {string} v @returns {string} */
export function quoteIfNeeded(v) {
  return needsQuote(v) ? `"${v.replace(/"/g, '\\"')}"` : v;
}

/**
 * @param {string} frontmatter  Block including --- fences.
 * @returns {{ key: string, value: string }[]}
 */
export function parseFrontmatter(frontmatter) {
  /** @type {{ key: string, value: string }[]} */
  const entries = [];
  const lines = frontmatter.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line === "---" || line.trim() === "") continue;
    const folded = line.match(/^([A-Za-z0-9_-]+):\s*>\s*$/);
    if (folded) {
      /** @type {string[]} */
      const parts = [];
      while (i + 1 < lines.length && /^\s{2,}\S/.test(lines[i + 1])) {
        parts.push(lines[i + 1].trim());
        i++;
      }
      entries.push({ key: folded[1], value: parts.join(" ") });
      continue;
    }
    const m = line.match(/^([A-Za-z0-9_-]+):\s?(.*)$/);
    if (m) entries.push({ key: m[1], value: m[2] });
  }
  return entries;
}

/**
 * @param {string} value
 * @param {number} width
 * @returns {string}  Indented folded body (2-space indent, wrapped at width).
 */
function foldBody(value, width) {
  const words = value.split(/\s+/).filter(Boolean);
  /** @type {string[]} */
  const out = [];
  let line = "";
  for (const w of words) {
    if (line && line.length + 1 + w.length > width) {
      out.push(line);
      line = w;
    } else {
      line = line ? `${line} ${w}` : w;
    }
  }
  if (line) out.push(line);
  return out.map((l) => `  ${l}`).join("\n");
}

/**
 * @param {{ key: string, value: string }[]} entries
 * @param {{ fold?: Set<string>, width?: number }} [opts]
 * @returns {string}  Frontmatter block including --- fences and trailing newline.
 */
export function renderFrontmatter(entries, opts = {}) {
  const fold = opts.fold ?? new Set();
  const width = opts.width ?? 72;
  const body = entries
    .map((e) => {
      if (fold.has(e.key) && e.value.length > width) {
        return `${e.key}: >\n${foldBody(e.value, width)}`;
      }
      return `${e.key}: ${quoteIfNeeded(e.value)}`;
    })
    .join("\n");
  return `---\n${body}\n---\n`;
}
