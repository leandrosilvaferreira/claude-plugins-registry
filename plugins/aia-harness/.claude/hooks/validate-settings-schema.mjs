#!/usr/bin/env node
/**
 * PostToolUse hook: validate .claude/settings.json and .claude/settings.local.json
 * against the Claude Code JSON Schema from SchemaStore whenever those files are
 * written or edited. Exits 2 with a structured stderr message that instructs
 * Claude to present errors to the user and ask for confirmation before fixing.
 *
 * Fail-open on all infrastructure (network, cache, parse). Only exits 2 for
 * actual JSON syntax errors or schema validation failures.
 *
 * Schema URL and cache path are env-overridable (used in tests):
 *   SETTINGS_SCHEMA_URL   — default: https://www.schemastore.org/claude-code-settings.json
 *                           If not starting with "http", treated as a local file path.
 *   SETTINGS_SCHEMA_CACHE — default: <this session's scratch dir>/settings-schema-cache.json
 *                           (see session-scratch.mjs). The cache no longer survives
 *                           across sessions — a deliberate trade for never touching
 *                           raw os.tmpdir(); see .claude/rules/hooks-cross-platform.md.
 *
 * @hook PostToolUse
 */
import fs from "node:fs";
import path from "node:path";
import { sessionScratchDir } from "./session-scratch.mjs";

// ── Configuration (env-overridable for testing) ───────────────────────────────
const SCHEMA_URL =
  process.env.SETTINGS_SCHEMA_URL ?? "https://www.schemastore.org/claude-code-settings.json";
const TTL_MS = 24 * 60 * 60 * 1000;

// ── Stdin parse ───────────────────────────────────────────────────────────────
let event;
try {
  const raw = fs.readFileSync(0, "utf8");
  if (!raw.trim()) process.exit(0);
  event = JSON.parse(raw);
} catch {
  process.exit(0);
}

// ── Tool filter ───────────────────────────────────────────────────────────────
const toolName = event?.tool_name ?? "";
if (!["Write", "Edit", "MultiEdit"].includes(toolName)) process.exit(0);

// ── Path filter ───────────────────────────────────────────────────────────────
const ti = event?.tool_input ?? {};
const file = ti.file_path || ti.path;
if (!file || typeof file !== "string") process.exit(0);

const basename = path.basename(file);
if (basename !== "settings.json" && basename !== "settings.local.json") process.exit(0);
if (path.basename(path.dirname(file)) !== ".claude") process.exit(0);

// ── File existence ────────────────────────────────────────────────────────────
if (!fs.existsSync(file)) process.exit(0);

// ── JSON parse ────────────────────────────────────────────────────────────────
let parsed;
try {
  parsed = JSON.parse(fs.readFileSync(file, "utf8"));
} catch (e) {
  const msg = e instanceof Error ? e.message : String(e);
  process.stderr.write(
    `[settings-schema-validator] ${basename} contém JSON inválido:\n\n  ${msg}\n\nCorrija a sintaxe do arquivo antes de continuar.\n`,
  );
  process.exit(2);
}

// ── Load schema ───────────────────────────────────────────────────────────────
const sessionId = typeof event?.session_id === "string" ? event.session_id : "nosession";
const CACHE_FILE =
  process.env.SETTINGS_SCHEMA_CACHE ??
  path.join(sessionScratchDir(sessionId), "settings-schema-cache.json");
const schema = await loadSchema();
if (!schema) process.exit(0);

// ── Validate ──────────────────────────────────────────────────────────────────
const errors = validate(parsed, schema, schema);
if (errors.length === 0) process.exit(0);

// ── Report ────────────────────────────────────────────────────────────────────
const MAX_SHOWN = 20;
const list = errors
  .slice(0, MAX_SHOWN)
  .map((e, i) => `  ${i + 1}. ${e.path || "/"} — ${e.message}`)
  .join("\n");
const more = errors.length > MAX_SHOWN ? `\n  … +${errors.length - MAX_SHOWN} mais erro(s)` : "";

