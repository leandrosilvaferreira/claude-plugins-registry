/**
 * Claude Code frontmatter schema validation and normalization for distributed
 * template assets (agents, skills, commands, rules).
 *
 * Pure module — no IO, no side effects. Importable from transforms, apply, and hooks.
 *
 * @module validate/frontmatter
 */

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

const FRONTMATTER_RE = /^---\n([\s\S]*?)---\n/;

/**
 * @param {string} content
 * @returns {{ frontmatter: string, fields: Map<string,string>, body: string }}
 */
function parse(content) {
  const m = content.match(FRONTMATTER_RE);
  if (!m) return { frontmatter: "", fields: new Map(), body: content };
  const frontmatter = m[0];
  const body = content.slice(frontmatter.length);
  /** @type {Map<string, string>} */
  const fields = new Map();
  for (const line of m[1].split("\n")) {
    const match = line.match(/^([A-Za-z0-9_-]+):\s?(.*)$/);
    if (match) fields.set(match[1], match[2]);
  }
  return { frontmatter, fields, body };
}

/**
 * Rebuild full file content from a modified field map, preserving original
 * field order. Fields present in original but absent from `modified` are
 * dropped. Fields in `modified` but absent from original are appended.
 * Body is always appended unchanged.
 *
 * @param {Map<string,string>} original - original field map (for ordering)
 * @param {Map<string,string>} modified - final field map
 * @param {string} body
 * @returns {string}
 */
function rebuild(original, modified, body) {
  const lines = ["---"];
  const emitted = new Set();
  for (const [k] of original) {
    if (modified.has(k)) {
      lines.push(`${k}: ${modified.get(k)}`);
      emitted.add(k);
    }
  }
  for (const [k, v] of modified) {
    if (!emitted.has(k)) lines.push(`${k}: ${v}`);
  }
  lines.push("---", "");
  return lines.join("\n") + body;
}

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

  const { frontmatter, fields, body } = parse(content);

  if (!frontmatter) {
    const errors = type === "rule" ? [] : ["missing frontmatter block"];
    return { valid: errors.length === 0, errors, warnings: [], normalized: content };
  }

  /** @type {string[]} */
  const errors = [];
  /** @type {string[]} */
  const warnings = [];
  const modified = new Map(fields);

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

  const normalized =
    errors.length > 0 ? rebuild(fields, modified, body) : content;

  return { valid: errors.length === 0, errors, warnings, normalized };
}
