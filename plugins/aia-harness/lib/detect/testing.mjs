/**
 * Unit-test detection — reads already-collected profile + file list.
 * Pure: no IO.
 *
 * @module detect/testing
 */
import { E2E_FRAMEWORKS, recommendTesting } from "../data/testing-catalog.mjs";

/** @typedef {import('../profile.mjs').ProjectProfile} ProjectProfile */
/** @typedef {import('../profile.mjs').TestingInfo} TestingInfo */
/** @typedef {{ base: string, rel: string }} FileEntry */

/** Per-ecosystem test-file matchers. */
const TEST_FILE_MATCHERS = {
  js: (/** @type {FileEntry} */ f) =>
    /\.(test|spec)\.(js|ts|mjs|cjs|jsx|tsx)$/.test(f.rel) || f.rel.includes("__tests__/"),
  php: (/** @type {FileEntry} */ f) =>
    /Test\.php$/.test(f.base) || /^tests[\\/]/.test(f.rel),
  python: (/** @type {FileEntry} */ f) =>
    /^test_/.test(f.base) || /_test\.py$/.test(f.base),
  go: (/** @type {FileEntry} */ f) => /_test\.go$/.test(f.base),
  rust: (/** @type {FileEntry} */ f) => f.rel.startsWith("tests/") && f.base.endsWith(".rs"),
  jvm: (/** @type {FileEntry} */ f) =>
    /Test\.(java|kt)$/.test(f.base) || f.rel.includes("src/test/"),
  dotnet: (/** @type {FileEntry} */ f) =>
    f.rel.includes(".Tests/") || f.rel.includes(".Test/") || /Tests?\.cs$/.test(f.base),
};

/**
 * Resolve the test-file matcher ecosystem from the primary language.
 * @param {string|null} lang
 * @returns {keyof typeof TEST_FILE_MATCHERS | null}
 */
function ecosystemKey(lang) {
  switch (lang) {
    case "TypeScript":
    case "JavaScript":
      return "js";
    case "PHP":
      return "php";
    case "Python":
      return "python";
    case "Go":
      return "go";
    case "Rust":
      return "rust";
    case "Java":
    case "Kotlin":
      return "jvm";
    case "C#":
      return "dotnet";
    default:
      return null;
  }
}

/**
 * Detect the unit-test situation from an already-scanned profile + file list.
 *
 * @param {ProjectProfile} profile  Profile built WITHOUT a `testing` property yet.
 * @param {FileEntry[]} files
 * @returns {TestingInfo}
 */
export function detectTesting(profile, files) {
  // Detected unit-test framework (excludes E2E-only frameworks)
  const fwEntry = profile.frameworks.find(
    (f) => f.category === "test" && !E2E_FRAMEWORKS.has(f.name),
  );
  const framework = fwEntry?.name ?? null;

  // Test files via per-ecosystem glob
  const eco = ecosystemKey(profile.primaryLanguage);
  const matcher = eco ? TEST_FILE_MATCHERS[eco] : null;
  const hasTestFiles = matcher ? files.some(matcher) : false;

  // Declared test script (not ecosystem default — raw only contains declared scripts)
  const hasTestScript = !!profile.commands.raw?.test;

  const configured = !!(framework || hasTestFiles || hasTestScript);

  const recipe = configured ? null : recommendTesting(profile);

  return {
    configured,
    framework,
    hasTestFiles,
    hasTestScript,
    recommended: recipe?.framework ?? null,
    installNeeded: recipe?.installNeeded ?? false,
    evidence: framework
      ? `framework dep: ${framework}`
      : hasTestFiles
        ? "test files detected"
        : hasTestScript
          ? "declared test script"
          : recipe
            ? `no tests — recommended: ${recipe.framework}`
            : "no tests — unknown stack",
  };
}
