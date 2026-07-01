#!/usr/bin/env node
/**
 * Bump version, sync aia-harness to claude-plugins-registry, update SHA pin.
 *
 * Usage:
 *   npm run publish-registry              # interactive (asks bump type)
 *   BUMP=patch npm run publish-registry   # patch bump, no prompt
 *   BUMP=minor npm run publish-registry   # minor bump
 *   BUMP=major npm run publish-registry   # major bump
 *   BUMP=skip  npm run publish-registry   # skip bump, sync only
 *   REGISTRY_DIR=/other/path npm run publish-registry
 */

import { execFileSync } from "node:child_process";
import { cpSync, existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createInterface } from "node:readline";

const PLUGIN_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const REGISTRY_DIR = resolve(
  process.argv[2] ?? process.env.REGISTRY_DIR ?? `${PLUGIN_DIR}/../claude-plugins-registry`,
);
const PLUGIN_DEST = `${REGISTRY_DIR}/plugins/aia-harness`;
const MARKETPLACE_JSON = `${REGISTRY_DIR}/.claude-plugin/marketplace.json`;
const REGISTRY_JSON = `${REGISTRY_DIR}/registry.json`;
const PLUGIN_JSON = `${PLUGIN_DIR}/.claude-plugin/plugin.json`;
const PACKAGE_JSON = `${PLUGIN_DIR}/package.json`;

// ── helpers ────────────────────────────────────────────────────────────────

/**
 * @param {string[]} args
 * @param {string} [cwd]
 * @returns {string}
 */
function git(args, cwd = PLUGIN_DIR) {
  return execFileSync("git", args, { cwd, encoding: "utf8", windowsHide: true }).trim();
}

/**
 * @param {string} question
 * @param {string} [envOverride] - env var that bypasses the prompt (e.g. 'yes'/'no')
 * @returns {Promise<string>}
 */
function ask(question, envOverride = "") {
  if (envOverride) {
    process.stdout.write(`${question}${envOverride}\n`);
    return Promise.resolve(envOverride);
  }
  return new Promise((res) => {
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    rl.on("close", () => res(""));
    rl.question(question, (answer) => {
      rl.close();
      res(answer.trim());
    });
  });
}

/** @param {string} msg */
function log(msg) {
  process.stdout.write(`\n${msg}\n`);
}

/**
 * @param {string} version
 * @param {'major'|'minor'|'patch'} type
 * @returns {string}
 */
function bumpVersion(version, type) {
  const [major, minor, patch] = version.split(".").map(Number);
  if (type === "major") return `${major + 1}.0.0`;
  if (type === "minor") return `${major}.${minor + 1}.0`;
  return `${major}.${minor}.${patch + 1}`;
}

// ── preflight ──────────────────────────────────────────────────────────────

if (!existsSync(REGISTRY_DIR)) {
  console.error(`Registry not found: ${REGISTRY_DIR}`);
  console.error("Usage: REGISTRY_DIR=/path/to/registry npm run publish-registry");
  process.exit(1);
}
if (!existsSync(MARKETPLACE_JSON)) {
  console.error(`marketplace.json not found: ${MARKETPLACE_JSON}`);
  process.exit(1);
}

const dirty = git(["status", "--porcelain"]);
if (dirty) {
  log(`⚠  Uncommitted changes in plugin repo:\n${dirty}`);
  const answer = await ask("Continue anyway? [y/N] ");
  if (!/^y$/i.test(answer)) process.exit(0);
}

// ── step 1: version bump ───────────────────────────────────────────────────

const pluginJson = JSON.parse(readFileSync(PLUGIN_JSON, "utf8"));
const packageJson = JSON.parse(readFileSync(PACKAGE_JSON, "utf8"));
const currentVersion = /** @type {string} */ (pluginJson.version ?? "0.0.0");

log(`Current version: ${currentVersion}`);

const bumpEnv = process.env.BUMP;
let bumpType = /** @type {'major'|'minor'|'patch'|'skip'} */ (
  bumpEnv === "major"
    ? "major"
    : bumpEnv === "minor"
      ? "minor"
      : bumpEnv === "patch"
        ? "patch"
        : bumpEnv === "skip"
          ? "skip"
          : ""
);

if (!bumpType) {
  const answer = await ask(
    `Bump type? [patch (${bumpVersion(currentVersion, "patch")}) / minor (${bumpVersion(currentVersion, "minor")}) / major (${bumpVersion(currentVersion, "major")}) / skip] `,
  );
  bumpType = /** @type {'major'|'minor'|'patch'|'skip'} */ (
    answer === "major"
      ? "major"
      : answer === "minor"
        ? "minor"
        : answer === "patch"
          ? "patch"
          : "skip"
  );
}

