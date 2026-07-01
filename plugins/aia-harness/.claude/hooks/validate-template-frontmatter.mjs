#!/usr/bin/env node
/**
 * PreToolUse hook — validates and auto-normalizes YAML frontmatter when
 * writing or editing template markdown files in templates/**\/*.md.
 *
 * Write tool: validates `tool_input.content`; returns updatedInput if fixed.
 * Edit  tool: validates `tool_input.new_string` as a fragment; returns
 *             updatedInput.new_string if fixed. (Fragment-only check: does not
 *             reconstruct the full file. Full normalization happens via
 *             scripts/normalize-frontmatter.mjs and lib/apply.mjs.)
 *
 * Exit 0 always — never blocks the write; format errors are auto-fixed via
 * updatedInput; warnings are surfaced as systemMessage advisories.
 *
 * @hook PreToolUse
 */
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  detectAssetType,
  validateFrontmatter,
  normalizeToolsValue,
} from "../../lib/validate/frontmatter.mjs";

/**
 * Normalize tool field lines in a fragment that has no frontmatter delimiters.
 * Returns { normalized: string, errors: string[] }.
 *
 * @param {string} fragment
 * @returns {{ normalized: string, errors: string[] }}
 */
function normalizeFragmentLines(fragment) {
  const TOOL_FIELD_RE = /^(tools|allowed-tools):\s*(.+)$/;
  const lines = fragment.split("\n");
  /** @type {string[]} */
  const errors = [];
  const normalized = lines
    .map((line) => {
      const m = line.match(TOOL_FIELD_RE);
      if (!m) return line;
      const field = m[1];
      const raw = m[2];
      const norm = normalizeToolsValue(raw);
      if (norm !== raw.trim()) {
        errors.push(`${field}: format non-compliant — normalized to "${norm}"`);
        return `${field}: ${norm}`;
      }
      return line;
    })
    .join("\n");
  return { normalized, errors };
}

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

/** @param {any} obj @returns {void} */
function exit(obj) {
  if (obj && Object.keys(obj).length > 0) process.stdout.write(JSON.stringify(obj) + "\n");
  process.exit(0);
}

let event;
try {
  const raw = await new Promise((resolve) => {
    let buf = "";
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (d) => (buf += d));
    process.stdin.on("end", () => resolve(buf));
  });
  if (!raw.trim()) exit({});
  event = JSON.parse(raw);
} catch {
  exit({});
}

const toolName = event?.tool_name ?? "";
const toolInput = event?.tool_input ?? {};
const filePath = toolInput.file_path ?? "";

// Only intercept Write and Edit on .md files inside templates/
if (toolName !== "Write" && toolName !== "Edit") exit({});
if (!filePath.endsWith(".md")) exit({});

const cwdArg = typeof event?.cwd === "string" && event.cwd ? event.cwd : "";
const projectDir = cwdArg || process.env.CLAUDE_PROJECT_DIR || ROOT;
const templatesDir = path.join(projectDir, "templates");

let relPath;
try {
  const rel = path.relative(templatesDir, filePath);
  if (rel.startsWith("..")) exit({}); // outside templates/
  relPath = rel;
} catch {
  exit({});
}

const type = detectAssetType(relPath);
if (!type) exit({});

// Determine the content fragment to validate
const isWrite = toolName === "Write";
const fragment = isWrite ? (toolInput.content ?? "") : (toolInput.new_string ?? "");

// For Edit fragments: if the fragment has no frontmatter delimiters, validate
// at the line level (tool field normalization only). For Write or Edit with full
// frontmatter, use the full validator.
const hasFrontmatter = /^---\n/.test(fragment);
let valid, errors, warnings, normalized;
if (!isWrite && !hasFrontmatter) {
  const result = normalizeFragmentLines(fragment);
  errors = result.errors;
  warnings = [];
  valid = errors.length === 0;
  normalized = result.normalized;
} else {
  ({ valid, errors, warnings, normalized } = validateFrontmatter(fragment, type));
}

if (valid && warnings.length === 0) exit({});

/** @type {any} */
const output = {
  hookSpecificOutput: { permissionDecision: "allow" },
};

if (!valid) {
  // Auto-fix: return normalized content via updatedInput
  const updatedInput = { ...toolInput };
  if (isWrite) {
    updatedInput.content = normalized;
  } else {
    updatedInput.new_string = normalized;
  }
  output.hookSpecificOutput.updatedInput = updatedInput;
  output.systemMessage = `[frontmatter] auto-fixed ${errors.length} error(s) in ${path.basename(filePath)}: ${errors.join("; ")}`;
}

if (warnings.length > 0) {
  const advisory = warnings.map((w) => `  • ${w}`).join("\n");
  output.systemMessage =
    (output.systemMessage ? output.systemMessage + "\n" : "") +
    `[frontmatter] advisory for ${path.basename(filePath)}:\n${advisory}`;
}

exit(output);