process.stderr.write(
  `[settings-schema-validator] ${errors.length} erro(s) de validação em ${basename}:\n\n` +
    `${list}${more}\n\n` +
    `Por favor, apresente os erros acima ao usuário, explique como corrigir cada um,\n` +
    `e pergunte: "Encontrei ${errors.length} erro(s) no ${basename}. Deseja que eu corrija?"\n` +
    `Se o usuário confirmar, aplique as correções.\n`,
);
process.exit(2);

// ── Schema loading (fetch + 24h disk cache) ───────────────────────────────────
/**
 * Load schema from local file (for testing) or remote URL with disk cache.
 * Returns null on any failure (fail-open contract).
 * @returns {Promise<object|null>}
 */
async function loadSchema() {
  // Non-HTTP URL: treat as local file path (used in tests)
  if (!SCHEMA_URL.startsWith("http")) {
    try {
      return JSON.parse(fs.readFileSync(SCHEMA_URL, "utf8"));
    } catch {
      return null;
    }
  }

  // Try fresh cache first
  try {
    const cached = JSON.parse(fs.readFileSync(CACHE_FILE, "utf8"));
    if (cached && typeof cached.fetchedAt === "number" && Date.now() - cached.fetchedAt < TTL_MS) {
      return cached.schema;
    }
  } catch {
    /* cache miss or stale — fall through to fetch */
  }

  // Fetch from SchemaStore
  try {
    const res = await fetch(SCHEMA_URL, { signal: AbortSignal.timeout(8000) });
    if (!res.ok) return null;
    const fetched = /** @type {object} */ (await res.json());
    try {
      fs.writeFileSync(
        CACHE_FILE,
        JSON.stringify({ schema: fetched, fetchedAt: Date.now() }),
        "utf8",
      );
    } catch {
      /* non-fatal: schema still used for this run */
    }
    return fetched;
  } catch {
    return null;
  }
}

// ── Minimal JSON Schema validator ─────────────────────────────────────────────
/**
 * Recursively validate `value` against `schema`.
 * Supported keywords: type, properties, additionalProperties, required, items,
 * enum, const, pattern, minLength, maxLength, minimum, maximum,
 * $ref (internal document only), anyOf, oneOf, allOf.
 * Unknown keywords are silently ignored (fail-open).
 *
 * @param {any} value
 * @param {any} schema
 * @param {any} root   Root schema document for $ref resolution.
 * @param {string} [ptr]  Current JSON Pointer path (e.g. "/hooks/0/command").
 * @returns {{ path: string, message: string }[]}
 */
