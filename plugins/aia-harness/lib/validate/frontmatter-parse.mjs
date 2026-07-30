/**
 * Line-oriented parser/rebuilder for a YAML frontmatter block: reads it into
 * an ordered field map and writes a modified map back out, preserving
 * original field order, multi-line block values (list items, wrapped
 * scalars), and the file's own line-ending style (LF or CRLF).
 *
 * Pure module — no IO, no side effects.
 *
 * @module validate/frontmatter-parse
 */

const FRONTMATTER_RE = /^---\r?\n([\s\S]*?)---\r?\n/;
const FIELD_RE = /^([A-Za-z0-9_-]+):\s?(.*)$/;

/**
 * @param {string} text
 * @returns {string} "\r\n" if `text` uses CRLF line endings, else "\n"
 */
function detectEol(text) {
  return text.includes("\r\n") ? "\r\n" : "\n";
}

/**
 * @param {string} content
 * @returns {{ frontmatter: string, fields: Map<string,string>, body: string, eol: string }}
 */
export function parse(content) {
  const m = content.match(FRONTMATTER_RE);
  if (!m) return { frontmatter: "", fields: new Map(), body: content, eol: detectEol(content) };
  const frontmatter = m[0];
  const body = content.slice(frontmatter.length);
  const eol = detectEol(frontmatter);
  const rawLines = m[1].split(/\r?\n/);
  if (rawLines[rawLines.length - 1] === "") rawLines.pop();

  /** @type {Map<string, string>} */
  const fields = new Map();
  /** @type {string|null} */
  let currentKey = null;
  for (const line of rawLines) {
    const match = line.match(FIELD_RE);
    if (match) {
      currentKey = match[1];
      fields.set(currentKey, match[2]);
    } else if (currentKey !== null) {
      // Continuation line (block list item, wrapped value) — keep it attached
      // to its field instead of dropping it, so a multi-line `paths:` list
      // survives a rebuild triggered by some other field's fix.
      fields.set(currentKey, fields.get(currentKey) + eol + line);
    }
  }
  return { frontmatter, fields, body, eol };
}

/**
 * Rebuild full file content from a modified field map, preserving original
 * field order. Fields present in original but absent from `modified` are
 * dropped. Fields in `modified` but absent from original are appended.
 * Body is always appended unchanged. A field's value may itself contain
 * embedded `eol`s (a preserved multi-line block list/scalar) — re-emitted
 * verbatim as part of its `key: value` line.
 *
 * @param {Map<string,string>} original - original field map (for ordering)
 * @param {Map<string,string>} modified - final field map
 * @param {string} body
 * @param {string} eol - line ending to rebuild the frontmatter block with
 * @returns {string}
 */
export function rebuild(original, modified, body, eol) {
  const lines = ["---"];
  const emitted = new Set();
  // A value whose first line was empty (e.g. `paths:` with the list starting
  // on the next line) already carries its own leading eol — don't inject an
  // extra ": " space that the original untouched line never had.
  const emit = (/** @type {string} */ k, /** @type {string} */ v) =>
    lines.push(v.startsWith(eol) ? `${k}:${v}` : `${k}: ${v}`);
  for (const [k] of original) {
    if (modified.has(k)) {
      emit(k, /** @type {string} */ (modified.get(k)));
      emitted.add(k);
    }
  }
  for (const [k, v] of modified) {
    if (!emitted.has(k)) emit(k, v);
  }
  lines.push("---", "");
  return lines.join(eol) + body;
}
