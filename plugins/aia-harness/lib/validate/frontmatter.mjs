/**
 * Claude Code frontmatter schema validation and normalization for distributed
 * template assets (agents, skills, commands, rules).
 *
 * Pure module — no IO, no side effects. Importable from transforms, apply, and hooks.
 * Delegates text↔field parsing to ./frontmatter-parse.mjs and YAML scalar
 * safety checks to ./frontmatter-yaml-safety.mjs — this module owns only the
 * asset-type-specific schema rules (required/optional fields per type).
 *
 * @module validate/frontmatter
 */
import { parse, rebuild } from "./frontmatter-parse.mjs";
import {
  SMART_QUOTES_RE,
  hasLeadingHash,
  hasAmbiguousHash,
  needsFullRequote,
  quoteValue,
} from "./frontmatter-yaml-safety.mjs";

/**
 * @typedef {'agent'|'skill'|'command'|'rule'|null} AssetType
 */

/**
 * @typedef {Object} FrontmatterResult
 * @property {boolean} valid - false iff format errors exist
 * @property {string[]} errors - format violations (auto-fixed in `normalized`)
 * @property {string[]} warnings - missing optional impactful fields (NOT auto-fixed)
 * @property {string} normalized - content with errors corrected; body always preserved
 */

/**
 * Derive asset type from a path relative to the `templates/` directory.
 *
 * @param {string} relPath
 * @returns {AssetType}
 */
export function detectAssetType(relPath) {
  const p = relPath.replace(/\\/g, "/");
  if (/(?:^|\/)agents\/[^/]+\.md$/.test(p)) return "agent";
  if (/(?:^|\/)commands\/[^/]+\.md$/.test(p)) return "command";
  if (/(?:^|\/)rules\/[^/]+\.md$/.test(p)) return "rule";
  if (/(?:^|\/)skills\/.*SKILL\.md$/.test(p)) return "skill";
  return null;
}

/**
 * Normalize a `tools` or `allowed-tools` field value to clean CSV.
 *
 * Handles:
 *   - JSON/YAML arrays: `["Read", "Grep"]` or `[Read, Grep]` → `Read, Grep`
 *   - Quoted entries: `Read, "mcp__foo__bar"` → `Read, mcp__foo__bar`
 *   - Already clean CSV: returned unchanged
 *
 * @param {string} value
 * @returns {string}
 */
