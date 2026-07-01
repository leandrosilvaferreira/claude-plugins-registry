#!/usr/bin/env node
/**
 * Vendor github-issues skill from github/awesome-copilot into
 * templates/github-pm-ext/github-issues/.
 * Run: npm run sync:github-issues
 *
 * @module scripts/sync-github-issues
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { transformSkill } from "../lib/github-pm/transform.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..");
const SOURCE_PATH = path.join(HERE, "github-issues-source.json");
const OUT_DIR = path.join(ROOT, "templates", "github-pm-ext", "github-issues");
const MANIFEST_FILE = path.join(ROOT, "templates", "github-pm-ext", "MANIFEST.json");

/** @type {{ repo: string, commit: string, path: string, license: string, description: string }} */
const source = JSON.parse(fs.readFileSync(SOURCE_PATH, "utf8"));
const { repo, commit, path: srcPath, license } = source;

const API_BASE = "https://api.github.com";
const RAW_BASE = "https://raw.githubusercontent.com";

/**
 * @param {string} url
 * @returns {Promise<Response>}
 */
async function get(url) {
  /** @type {Record<string, string>} */
  const headers = { "User-Agent": "aia-harness-sync", Accept: "application/vnd.github.v3+json" };
  const token = process.env.GITHUB_TOKEN;
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(url, { headers });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  return res;
}

/**
 * Fetch and parse JSON from the GitHub API.
 * @param {string} url
 * @returns {Promise<any>}
 */
async function getJson(url) {
  const res = await get(url);
  return res.json();
}

/**
 * Fetch raw file content.
 * @param {string} repoPath
 * @returns {Promise<string>}
 */
async function fetchRaw(repoPath) {
  const res = await get(`${RAW_BASE}/${repo}/${commit}/${repoPath}`);
  return res.text();
}

/**
 * List all blobs under srcPath using the Git Trees API (recursive).
 * @returns {Promise<{ path: string }[]>}
 */
async function listAllBlobs() {
  const commitData = await getJson(`${API_BASE}/repos/${repo}/commits/${commit}`);
  const treeSha = commitData.commit.tree.sha;
  const treeData = await getJson(`${API_BASE}/repos/${repo}/git/trees/${treeSha}?recursive=1`);
  if (treeData.truncated) {
    console.warn("  ⚠ git tree response was truncated — some files may be missing");
  }
  const prefix = `${srcPath}/`;
  return (treeData.tree ?? []).filter(
    (/** @type {{ path: string, type: string }} */ item) =>
      item.type === "blob" && item.path.startsWith(prefix),
  );
}

async function main() {
  console.log(`sync:github-issues @ ${commit} (${repo})`);

  fs.rmSync(OUT_DIR, { recursive: true, force: true });
  fs.mkdirSync(OUT_DIR, { recursive: true });

  const blobs = await listAllBlobs();
  let count = 0;
  for (const blob of blobs) {
    const repoRelPath = blob.path;
    const destRelPath = repoRelPath.slice(srcPath.length + 1);
    const destAbs = path.join(OUT_DIR, destRelPath);
    fs.mkdirSync(path.dirname(destAbs), { recursive: true });
    const raw = await fetchRaw(repoRelPath);
    const content = destRelPath.endsWith(".md")
      ? transformSkill(raw, { repo, commit, filePath: repoRelPath, license })
      : raw;
    fs.writeFileSync(destAbs, content, "utf8");
    console.log(`  ✓ ${destRelPath}`);
    count += 1;
  }

  // Update MANIFEST.json (shared with sync-github-project)
  /** @type {Record<string, unknown>} */
  let manifest = {};
  try {
    manifest = JSON.parse(fs.readFileSync(MANIFEST_FILE, "utf8"));
  } catch {
    // file may not exist yet
  }
  manifest["github-issues"] = {
    repo,
    commit,
    license,
    path: srcPath,
    vendoredAt: new Date().toISOString(),
  };
  fs.mkdirSync(path.dirname(MANIFEST_FILE), { recursive: true });
  fs.writeFileSync(MANIFEST_FILE, JSON.stringify(manifest, null, 2) + "\n", "utf8");

  console.log(`Vendored ${count} file(s) -> templates/github-pm-ext/github-issues/`);
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
