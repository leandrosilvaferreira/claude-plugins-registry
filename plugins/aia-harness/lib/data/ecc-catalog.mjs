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
  "code-reviewer": "review after any code change",
  "security-reviewer": "security review before merge",
  "go-reviewer": "Go code review",
  "go-build-resolver": "when Go build fails",
  "rust-reviewer": "Rust code review",
  "rust-build-resolver": "when Rust build fails",
  "typescript-reviewer": "TypeScript/JavaScript code review",
  "react-reviewer": "React component review",
  "react-build-resolver": "when React build fails",
  "vue-reviewer": "Vue component review",
  "java-reviewer": "Java/Spring/Quarkus code review",
  "java-build-resolver": "when Java build fails",
  "kotlin-reviewer": "Kotlin code review",
  "kotlin-build-resolver": "when Kotlin build fails",
  "php-reviewer": "PHP/Laravel/Adianti code review",
  "python-reviewer": "Python code review",
  "django-reviewer": "Django code review",
  "django-build-resolver": "when Django build fails",
  "fastapi-reviewer": "FastAPI code review",
  "csharp-reviewer": "C#/.NET code review",
  "cpp-reviewer": "C++ code review",
  "cpp-build-resolver": "when C++ build fails",
  "flutter-reviewer": "Flutter/Dart code review",
  "dart-build-resolver": "when Flutter/Dart build fails",
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