export function normalizeToolsValue(value) {
  const trimmed = value.trim();
  /** @type {string[]} */
  let items;
  if (trimmed.startsWith("[")) {
    try {
      items = JSON.parse(trimmed);
    } catch {
      items = trimmed
        .slice(1, -1)
        .split(",")
        .map((s) => s.trim().replace(/^["']|["']$/g, ""));
    }
  } else {
    items = trimmed.split(",").map((s) => {
      const t = s.trim();
      return (t.startsWith('"') && t.endsWith('"')) || (t.startsWith("'") && t.endsWith("'"))
        ? t.slice(1, -1)
        : t;
    });
  }
  return items.filter(Boolean).join(", ");
}

/**
 * Apply the generic YAML-safety fixes (smart quotes, unquoted `#`) to every
 * field, regardless of asset type — a curly quote or a leading `#` corrupts
 * YAML the same way no matter which key it lands in (see
 * templates/rules/02-design-patterns.md incident: a curly-quoted glob
 * silently parsed as garbage instead of failing loudly). A mid-value `#` is
 * only ever warned about, never auto-fixed — see hasAmbiguousHash's
 * docstring for why.
 *
 * @param {Map<string,string>} fields
 * @param {Map<string,string>} modified - mutated in place
 * @param {string} eol
 * @param {string[]} errors - mutated in place
 * @param {string[]} warnings - mutated in place
 * @returns {void}
 */
function applyYamlSafetyFixes(fields, modified, eol, errors, warnings) {
  for (const [key, value] of fields) {
    let next = value;
    if (SMART_QUOTES_RE.test(next)) {
      const substituted = next.replace(/[‘’]/g, "'").replace(/[“”]/g, '"');
      next =
        !next.includes(eol) && needsFullRequote(substituted)
          ? quoteValue(substituted)
          : substituted;
      errors.push(`${key}: smart/curly quotes are not valid YAML — replaced with straight quotes`);
    } else if (!next.includes(eol) && needsFullRequote(next)) {
      // Already opens a straight quote but never cleanly terminates it (e.g.
      // `"Read"#comment` — no separating space, so the "#" isn't a real
      // comment start and a real YAML parser throws) — same danger class as
      // the curly-quote branch above, just without any curly quotes
      // triggering it.
      next = quoteValue(next);
      errors.push(
        `${key}: value opens a quote but isn't a single, cleanly-terminated YAML scalar — re-escaped`,
      );
    }
    if (!next.includes(eol)) {
      if (hasLeadingHash(next)) {
        next = quoteValue(next);
        errors.push(
          `${key}: value starts with "#" — YAML would treat the whole value as a comment; wrapped in quotes`,
        );
      } else if (hasAmbiguousHash(next)) {
        warnings.push(
          `${key}: contains an unquoted "#" — YAML treats it as a comment marker; if this is meant literally, quote the value explicitly`,
        );
      }
    }
    if (next !== value) modified.set(key, next);
  }
}

/**
 * Validate and normalize frontmatter for a given asset type.
 *
 * - `errors`: format violations → auto-fixed in `normalized`
 * - `warnings`: missing optional fields with behavioral impact → NOT auto-fixed
 * - `valid`: false iff `errors` is non-empty
 * - `normalized`: content with errors fixed; body always unchanged
 *
 * @param {string} content
 * @param {AssetType} type
 * @returns {FrontmatterResult}
 */
export function validateFrontmatter(content, type) {
  if (!type) return { valid: true, errors: [], warnings: [], normalized: content };

  const { frontmatter, fields, body, eol } = parse(content);

  if (!frontmatter) {
    const errors = type === "rule" ? [] : ["missing frontmatter block"];
    return { valid: errors.length === 0, errors, warnings: [], normalized: content };
  }

  /** @type {string[]} */
  const errors = [];
  /** @type {string[]} */
  const warnings = [];
  const modified = new Map(fields);

  applyYamlSafetyFixes(fields, modified, eol, errors, warnings);

  if (type === "agent") {
    if (!fields.has("name")) errors.push("missing required field: name");
    if (!fields.has("description")) errors.push("missing required field: description");

    if (fields.has("allowed-tools") && !fields.has("tools")) {
      errors.push('agent uses "allowed-tools" — must be "tools"');
      modified.set("tools", normalizeToolsValue(fields.get("allowed-tools") ?? ""));
      modified.delete("allowed-tools");
    } else if (fields.has("tools")) {
      const raw = fields.get("tools") ?? "";
      const norm = normalizeToolsValue(raw);
      if (norm !== raw.trim()) {
        errors.push(`tools: format non-compliant — normalized to "${norm}"`);
        modified.set("tools", norm);
      }
    } else {
      warnings.push("missing tools — agent has unrestricted tool access");
    }

    if (!fields.has("model")) {
      warnings.push("missing model — agent inherits model from its caller");
    }
  }

  if (type === "skill") {
    if (!fields.has("name")) errors.push("missing required field: name");
    if (!fields.has("description")) errors.push("missing required field: description");

    if (fields.has("tools") && !fields.has("allowed-tools")) {
      errors.push('skill uses "tools" — must be "allowed-tools"');
      modified.set("allowed-tools", normalizeToolsValue(fields.get("tools") ?? ""));
      modified.delete("tools");
    } else if (fields.has("allowed-tools")) {
      const raw = fields.get("allowed-tools") ?? "";
      const norm = normalizeToolsValue(raw);
      if (norm !== raw.trim()) {
        errors.push(`allowed-tools: format non-compliant — normalized to "${norm}"`);
        modified.set("allowed-tools", norm);
      }
    } else {
      warnings.push("missing allowed-tools — skill has unrestricted tool access");
    }
  }

  if (type === "command") {
    if (!fields.has("description")) errors.push("missing required field: description");

    if (fields.has("tools") && !fields.has("allowed-tools")) {
      errors.push('command uses "tools" — must be "allowed-tools"');
      modified.set("allowed-tools", normalizeToolsValue(fields.get("tools") ?? ""));
      modified.delete("tools");
    } else if (fields.has("allowed-tools")) {
      const raw = fields.get("allowed-tools") ?? "";
      const norm = normalizeToolsValue(raw);
      if (norm !== raw.trim()) {
        errors.push(`allowed-tools: format non-compliant — normalized to "${norm}"`);
        modified.set("allowed-tools", norm);
      }
    }
  }

  if (type === "rule") {
    if (!fields.has("paths")) {
      warnings.push("missing paths — rule applies globally to all project files");
    }
  }

  const normalized = errors.length > 0 ? rebuild(fields, modified, body, eol) : content;

  return { valid: errors.length === 0, errors, warnings, normalized };
}
