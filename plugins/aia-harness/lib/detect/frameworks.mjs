/**
 * Framework detection from dependency sets + marker files.
 * @module detect/frameworks
 */
import path from "node:path";
import { FRAMEWORKS } from "../data/frameworks.mjs";
import { readJson, readText } from "../util/fs.mjs";

/**
 * Gather dependency names (and best-effort versions) from common manifests.
 * @param {string} root
 * @returns {{ deps: Set<string>, versions: Map<string, string> }}
 */
function collectDeps(root) {
  /** @type {Set<string>} */
  const deps = new Set();
  /** @type {Map<string, string>} */
  const versions = new Map();

  /** @param {Record<string, unknown>|null|undefined} obj */
  const ingest = (obj) => {
    if (!obj || typeof obj !== "object") return;
    for (const [k, v] of Object.entries(obj)) {
      deps.add(k);
      if (typeof v === "string" && !versions.has(k)) versions.set(k, v);
    }
  };

  const pkg = readJson(path.join(root, "package.json"));
  if (pkg) {
    ingest(pkg.dependencies);
    ingest(pkg.devDependencies);
    ingest(pkg.peerDependencies);
    ingest(pkg.optionalDependencies);
  }

  const composer = readJson(path.join(root, "composer.json"));
  if (composer) {
    ingest(composer.require);
    ingest(composer["require-dev"]);
  }

  const py = readText(path.join(root, "pyproject.toml")) ?? readText(path.join(root, "requirements.txt")) ?? "";
  for (const line of py.split(/\r?\n/)) {
    const m = line.trim().toLowerCase().match(/^["']?([a-z0-9_.-]+)/);
    if (m) deps.add(m[1]);
  }

  const jvm =
    readText(path.join(root, "pom.xml")) ??
    readText(path.join(root, "build.gradle")) ??
    readText(path.join(root, "build.gradle.kts")) ??
    "";
  for (const m of jvm.matchAll(/(org\.springframework\.boot|io\.quarkus|io\.micronaut|spring-boot-starter[\w-]*)/g)) {
    deps.add(m[1]);
  }

  const gem = readText(path.join(root, "Gemfile")) ?? "";
  for (const m of gem.matchAll(/gem\s+['"]([^'"]+)['"]/g)) deps.add(m[1]);

  return { deps, versions };
}

/**
 * @param {string} root
 * @param {Set<string>} relPaths  All file paths relative to root (POSIX).
 * @returns {import('../profile.mjs').FrameworkInfo[]}
 */
export function detectFrameworks(root, relPaths) {
  const { deps, versions } = collectDeps(root);
  /** @type {import('../profile.mjs').FrameworkInfo[]} */
  const out = [];

  for (const fw of FRAMEWORKS) {
    let evidence = "";
    if (fw.deps) {
      for (const d of fw.deps) {
        if (deps.has(d)) {
          evidence = `dependency ${d}`;
          break;
        }
      }
    }
    if (!evidence && fw.depPrefixes) {
      for (const prefix of fw.depPrefixes) {
        for (const d of deps) {
          if (d.startsWith(prefix)) {
            evidence = `dependency ${d}`;
            break;
          }
        }
        if (evidence) break;
      }
    }
    if (!evidence && fw.markers) {
      for (const marker of fw.markers) {
        if (relPaths.has(marker)) {
          evidence = `marker ${marker}`;
          break;
        }
      }
    }
    if (!evidence) continue;

    /** @type {string|null} */
    let version = null;
    if (fw.deps) {
      for (const d of fw.deps) {
        const v = versions.get(d);
        if (v) {
          version = v;
          break;
        }
      }
    }
    out.push({ name: fw.name, category: fw.category, version, evidence });
  }

  return out;
}