function validate(value, schema, root, ptr = "") {
  if (!schema || typeof schema !== "object") return [];

  // $ref: resolve within the same document (#/definitions/... or #/$defs/...)
  if (typeof schema.$ref === "string") {
    const segments = /** @type {string} */ (schema.$ref)
      .replace(/^#\//, "")
      .split("/")
      .map((s) => decodeURIComponent(s.replace(/~1/g, "/").replace(/~0/g, "~")));
    let ref = root;
    for (const seg of segments) ref = ref?.[seg];
    return ref ? validate(value, ref, root, ptr) : [];
  }

  /** @type {{ path: string, message: string }[]} */
  const errors = [];

  // type
  if (schema.type !== undefined) {
    const types = /** @type {string[]} */ (
      Array.isArray(schema.type) ? schema.type : [schema.type]
    );
    if (!types.some((t) => checkType(value, t))) {
      const found = Array.isArray(value) ? "array" : value === null ? "null" : typeof value;
      errors.push({
        path: ptr,
        message: `tipo inválido: esperado "${types.join("|")}", encontrado ${found}`,
      });
      return errors; // type mismatch — don't recurse (misleading child errors)
    }
  }

  // enum
  if (Array.isArray(schema.enum)) {
    const enumVals = /** @type {any[]} */ (schema.enum);
    if (!enumVals.some((e) => JSON.stringify(e) === JSON.stringify(value))) {
      errors.push({
        path: ptr,
        message: `deve ser um de: ${enumVals.map((e) => JSON.stringify(e)).join(", ")}`,
      });
    }
  }

  // const
  if ("const" in schema && JSON.stringify(value) !== JSON.stringify(schema.const)) {
    errors.push({ path: ptr, message: `deve ser ${JSON.stringify(schema.const)}` });
  }

  // String keywords
  if (typeof value === "string") {
    if (schema.pattern && !new RegExp(schema.pattern).test(value)) {
      errors.push({ path: ptr, message: `não corresponde ao padrão "${schema.pattern}"` });
    }
    if (schema.minLength !== undefined && value.length < schema.minLength) {
      errors.push({
        path: ptr,
        message: `comprimento mínimo ${schema.minLength}, encontrado ${value.length}`,
      });
    }
    if (schema.maxLength !== undefined && value.length > schema.maxLength) {
      errors.push({
        path: ptr,
        message: `comprimento máximo ${schema.maxLength}, encontrado ${value.length}`,
      });
    }
  }

  // Number keywords
  if (typeof value === "number") {
    if (schema.minimum !== undefined && value < schema.minimum) {
      errors.push({ path: ptr, message: `mínimo ${schema.minimum}, encontrado ${value}` });
    }
    if (schema.maximum !== undefined && value > schema.maximum) {
      errors.push({ path: ptr, message: `máximo ${schema.maximum}, encontrado ${value}` });
    }
  }

  // Object keywords
  if (value !== null && typeof value === "object" && !Array.isArray(value)) {
    for (const key of schema.required ?? []) {
      if (!(key in value)) {
        errors.push({ path: `${ptr}/${key}`, message: "campo obrigatório ausente" });
      }
    }
    if (schema.properties) {
      for (const [key, propSchema] of Object.entries(schema.properties)) {
        if (key in value) {
          errors.push(...validate(value[key], propSchema, root, `${ptr}/${key}`));
        }
      }
    }
    // additionalProperties: false — flag unknown keys
    if (schema.additionalProperties === false && schema.properties) {
      const allowed = new Set(Object.keys(schema.properties));
      for (const key of Object.keys(value)) {
        if (!allowed.has(key)) {
          errors.push({
            path: `${ptr}/${key}`,
            message: "propriedade adicional não permitida",
          });
        }
      }
    }
    // additionalProperties: schema — validate unknown keys against it
    if (
      schema.additionalProperties &&
      typeof schema.additionalProperties === "object" &&
      schema.properties
    ) {
      const known = new Set(Object.keys(schema.properties));
      for (const [key, val] of Object.entries(value)) {
        if (!known.has(key)) {
          errors.push(...validate(val, schema.additionalProperties, root, `${ptr}/${key}`));
        }
      }
    }
  }

  // Array keywords
  if (Array.isArray(value) && schema.items) {
    for (let i = 0; i < value.length; i++) {
      errors.push(...validate(value[i], schema.items, root, `${ptr}/${i}`));
    }
  }

  // Combiners
  if (Array.isArray(schema.allOf)) {
    for (const sub of schema.allOf) errors.push(...validate(value, sub, root, ptr));
  }
  for (const combiner of ["anyOf", "oneOf"]) {
    if (Array.isArray(schema[combiner])) {
      const branchErrs = /** @type {any[][]} */ (schema[combiner]).map((s) =>
        validate(value, s, root, ptr),
      );
      if (!branchErrs.some((e) => e.length === 0)) {
        errors.push({
          path: ptr,
          message: `não corresponde a nenhuma variante permitida (${combiner})`,
        });
      }
    }
  }

  return errors;
}

/**
 * @param {any} value
 * @param {string} type
 * @returns {boolean}
 */
function checkType(value, type) {
  if (type === "null") return value === null;
  if (type === "integer") return Number.isInteger(value);
  if (type === "array") return Array.isArray(value);
  if (type === "object")
    return value !== null && typeof value === "object" && !Array.isArray(value);
  return typeof value === type;
}
