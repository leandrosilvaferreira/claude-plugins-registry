/**
 * Monorepo / workspace detection.
 * @module detect/monorepo
 */
import path from "node:path";
import { readJson, readText } from "../util/fs.mjs";

/**
 * @param {string|null} tool
 * @param {string} evidence
 * @param {string[]} packages
 * @returns {import('../profile.mjs').MonorepoInfo}
 */
function mono(tool, evidence, packages) {
  return { isMonorepo: true, tool, packages, evidence };
}

/**
 * @param {string} root
 * @returns {string[]}
 */
function npmWorkspaces(root) {
  const pkg = readJson(path.join(root, "package.json"));
  if (!pkg || !pkg.workspaces) return [];
  if (Array.isArray(pkg.workspaces)) return pkg.workspaces;
  if (Array.isArray(pkg.workspaces.packages)) return pkg.workspaces.packages;
  return [];
}

/**
 * @param {string} root
 * @returns {string[]}
 */
function pnpmWorkspaces(root) {
  const txt = readText(path.join(root, "pnpm-workspace.yaml")) ?? "";
  /** @type {string[]} */
  const out = [];
  for (const m of txt.matchAll(/^\s*-\s*['"]?([^'"\n]+?)['"]?\s*$/gm)) out.push(m[1].trim());
  return out;
}

/**
 * @param {string} root
 * @param {Set<string>} rootFiles
 * @returns {import('../profile.mjs').MonorepoInfo}
 */
export function detectMonorepo(root, rootFiles) {
  const has = (/** @type {string} */ f) => rootFiles.has(f);

  if (has("turbo.json")) return mono("turborepo", "turbo.json", npmWorkspaces(root));
  if (has("nx.json")) return mono("nx", "nx.json", []);
  if (has("lerna.json")) return mono("lerna", "lerna.json", npmWorkspaces(root));
  if (has("rush.json")) return mono("rush", "rush.json", []);
  if (has("pnpm-workspace.yaml")) return mono("pnpm", "pnpm-workspace.yaml", pnpmWorkspaces(root));

  const pkg = readJson(path.join(root, "package.json"));
  if (pkg && pkg.workspaces) return mono("npm-workspaces", "package.json workspaces", npmWorkspaces(root));

  if (has("go.work")) return mono("go-work", "go.work", []);

  const cargo = readText(path.join(root, "Cargo.toml")) ?? "";
  if (/\[workspace\]/.test(cargo)) return mono("cargo-workspace", "Cargo.toml [workspace]", []);

  return { isMonorepo: false, tool: null, packages: [], evidence: null };
}
