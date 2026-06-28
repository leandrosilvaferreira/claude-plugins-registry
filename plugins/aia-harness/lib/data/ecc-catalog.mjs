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

export const ECC_AGENT_WHEN_TO_USE = /** @type {Record<string,string>} */ ({
  "code-reviewer":
    "Reviews any code change for bugs, security, error handling, and test coverage. Use proactively after editing any source file. MUST BE USED before merging a pull request.",
  "security-reviewer":
    "Reviews code for OWASP Top 10 vulnerabilities, hardcoded secrets, broken auth, and dependency CVEs. Use proactively before any merge that touches auth, input handling, or secrets. MUST BE USED before shipping security-sensitive changes.",
  "go-reviewer":
    "Reviews Go code for idiomatic style, concurrency safety, error wrapping, and interface correctness. Use proactively after editing any .go file. MUST BE USED before merging Go changes.",
  "go-build-resolver":
    "Diagnoses and fixes failing Go builds — compile errors, `go vet` failures, module/version conflicts, and staticcheck violations. Use proactively when `go build` or `go test` fails.",
  "rust-reviewer":
    "Reviews Rust code for ownership correctness, unsafe justification, unwrap/expect misuse, error context, and lifetime soundness. Use proactively after editing any .rs file. MUST BE USED before merging Rust changes.",
  "rust-build-resolver":
    "Diagnoses and fixes failing Rust builds — borrow checker errors, lifetime conflicts, trait mismatches, cargo dependency issues, and clippy violations. Use proactively when `cargo build` or `cargo check` fails.",
  "typescript-reviewer":
    "Reviews TypeScript and JavaScript code for type safety (any abuse, non-null assertions), async correctness, injection risks, and prototype pollution. Use proactively after editing .ts or .js files with no React/JSX involvement.",
  "react-reviewer":
    "Reviews React and Next.js code for hooks rules, Server/Client component boundaries, key props, accessibility, render performance, and Server Action safety. Use proactively after editing .tsx or .jsx files. MUST BE USED before merging React component changes.",
  "react-build-resolver":
    "Diagnoses and fixes failing React builds across Vite, webpack, Next.js, CRA, and Bun — JSX compile errors, bundler config issues, missing @types/react, and hydration mismatches. Use proactively when the React build or dev server fails.",
  "vue-reviewer":
    "Reviews Vue 3 code for reactivity correctness (ref/reactive/computed), composable cleanup, v-html safety, props/emits contracts, Vue Router guards, and Pinia store patterns. Use proactively after editing .vue files. MUST BE USED before merging Vue component changes.",
  "java-reviewer":
    "Reviews Java code for Spring/Quarkus patterns, N+1 queries, transaction boundaries, injection misuse, and null safety. Use proactively after editing .java files. MUST BE USED before merging Java changes.",
  "java-build-resolver":
    "Diagnoses and fixes failing Java builds — Maven/Gradle compilation errors, dependency resolution failures, annotation processor issues, and Spring/Quarkus startup problems. Use proactively when `mvn compile` or `gradle build` fails.",
  "kotlin-reviewer":
    "Reviews Kotlin code for coroutine safety, Flow anti-patterns, Compose recomposition traps, lifecycle bugs, and clean architecture boundaries. Use proactively after editing .kt files. MUST BE USED before merging Kotlin changes.",
  "kotlin-build-resolver":
    "Diagnoses and fixes failing Kotlin/Gradle builds — compiler errors, Gradle configuration issues, dependency conflicts, detekt and ktlint violations. Use proactively when the Kotlin build fails.",
  "php-reviewer":
    "Reviews PHP, Laravel, and Adianti code for SQL injection, mass assignment, XSS (Blade unsafe output), CSRF exemptions, and PSR compliance. Use proactively after editing .php files. MUST BE USED before merging PHP changes.",
  "python-reviewer":
    "Reviews Python code for injection risks, bare excepts, type annotation gaps, and Pythonic idioms. Use proactively after editing .py files. MUST BE USED before merging Python changes.",
  "django-reviewer":
    "Reviews Django code for ORM N+1 queries, missing permission_classes, mark_safe misuse, migration correctness, and DRF serializer patterns. Use proactively after editing Django views, models, or serializers. MUST BE USED before merging Django changes.",
  "django-build-resolver":
    "Diagnoses and fixes failing Django startups — pip/Poetry dependency errors, migration conflicts, circular imports, settings misconfiguration, and WSGI/ASGI failures. Use proactively when Django fails to start or migrations fail.",
  "fastapi-reviewer":
    "Reviews FastAPI code for route correctness, Pydantic model validation, dependency injection patterns, async database usage, auth/CORS config, and OpenAPI metadata. Use proactively after editing FastAPI routes, schemas, or middleware. MUST BE USED before merging FastAPI changes.",
  "csharp-reviewer":
    "Reviews C# and .NET code for SQL injection, empty catch blocks, async/await misuse (sync-over-async), LINQ correctness, and Nullable Reference Types compliance. Use proactively after editing .cs files. MUST BE USED before merging C# changes.",
  "cpp-reviewer":
    "Reviews C++ code for memory safety (raw new/delete, buffer overflows, use-after-free), undefined behavior, RAII correctness, and modern C++17/20 idioms. Use proactively after editing .cpp or .h files. MUST BE USED before merging C++ changes.",
  "cpp-build-resolver":
    "Diagnoses and fixes failing C++ builds — CMake configuration errors, linker failures (undefined references, multiple definitions), template instantiation errors, and missing includes. Use proactively when the CMake or compiler step fails.",
  "flutter-reviewer":
    "Reviews Flutter and Dart code for widget rebuild issues, state management anti-patterns, performance pitfalls, accessibility, and architecture boundary violations. Use proactively after editing .dart files. MUST BE USED before merging Flutter changes.",
  "dart-build-resolver":
    "Diagnoses and fixes failing Dart/Flutter builds — analyzer errors, null safety violations, pubspec dependency conflicts, build_runner failures, and platform-specific (Android/iOS/web) build errors. Use proactively when `flutter build` or `dart analyze` reports errors.",
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
