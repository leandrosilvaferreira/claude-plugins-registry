#!/usr/bin/env node
/**
 * Vendor a curated subset of ECC (affaan-m/ECC, MIT) into templates/ecc/.
 * One GitHub API call (recursive tree); all file content via the raw CDN, so
 * we never hit the API rate limit. Run with: npm run sync:ecc
 *
 * @module scripts/sync-ecc
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { allEccAssets } from "../lib/data/ecc-catalog.mjs";
import { cleanAgentMarkdown, stampProvenance } from "../lib/ecc/transform.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..");
const ECC_DIR = path.join(ROOT, "templates", "ecc");
const SOURCE_PATH = path.join(HERE, "ecc-source.json");
const PATCHES_DIR = path.join(HERE, "ecc-patches");

/** @type {{ repo: string, ref: string, commit: string|null, rawBase: string, apiBase: string, attribution: string }} */
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

/** @returns {Promise<string>} */
async function resolveCommit() {
  if (source.commit) return source.commit;
  const res = await get(`${source.apiBase}/repos/${source.repo}/commits/${source.ref}`);
  const json = /** @type {any} */ (await res.json());
  return json.sha;
}

/**
 * @param {string} commit
 * @returns {Promise<{ path: string, type: string }[]>}
 */
async function fetchTree(commit) {
  const res = await get(`${source.apiBase}/repos/${source.repo}/git/trees/${commit}?recursive=1`);
  const json = /** @type {any} */ (await res.json());
  if (json.truncated) {
    throw new Error("ECC git tree is truncated; re-run with GITHUB_TOKEN or narrow the catalog.");
  }
  return json.tree;
}

/** @param {string} commit @param {string} repoPath @returns {Promise<string>} */
async function fetchRaw(commit, repoPath) {
  const res = await get(`${source.rawBase}/${source.repo}/${commit}/${repoPath}`);
  return res.text();
}

/** @param {string} target @param {string} content */
function writeFile(target, content) {
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, content);
}

async function main() {
  const commit = await resolveCommit();
  console.log(`ECC sync @ ${commit}`);
  const tree = await fetchTree(commit);
  const blobPaths = new Set(tree.filter((t) => t.type === "blob").map((t) => t.path));
  const dirSet = new Set(tree.filter((t) => t.type === "tree").map((t) => t.path));

  const want = allEccAssets();
  /** @type {string[]} */
  const wanted = [];

  for (const name of want.agents) {
    const p = `agents/${name}.md`;
    if (blobPaths.has(p)) wanted.push(p);
    else console.warn(`  ! missing agent: ${p}`);
  }
  for (const dir of want.rules) {
    const prefix = `rules/${dir}/`;
    const found = [...blobPaths].filter((p) => p.startsWith(prefix) && p.endsWith(".md"));
    if (found.length === 0) console.warn(`  ! no rules under: ${prefix}`);
    wanted.push(...found);
  }
  for (const name of want.skills) {
    const prefix = `skills/${name}/`;
    if (!dirSet.has(`skills/${name}`)) console.warn(`  ! missing skill: ${name}`);
    wanted.push(...[...blobPaths].filter((p) => p.startsWith(prefix)));
  }
  if (blobPaths.has("LICENSE")) wanted.push("LICENSE");

  // Fresh output dir.
  fs.rmSync(ECC_DIR, { recursive: true, force: true });

  const counts = { agents: 0, rules: 0, skills: 0, other: 0 };
  for (const repoPath of wanted) {
    const raw = await fetchRaw(commit, repoPath);
    const meta = { sourcePath: repoPath, commit };
    let content = raw;
    if (repoPath.startsWith("agents/")) {
      content = cleanAgentMarkdown(raw, meta);
      counts.agents += 1;
    } else if (repoPath.startsWith("rules/")) {
      content = stampProvenance(raw, meta);
      counts.rules += 1;
    } else if (repoPath.endsWith("/SKILL.md")) {
      content = stampProvenance(raw, meta);
      counts.skills += 1;
    } else {
      counts.other += 1;
    }
    const rel = repoPath === "LICENSE" ? "LICENSE" : repoPath;
    const outPath = path.join(ECC_DIR, rel);
    writeFile(outPath, content);

    // Apply harness-specific patch if one exists for this asset.
    const patchPath = path.join(PATCHES_DIR, repoPath);
    if (fs.existsSync(patchPath)) {
      const patch = fs.readFileSync(patchPath, "utf8");
      fs.appendFileSync(outPath, `\n${patch}`);
      console.log(`  + patch applied: ${repoPath}`);
    }
  }

  const manifest = {
    source: source.repo,
    ref: source.ref,
    commit,
    attribution: source.attribution,
    vendoredAt: new Date().toISOString(),
    counts,
    assets: want,
  };
  writeFile(path.join(ECC_DIR, "MANIFEST.json"), JSON.stringify(manifest, null, 2) + "\n");

  // Pin the resolved commit for reproducible future syncs.
  if (!source.commit) {
    source.commit = commit;
    fs.writeFileSync(SOURCE_PATH, JSON.stringify(source, null, 2) + "\n");
  }

  console.log(`Vendored: ${counts.agents} agents, ${counts.rules} rule files, ${counts.skills} skills (+${counts.other} support files).`);
  console.log(`-> ${path.relative(ROOT, ECC_DIR)}`);
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
