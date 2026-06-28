#!/usr/bin/env node
/**
 * Refresh every vendored/first-party agent file's `description` frontmatter from
 * the canonical catalog maps, in place. Idempotent. Lets the maps be the source
 * of truth without a network re-sync (sync:ecc/sync:agkit do the same inline).
 */
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { splitFrontmatter } from "../lib/ecc/transform.mjs";
import { parseFrontmatter, renderFrontmatter } from "../lib/util/frontmatter-yaml.mjs";
import { applyCanonicalDescription } from "../lib/validate/agent-description.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const DIRS = [
  path.join(ROOT, "templates", "ecc", "agents"),
  path.join(ROOT, "templates", "ag-kit", "agents"),
  path.join(ROOT, "templates", "agents"),
];

let changed = 0;
for (const dir of DIRS) {
  let files;
  try {
    files = readdirSync(dir).filter((f) => f.endsWith(".md"));
  } catch {
    continue;
  }
  for (const file of files) {
    const full = path.join(dir, file);
    const content = readFileSync(full, "utf8");
    const { frontmatter, body } = splitFrontmatter(content);
    if (!frontmatter) continue;
    const name = file.replace(/\.md$/, "");
    const entries = applyCanonicalDescription(parseFrontmatter(frontmatter), name);
    const fm = renderFrontmatter(entries, { fold: new Set(["description"]) });
    const next = `${fm}${body}`;
    if (next !== content) {
      writeFileSync(full, next);
      changed += 1;
    }
  }
}
console.log(`apply-agent-descriptions: updated ${changed} file(s).`);
