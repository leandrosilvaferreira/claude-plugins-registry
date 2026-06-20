/**
 * Architecture inference from directory structure.
 * @module detect/architecture
 */
import path from "node:path";
import { listDirs } from "../util/fs.mjs";

/** Directory names that signal a classic application layer. */
const LAYER_DIRS = new Set([
  "controllers",
  "controller",
  "services",
  "service",
  "models",
  "model",
  "repositories",
  "repository",
  "routes",
  "router",
  "views",
  "view",
  "components",
  "pages",
  "middleware",
  "middlewares",
  "entities",
  "entity",
  "usecases",
  "use-cases",
  "domain",
  "application",
  "infrastructure",
  "infra",
  "adapters",
  "ports",
  "handlers",
  "resolvers",
  "schemas",
  "migrations",
  "api",
  "store",
  "stores",
]);

/** Directory names that contain multiple sub-projects / domains. */
const CONTAINER_DIRS = ["apps", "packages", "libs", "services", "modules", "domains", "features"];

/**
 * @param {string} s
 * @returns {string}
 */
function singular(s) {
  return s.endsWith("s") ? s.slice(0, -1) : s;
}

/**
 * @param {string} container
 * @returns {import('../profile.mjs').DomainInfo["kind"]}
 */
function kindFor(container) {
  switch (container) {
    case "apps":
      return "app";
    case "packages":
    case "libs":
      return "package";
    case "services":
      return "service";
    case "features":
      return "feature";
    default:
      return "module";
  }
}

/**
 * @param {string} root
 * @param {import('../profile.mjs').MonorepoInfo} monorepo
 * @returns {import('../profile.mjs').ArchitectureInfo}
 */
export function detectArchitecture(root, monorepo) {
  /** @type {string[]} */
  const signals = [];
  /** @type {import('../profile.mjs').DomainInfo[]} */
  const domains = [];
  const top = listDirs(root);

  for (const container of CONTAINER_DIRS) {
    if (!top.includes(container)) continue;
    signals.push(`${container}/ container`);
    for (const child of listDirs(path.join(root, container))) {
      domains.push({
        path: `${container}/${child}`,
        kind: kindFor(container),
        role: `${child} ${singular(container)}`,
      });
    }
  }

  const codeRoots = ["src", "app", "lib"].filter((d) => top.includes(d));
  let layeredCount = 0;
  for (const cr of codeRoots) {
    for (const child of listDirs(path.join(root, cr))) {
      if (LAYER_DIRS.has(child.toLowerCase())) {
        layeredCount += 1;
        domains.push({ path: `${cr}/${child}`, kind: "layer", role: `${child} layer` });
      }
    }
  }

  /** @type {import('../profile.mjs').ArchitectureInfo["style"]} */
  let style = "flat";
  if (monorepo.isMonorepo) {
    style = "monorepo";
    signals.push(`monorepo (${monorepo.tool})`);
  } else if (domains.some((d) => d.kind === "module" || d.kind === "feature" || d.kind === "service")) {
    style = "modular";
  } else if (layeredCount >= 2) {
    style = "layered";
    signals.push(`${layeredCount} layer directories`);
  } else if (codeRoots.length > 0) {
    style = "layered";
  }

  /** @type {Set<string>} */
  const seen = new Set();
  /** @type {import('../profile.mjs').DomainInfo[]} */
  const unique = [];
  for (const d of domains) {
    if (seen.has(d.path)) continue;
    seen.add(d.path);
    unique.push(d);
  }

  return { style, domains: unique.slice(0, 40), signals };
}
