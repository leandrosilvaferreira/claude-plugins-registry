/**
 * Catalog of ECC-sourced distributable assets (agents / skills / rule dirs),
 * mapped by detected stack. Vendored from upstream under templates/ecc/.
 * MIT © Affaan Mustafa — keep attribution in every vendored file.
 *
 * One module per provenance — see asset-catalog.mjs (barrel) for the full map.
 * Maintenance rule (CLAUDE.md): a new ECC asset under templates/ecc/ MUST be
 * registered here before merge.
 *
 * @module data/ecc-catalog
 */
import { stackKeys } from "./stack-keys.mjs";

/** @typedef {{ agents: string[], skills: string[], rules: string[] }} EccAssetSet */

/** Installed for every project. `common` is ECC's always-on rule dir. */
export const ECC_COMMON = {
  agents: ["security-reviewer", "code-reviewer"],
  skills: ["git-workflow", "api-design", "error-handling"],
  rules: ["common"],
};

/** @type {Record<string, EccAssetSet>} */
export const ECC_BY_STACK = {
  go: {
    agents: ["go-reviewer", "go-build-resolver"],
    skills: ["golang-patterns", "golang-testing"],
    rules: ["golang"],
  },
  rust: {
    agents: ["rust-reviewer", "rust-build-resolver"],
    skills: ["rust-patterns", "rust-testing"],
    rules: ["rust"],
  },
  typescript: { agents: ["typescript-reviewer"], skills: [], rules: ["typescript"] },
  react: {
    agents: ["react-reviewer", "react-build-resolver"],
    skills: ["react-patterns", "react-performance", "react-testing"],
    rules: ["react"],
  },
  vue: { agents: ["vue-reviewer"], skills: ["vue-patterns", "nuxt4-patterns"], rules: ["vue"] },
  java: {
    agents: ["java-reviewer", "java-build-resolver"],
    skills: ["java-coding-standards", "jpa-patterns"],
    rules: ["java"],
  },
  "java-spring": {
    agents: ["java-reviewer", "java-build-resolver"],
    skills: [
      "springboot-patterns",
      "springboot-security",
      "springboot-tdd",
      "java-coding-standards",
      "jpa-patterns",
    ],
    rules: ["java"],
  },
  "java-quarkus": {
    agents: ["java-reviewer", "java-build-resolver"],
    skills: ["quarkus-patterns", "quarkus-security", "quarkus-tdd", "java-coding-standards"],
    rules: ["java"],
  },
  kotlin: {
    agents: ["kotlin-reviewer", "kotlin-build-resolver"],
    skills: ["kotlin-patterns", "kotlin-testing"],
    rules: ["kotlin"],
  },
  "php-laravel": {
    agents: ["php-reviewer"],
    skills: ["laravel-patterns", "laravel-security", "laravel-tdd"],
    rules: ["php"],
  },
  "php-adianti": { agents: ["php-reviewer"], skills: [], rules: ["php"] },
  php: { agents: ["php-reviewer"], skills: [], rules: ["php"] },
  python: {
    agents: ["python-reviewer"],
    skills: ["python-patterns", "python-testing"],
    rules: ["python"],
  },
  django: {
    agents: ["django-reviewer", "django-build-resolver"],
    skills: ["django-patterns", "django-tdd", "django-security"],
    rules: ["python"],
  },
  fastapi: { agents: ["fastapi-reviewer"], skills: ["fastapi-patterns"], rules: ["python"] },
  csharp: {
    agents: ["csharp-reviewer"],
    skills: ["dotnet-patterns", "csharp-testing"],
    rules: ["csharp"],
  },
  cpp: {
    agents: ["cpp-reviewer", "cpp-build-resolver"],
    skills: ["cpp-coding-standards", "cpp-testing"],
    rules: ["cpp"],
  },
  dart: {
    agents: ["flutter-reviewer", "dart-build-resolver"],
    skills: ["dart-flutter-patterns"],
    rules: ["dart"],
  },
};

/** Short "when to use" labels for the CLAUDE.md Workflow & Agents table (≤8 words each). */
export const ECC_AGENT_WHEN_TO_USE = /** @type {Record<string,string>} */ ({
  "code-reviewer": "revisão após qualquer mudança de código",
  "security-reviewer": "revisão de segurança antes de merge",
  "go-reviewer": "revisão código Go",
  "go-build-resolver": "quando build Go falha",
  "rust-reviewer": "revisão código Rust",
  "rust-build-resolver": "quando build Rust falha",
  "typescript-reviewer": "revisão código TypeScript/JavaScript",
  "react-reviewer": "revisão componentes React",
  "react-build-resolver": "quando build React falha",
  "vue-reviewer": "revisão componentes Vue",
  "java-reviewer": "revisão código Java/Spring/Quarkus",
  "java-build-resolver": "quando build Java falha",
  "kotlin-reviewer": "revisão código Kotlin",
  "kotlin-build-resolver": "quando build Kotlin falha",
  "php-reviewer": "revisão código PHP/Laravel/Adianti",
  "python-reviewer": "revisão código Python",
  "django-reviewer": "revisão código Django",
  "django-build-resolver": "quando build Django falha",
  "fastapi-reviewer": "revisão código FastAPI",
  "csharp-reviewer": "revisão código C#/.NET",
  "cpp-reviewer": "revisão código C++",
  "cpp-build-resolver": "quando build C++ falha",
  "flutter-reviewer": "revisão código Flutter/Dart",
  "dart-build-resolver": "quando build Flutter/Dart falha",
});

/**
 * ECC assets to install for a profile (deduped, common included).
 * @param {import('../profile.mjs').ProjectProfile} profile
 * @returns {EccAssetSet}
 */
export function selectEccAssets(profile) {
  /** @type {Set<string>} */ const agents = new Set(ECC_COMMON.agents);
  /** @type {Set<string>} */ const skills = new Set(ECC_COMMON.skills);
  /** @type {Set<string>} */ const rules = new Set(ECC_COMMON.rules);

  for (const key of stackKeys(profile)) {
    const set = ECC_BY_STACK[key];
    if (!set) continue;
    set.agents.forEach((a) => agents.add(a));
    set.skills.forEach((s) => skills.add(s));
    set.rules.forEach((r) => rules.add(r));
  }

  return { agents: [...agents].sort(), skills: [...skills].sort(), rules: [...rules].sort() };
}

/**
 * Union of every ECC catalogued asset — used by the sync script (sync-ecc.mjs)
 * to decide what to vendor from upstream.
 * @returns {EccAssetSet}
 */
export function allEccAssets() {
  /** @type {Set<string>} */ const agents = new Set(ECC_COMMON.agents);
  /** @type {Set<string>} */ const skills = new Set(ECC_COMMON.skills);
  /** @type {Set<string>} */ const rules = new Set(ECC_COMMON.rules);
  for (const set of Object.values(ECC_BY_STACK)) {
    set.agents.forEach((a) => agents.add(a));
    set.skills.forEach((s) => skills.add(s));
    set.rules.forEach((r) => rules.add(r));
  }
  return { agents: [...agents].sort(), skills: [...skills].sort(), rules: [...rules].sort() };
}