let newVersion = currentVersion;
if (bumpType !== "skip") {
  newVersion = bumpVersion(currentVersion, bumpType);
  pluginJson.version = newVersion;
  packageJson.version = newVersion;
  writeFileSync(PLUGIN_JSON, JSON.stringify(pluginJson, null, 2) + "\n");
  writeFileSync(PACKAGE_JSON, JSON.stringify(packageJson, null, 2) + "\n");

  git(["add", ".claude-plugin/plugin.json", "package.json"]);
  git(["commit", "-m", `chore: bump version ${currentVersion} → ${newVersion}`]);
  log(`✔  Version bumped: ${currentVersion} → ${newVersion}`);
}

// ── step 2: get plugin SHA (after version bump commit) ────────────────────

const pluginSha = git(["rev-parse", "HEAD"]);
const shortSha = pluginSha.slice(0, 8);
log(`Plugin SHA: ${pluginSha}`);

// ── step 3: sync plugin → registry ────────────────────────────────────────

log("Syncing plugin files to registry...");
const SYNC_EXCLUDES = ["node_modules", ".git", ".DS_Store"];
rmSync(PLUGIN_DEST, { recursive: true, force: true });
cpSync(PLUGIN_DIR, PLUGIN_DEST, {
  recursive: true,
  filter: (src) => {
    const name = src.split(/[\\/]/).pop() ?? "";
    if (SYNC_EXCLUDES.includes(name)) return false;
    if (name.endsWith(".test.mjs")) return false;
    return true;
  },
});

// ── step 4: commit rsync in registry ──────────────────────────────────────

const registryDirty = git(["status", "--porcelain"], REGISTRY_DIR);
if (!registryDirty) {
  log("✔  Plugin already up-to-date in registry. Nothing to sync.");
  process.exit(0);
}

const syncStat = git(["diff", "--stat"], REGISTRY_DIR);
log(`Changed files:\n${syncStat}`);

git(["add", "plugins/aia-harness"], REGISTRY_DIR);
git(["commit", "-m", `chore: sync aia-harness@${newVersion} @ ${shortSha}`], REGISTRY_DIR);
const syncSha = git(["rev-parse", "HEAD"], REGISTRY_DIR);

// ── step 5: update SHA + version pin in marketplace.json ──────────────────

log("Updating marketplace.json...");
const marketplace = JSON.parse(readFileSync(MARKETPLACE_JSON, "utf8"));
for (const plugin of marketplace.plugins) {
  if (plugin.name === "aia-harness") {
    if (plugin.source?.sha !== undefined) plugin.source.sha = syncSha;
  }
}
writeFileSync(MARKETPLACE_JSON, JSON.stringify(marketplace, null, 2) + "\n");

if (existsSync(REGISTRY_JSON)) {
  log("Updating registry.json...");
  const today = new Date().toISOString().slice(0, 10);
  const registryIndex = JSON.parse(readFileSync(REGISTRY_JSON, "utf8"));
  registryIndex.updatedAt = today;
  for (const plugin of registryIndex.plugins) {
    if (plugin.name === "aia-harness") {
      plugin.version = newVersion;
      plugin.publishedAt = today;
    }
  }
  writeFileSync(REGISTRY_JSON, JSON.stringify(registryIndex, null, 2) + "\n");
  git(["add", ".claude-plugin/marketplace.json", "registry.json"], REGISTRY_DIR);
} else {
  git(["add", ".claude-plugin/marketplace.json"], REGISTRY_DIR);
}
git(
  ["commit", "-m", `chore: release aia-harness@${newVersion} — sha ${syncSha.slice(0, 8)}`],
  REGISTRY_DIR,
);

log("✔  Registry updated. Recent commits:");
log(git(["log", "--oneline", "-4"], REGISTRY_DIR));

// ── step 6: git tag ───────────────────────────────────────────────────────

if (bumpType !== "skip") {
  const tagAnswer = await ask(
    `\nCreate git tag v${newVersion} in plugin repo? [Y/n] `,
    process.env.TAG ?? "",
  );
  if (!/^n$/i.test(tagAnswer)) {
    git(["tag", "-a", `v${newVersion}`, "-m", `release v${newVersion}`]);
    log(`✔  Tag created: v${newVersion}`);
  }
}

// ── step 7: push ──────────────────────────────────────────────────────────

const shouldPush = await ask("\nPush both repos to GitHub? [Y/n] ", process.env.PUSH ?? "");
if (!/^n$/i.test(shouldPush)) {
  log("Pushing plugin repo...");
  git(["push", "--follow-tags"]);
  log("Pushing registry...");
  git(["push"], REGISTRY_DIR);
  log(`\n✔  aia-harness@${newVersion} is live!`);
  log(
    "   https://github.com/leandrosilvaferreira/claude-plugins-registry/tree/main/plugins/aia-harness",
  );
  log("\nUsers install/update with:");
  log("   claude plugin install aia-harness");
  log("   claude plugin update aia-harness@leandro-plugins-registry");
} else {
  log(`Commits staged locally. Push manually:`);
  log(`   git push --follow-tags`);
  log(`   cd ${REGISTRY_DIR} && git push`);
}
