#!/usr/bin/env node
/**
 * Vendor file-based token-economy tools (caveman, ponytail) into templates/tools/.
 * One GitHub API call per tool (recursive tree); content via the raw CDN.
 * Run with: npm run sync:tools
 *
 * @module scripts/sync-tools
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { stampMarkdown, stampJs } from "../lib/tools/transform.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..");
const OUT_DIR = path.join(ROOT, "templates", "tools");
const SOURCE_PATH = path.join(HERE, "tools-source.json");

/** @type {{ rawBase: string, apiBase: string, tools: Record<string, any> }} */
const source = JSON.parse(fs.readFileSync(SOURCE_PATH, "utf8"));

/** @param {string} url @returns {Promise<Response>} */
async function get(url) {
  /** @type {Record<string, string>} */
  const headers = { "User-Agent": "aia-harness-sync" };
  const token = process.env.GITHUB_TOKEN;
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(url, { headers });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  return res;
}

/** @param {string} repo @param {string} ref @returns {Promise<string>} */
async function resolveCommit(repo, ref) {
  const res = await get(`${source.apiBase}/repos/${repo}/commits/${ref}`);
  const json = /** @type {any} */ (await res.json());
  return json.sha;
}

/** @param {string} repo @param {string} commit @returns {Promise<{ path: string, type: string }[]>} */
async function fetchTree(repo, commit) {
  const res = await get(`${source.apiBase}/repos/${repo}/git/trees/${commit}?recursive=1`);
  const json = /** @type {any} */ (await res.json());
  if (json.truncated) throw new Error(`tree truncated for ${repo}`);
  return json.tree;
}

/** @param {string} repo @param {string} commit @param {string} repoPath @returns {Promise<string>} */
async function fetchRaw(repo, commit, repoPath) {
  const res = await get(`${source.rawBase}/${repo}/${commit}/${repoPath}`);
  return res.text();
}

/** @param {string} target @param {string} content */
function writeFile(target, content) {
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, content);
}

/**
 * @param {string} id
 * @param {any} cfg
 */
async function vendorTool(id, cfg) {
  const commit = cfg.commit ?? (await resolveCommit(cfg.repo, cfg.ref));
  console.log(`  ${id}: ${cfg.repo} @ ${commit}`);
  const tree = await fetchTree(cfg.repo, commit);
  const blobs = tree.filter((t) => t.type === "blob").map((t) => t.path);
  const toolDir = path.join(OUT_DIR, id);
  fs.rmSync(toolDir, { recursive: true, force: true });

  const meta = (/** @type {string} */ sourcePath) => ({ repo: cfg.repo, commit, sourcePath, license: cfg.license });
  let skills = 0;
  let hooks = 0;

  // Skills: preserve sub-structure under skillsPath.
  const skillsPrefix = `${cfg.skillsPath}/`;
  for (const p of blobs.filter((b) => b.startsWith(skillsPrefix))) {
    const rel = p.slice(skillsPrefix.length);
    const raw = await fetchRaw(cfg.repo, commit, p);
    const content = p.endsWith("/SKILL.md") || p.endsWith(".md") ? stampMarkdown(raw, meta(p)) : raw;
    writeFile(path.join(toolDir, "skills", rel), content);
    if (p.endsWith("/SKILL.md")) skills += 1;
  }

  // Hooks: vendor flat by basename (activate / mode-tracker / config / runtime).
  const hooksPrefix = `${cfg.hooksPath}/`;
  for (const p of blobs.filter((b) => b.startsWith(hooksPrefix) && /\.(js|cjs|mjs|json|sh)$/.test(b))) {
    const base = p.slice(p.lastIndexOf("/") + 1);
    const raw = await fetchRaw(cfg.repo, commit, p);
    const content = /\.(js|cjs|mjs)$/.test(p) ? stampJs(raw, meta(p)) : raw;
    writeFile(path.join(toolDir, "hooks", base), content);
    hooks += 1;
  }

  // Force CommonJS resolution for the vendored hooks (they use require()), so
  // they work even when the target project's package.json is "type":"module".
  writeFile(path.join(toolDir, "hooks", "package.json"), JSON.stringify({ type: "commonjs" }, null, 2) + "\n");

  if (blobs.includes("LICENSE")) {
    writeFile(path.join(toolDir, "LICENSE"), await fetchRaw(cfg.repo, commit, "LICENSE"));
  }

  writeFile(
    path.join(toolDir, "MANIFEST.json"),
    JSON.stringify({ id, repo: cfg.repo, commit, license: cfg.license, counts: { skills, hooks } }, null, 2) + "\n",
  );

  if (!cfg.commit) {
    cfg.commit = commit;
  }
  console.log(`    -> ${skills} skills, ${hooks} hook files`);
}

async function main() {
  console.log("Vendoring tools...");
  for (const [id, cfg] of Object.entries(source.tools)) {
    await vendorTool(id, cfg);
  }
  // Pin resolved commits.
  fs.writeFileSync(SOURCE_PATH, JSON.stringify(source, null, 2) + "\n");
  console.log(`Done -> ${path.relative(ROOT, OUT_DIR)}`);
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
