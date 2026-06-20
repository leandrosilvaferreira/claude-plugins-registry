/**
 * Package manager / ecosystem detection.
 * @module detect/package-manager
 */
import path from "node:path";
import { readJson, readText } from "../util/fs.mjs";

/**
 * @param {string} root
 * @param {Set<string>} rootFiles  Basenames of files at the project root.
 * @param {import('../profile.mjs').LanguageInfo[]} [languages]  Detected languages (for runtime-only fallbacks).
 * @returns {import('../profile.mjs').PackageManagerInfo[]}
 */
export function detectPackageManagers(root, rootFiles, languages = []) {
  /** @type {import('../profile.mjs').PackageManagerInfo[]} */
  const pms = [];
  const has = (/** @type {string} */ f) => rootFiles.has(f);

  if (has("package.json")) {
    const pkg = readJson(path.join(root, "package.json")) ?? {};
    /** @type {string} */
    let name = "npm";
    /** @type {string|null} */
    let version = null;
    let evidence = "package.json (no lockfile; default npm)";
    if (typeof pkg.packageManager === "string") {
      const [n, v] = pkg.packageManager.split("@");
      name = n;
      version = v ?? null;
      evidence = `packageManager field: ${pkg.packageManager}`;
    } else if (has("pnpm-lock.yaml")) {
      name = "pnpm";
      evidence = "pnpm-lock.yaml";
    } else if (has("yarn.lock")) {
      name = "yarn";
      evidence = "yarn.lock";
    } else if (has("package-lock.json") || has("npm-shrinkwrap.json")) {
      name = "npm";
      evidence = "package-lock.json";
    } else if (has("bun.lockb") || has("bun.lock")) {
      name = "bun";
      evidence = "bun lockfile";
    }
    pms.push({ name, ecosystem: "js", version, evidence });
  }

  if (has("composer.json")) {
    pms.push({
      name: "composer",
      ecosystem: "php",
      version: null,
      evidence: has("composer.lock") ? "composer.json + composer.lock" : "composer.json",
    });
  }

  if (has("pyproject.toml")) {
    const txt = readText(path.join(root, "pyproject.toml")) ?? "";
    let name = "pip";
    let evidence = "pyproject.toml (PEP 621)";
    if (/\[tool\.poetry\]/.test(txt) || has("poetry.lock")) {
      name = "poetry";
      evidence = "poetry";
    } else if (/\[tool\.uv\]/.test(txt) || has("uv.lock")) {
      name = "uv";
      evidence = "uv";
    } else if (/\[tool\.pdm\]/.test(txt) || has("pdm.lock")) {
      name = "pdm";
      evidence = "pdm";
    }
    pms.push({ name, ecosystem: "python", version: null, evidence });
  } else if (has("requirements.txt") || has("Pipfile")) {
    pms.push({
      name: has("Pipfile") ? "pipenv" : "pip",
      ecosystem: "python",
      version: null,
      evidence: has("Pipfile") ? "Pipfile" : "requirements.txt",
    });
  }

  if (has("go.mod")) pms.push({ name: "go", ecosystem: "go", version: null, evidence: "go.mod" });
  if (has("Cargo.toml")) pms.push({ name: "cargo", ecosystem: "rust", version: null, evidence: "Cargo.toml" });
  if (has("pom.xml")) pms.push({ name: "maven", ecosystem: "jvm", version: null, evidence: "pom.xml" });
  if (has("build.gradle") || has("build.gradle.kts"))
    pms.push({ name: "gradle", ecosystem: "jvm", version: null, evidence: "gradle build file" });
  if (has("Gemfile")) pms.push({ name: "bundler", ecosystem: "ruby", version: null, evidence: "Gemfile" });

  // Native PHP: .php sources present but no Composer manifest.
  const hasPhpPm = pms.some((p) => p.ecosystem === "php");
  const hasPhpLang = languages.some((l) => l.name === "PHP" && l.type === "programming");
  if (!hasPhpPm && hasPhpLang) {
    pms.push({ name: "php", ecosystem: "php", version: null, evidence: "PHP sources, no Composer" });
  }

  return pms;
}
