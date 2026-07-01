#!/usr/bin/env node
/**
 * Vendor a curated subset of ag-kit (vudovn/ag-kit, MIT) into templates/ag-kit/.
 * One GitHub API call (recursive tree); all file content via the raw CDN.
 * Frontmatters are converted to Claude Code conventions via lib/agkit/transform.
 * Run with: npm run sync:agkit
 *
 * @module scripts/sync-agkit
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { allAgkitAssets } from "../lib/data/agkit-catalog.mjs";
import {
  cleanAgentMarkdown,
  cleanSkillMarkdown,
  cleanCommandMarkdown,
  cleanScript,
  stampMarkdown,
} from "../lib/agkit/transform.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..");
const OUT_DIR = path.join(ROOT, "templates", "ag-kit");
const SOURCE_PATH = path.join(HERE, "agkit-source.json");

/** @type {{ repo: string, ref: string, commit: string|null, rawBase: string, apiBase: string, attribution: string }} */
const source = JSON.parse(fs.readFileSync(SOURCE_PATH, "utf8"));

const AG = ".agents";

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

/** @param {string} commit @returns {Promise<{ path: string, type: string }[]>} */
async function fetchTree(commit) {
  const res = await get(`${source.apiBase}/repos/${source.repo}/git/trees/${commit}?recursive=1`);
  const json = /** @type {any} */ (await res.json());
  if (json.truncated)
    throw new Error(
      "ag-kit git tree is truncated; narrow the catalog entries in agkit-catalog.mjs.",
    );
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
  console.log(`ag-kit sync @ ${commit}`);
  const tree = await fetchTree(commit);
  const blobPaths = new Set(tree.filter((t) => t.type === "blob").map((t) => t.path));

  const want = allAgkitAssets();
  fs.rmSync(OUT_DIR, { recursive: true, force: true });
  const counts = { agents: 0, skills: 0, commands: 0, scripts: 0, other: 0 };

  // Agents.
  for (const name of want.agents) {
    const repoPath = `${AG}/agent/${name}.md`;
    if (!blobPaths.has(repoPath)) {
      console.warn(`  ! missing agent: ${repoPath}`);
      continue;
    }
    const raw = await fetchRaw(commit, repoPath);
    writeFile(
      path.join(OUT_DIR, "agents", `${name}.md`),
      cleanAgentMarkdown(raw, { sourcePath: repoPath, commit }),
    );
    counts.agents += 1;
  }

  // Skills (whole directory; SKILL.md transformed, support files verbatim).
  for (const name of want.skills) {
    const prefix = `${AG}/skills/${name}/`;
    const files = [...blobPaths].filter((p) => p.startsWith(prefix));
    if (files.length === 0) {
      console.warn(`  ! missing skill: ${name}`);
      continue;
    }
    for (const repoPath of files) {
      const raw = await fetchRaw(commit, repoPath);
      const rel = repoPath.slice(`${AG}/skills/`.length); // <name>/...
      const meta = { sourcePath: repoPath, commit };
      let content;
      if (repoPath.endsWith("/SKILL.md")) {
        content = cleanSkillMarkdown(raw, meta);
      } else if (repoPath.endsWith(".md")) {
        content = stampMarkdown(raw, meta);
      } else if (repoPath.endsWith(".py")) {
        content = cleanScript(raw, meta);
      } else {
        content = raw;
      }
      writeFile(path.join(OUT_DIR, "skills", rel), content);
    }
    counts.skills += 1;
  }

  // Commands (ag-kit workflows).
  for (const name of want.commands) {
    const repoPath = `${AG}/workflows/${name}.md`;
    if (!blobPaths.has(repoPath)) {
      console.warn(`  ! missing command: ${repoPath}`);
      continue;
    }
    const raw = await fetchRaw(commit, repoPath);
    writeFile(
      path.join(OUT_DIR, "commands", `${name}.md`),
      cleanCommandMarkdown(raw, { sourcePath: repoPath, commit }),
    );
    counts.commands += 1;
  }

  // Scripts.
  for (const name of want.scripts) {
    const repoPath = `${AG}/scripts/${name}.py`;
    if (!blobPaths.has(repoPath)) {
      console.warn(`  ! missing script: ${repoPath}`);
      continue;
    }
    const raw = await fetchRaw(commit, repoPath);
    writeFile(
      path.join(OUT_DIR, "scripts", `${name}.py`),
      cleanScript(raw, { sourcePath: repoPath, commit }),
    );
    counts.scripts += 1;
  }

  // License (verbatim).
  if (blobPaths.has("LICENSE")) {
    writeFile(path.join(OUT_DIR, "LICENSE"), await fetchRaw(commit, "LICENSE"));
    counts.other += 1;
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
  writeFile(path.join(OUT_DIR, "MANIFEST.json"), JSON.stringify(manifest, null, 2) + "\n");

  if (!source.commit) {
    source.commit = commit;
    fs.writeFileSync(SOURCE_PATH, JSON.stringify(source, null, 2) + "\n");
  }

  console.log(
    `Vendored: ${counts.agents} agents, ${counts.skills} skills, ${counts.commands} commands, ${counts.scripts} scripts.`,
  );
  console.log(`-> ${path.relative(ROOT, OUT_DIR)}`);
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
