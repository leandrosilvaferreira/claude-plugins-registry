/**
 * YAML scalar-safety checks and fixes for a single frontmatter field value:
 * smart/curly quotes, and an unquoted `#` that a real YAML parser would
 * treat as a comment marker. Each function reasons about one plain string
 * value in isolation — no knowledge of frontmatter structure or asset types.
 *
 * Pure module — no IO, no side effects.
 *
 * @module validate/frontmatter-yaml-safety
 */

export const SMART_QUOTES_RE = /[‘’“”]/;

/**
 * If `t` starts with a complete quoted scalar ("..." or '...'), returns the
 * index just past its matching closing quote; otherwise null. Handles `\"`
 * escapes in double-quoted scalars and doubled `''` escapes in single-quoted
 * ones, matching real YAML scalar-quoting rules.
 * @param {string} t
 * @returns {number|null}
 */
function quotedPrefixEnd(t) {
  if (t[0] === '"') {
    for (let i = 1; i < t.length; i++) {
      if (t[i] === "\\") {
        i++;
        continue;
      }
      if (t[i] === '"') return i + 1;
    }
    return null;
  }
  if (t[0] === "'") {
    for (let i = 1; i < t.length; i++) {
      if (t[i] === "'") {
        if (t[i + 1] === "'") {
          i++;
          continue;
        }
        return i + 1;
      }
    }
    return null;
  }
  return null;
}

/**
 * Is `t` already a single, cleanly-terminated quoted scalar — nothing after
 * its closing quote except optional whitespace and/or a genuine `#` comment?
 * A value that merely CONTAINS a quote character (anywhere but position 0)
 * is always safe as an unquoted plain scalar — only a quote at the very
 * start puts a real YAML parser into quoted-scalar mode — confirmed
 * empirically against this repo's own js-yaml dependency.
 * @param {string} t - already trimmed
 * @returns {boolean}
 */
function isCleanlyQuoted(t) {
  const qEnd = quotedPrefixEnd(t);
  if (qEnd === null) return false;
  const rest = t.slice(qEnd);
  // A genuine trailing comment needs a real separator (space/tab) before the
  // "#", matching YAML's own comment-start rule — without one, ANY trailing
  // content (comment-shaped or not) is a hard parse error a real YAML parser
  // throws on, so it must NOT be treated as safe (confirmed empirically:
  // `"bar"#x` throws, `"bar" #x` doesn't — trimming rest before this check
  // erased that exact distinction).
  return /^[ \t]*$/.test(rest) || /^[ \t]+#/.test(rest);
}

/**
 * Would the ENTIRE value vanish as a YAML comment (unquoted, and either the
 * whole trimmed value starts with `#`)? Unambiguous — nobody intends an
 * empty field — safe to auto-fix by quoting.
 * @param {string} value
 * @returns {boolean}
 */
export function hasLeadingHash(value) {
  const t = value.trim();
  if (!t || isCleanlyQuoted(t)) return false;
  return t.startsWith("#");
}

/**
 * Does an unquoted value contain a mid-value `<blank>#` (blank = space or
 * tab, matching YAML's own comment-start rule)? Deliberately NOT auto-fixed:
 * this is genuinely ambiguous — YAML's own reading (a legitimate trailing
 * comment, correctly stripped) is usually what the author intended, and
 * silently re-quoting would corrupt that common, valid case (confirmed: it
 * would silently truncate a `tools: Read # only allow read`-style comment
 * into the literal tool value, breaking real permissions). Surfaced as a
 * warning only, so a human can add explicit quotes if `#` was meant
 * literally.
 * @param {string} value
 * @returns {boolean}
 */
export function hasAmbiguousHash(value) {
  const t = value.trim();
  if (!t || isCleanlyQuoted(t) || t.startsWith("#")) return false;
  return /[ \t]#/.test(t);
}

/**
 * Would emitting `value` unquoted break a real YAML parser? Only possible
 * when it STARTS with a quote character that doesn't cleanly terminate over
 * the rest of the value — a quote appearing anywhere else is always safe as
 * plain-scalar text (confirmed empirically). Multi-line values are never
 * escalated here: a block list has per-item scalar boundaries this
 * single-scalar check can't reason about — left as a documented scope
 * limit, same as the hash checks above.
 * @param {string} value
 * @returns {boolean}
 */
export function needsFullRequote(value) {
  const t = value.trim();
  if (t[0] !== '"' && t[0] !== "'") return false;
  return !isCleanlyQuoted(t);
}

/**
 * Wrap a value in double quotes, escaping `\` and `"` so it round-trips
 * through a real YAML double-quoted scalar unchanged.
 * @param {string} value
 * @returns {string}
 */
export function quoteValue(value) {
  return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}
