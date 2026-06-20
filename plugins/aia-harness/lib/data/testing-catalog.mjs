/**
 * Testing recommendation catalog — decision catalog, NOT in asset-catalog.mjs.
 * Maps detected stack to the opinionated unit-test framework + install recipe.
 *
 * @module data/testing-catalog
 */

/** @typedef {import('../profile.mjs').ProjectProfile} ProjectProfile */

/**
 * @typedef {Object} TestingRecipe
 * @property {string}      framework     Human name of the recommended framework.
 * @property {boolean}     installNeeded Requires a package install (false for built-ins).
 * @property {string|null} installCmd    Install command string, or null when not needed.
 * @property {string|null} configFile    Config file to scaffold, or null.
 * @property {string}      evidence      Short rationale.
 */

/** E2E frameworks that do NOT count as unit-test coverage. */
export const E2E_FRAMEWORKS = new Set(["Playwright", "Cypress"]);

/**
 * Resolve the JS package-manager install prefix.
 * @param {ProjectProfile} profile
 * @param {string} deps  Space-separated package names.
 * @returns {string}
 */
function jsInstall(profile, deps) {
  const pm = profile.packageManagers?.find((p) => p.ecosystem === "js");
  if (pm?.name === "pnpm") return `pnpm add -D ${deps}`;
  if (pm?.name === "yarn") return `yarn add -D ${deps}`;
  if (pm?.name === "bun") return `bun add -d ${deps}`;
  return `npm install -D ${deps}`;
}

/**
 * Refine the JS/TS stack key to a testing sub-key.
 * @param {ProjectProfile} profile
 * @returns {"react"|"vue"|"ts-vite"|"ts-node"}
 */
function jsKey(profile) {
  const fw = profile.frameworks.map((f) => f.name);
  const has = (/** @type {string} */ n) => fw.includes(n);
  if (has("React") || has("Next.js") || has("Nest.js")) return "react";
  if (has("Vue") || has("Nuxt")) return "vue";
  if (has("Vite")) return "ts-vite";
  return "ts-node";
}

/**
 * Return the recommended unit-test setup for a project that has no tests yet.
 * Returns null when the project already has tests configured, or when the stack
 * is unknown.
 *
 * @param {ProjectProfile} profile
 * @returns {TestingRecipe | null}
 */
export function recommendTesting(profile) {
  if (profile.testing?.configured) return null;

  const lang = profile.primaryLanguage;
  const fw = profile.frameworks.map((f) => f.name);
  const has = (/** @type {string} */ n) => fw.includes(n);

  switch (lang) {
    case "TypeScript":
    case "JavaScript": {
      const key = jsKey(profile);
      if (key === "react") {
        return {
          framework: "Vitest",
          installNeeded: true,
          installCmd: jsInstall(profile, "vitest @testing-library/react @testing-library/jest-dom jsdom"),
          configFile: "vitest.config.ts",
          evidence: "React stack — Vitest + Testing Library is the community standard",
        };
      }
      if (key === "vue") {
        return {
          framework: "Vitest",
          installNeeded: true,
          installCmd: jsInstall(profile, "vitest @vue/test-utils jsdom"),
          configFile: "vitest.config.ts",
          evidence: "Vue stack — Vitest + @vue/test-utils is the community standard",
        };
      }
      if (key === "ts-vite") {
        return {
          framework: "Vitest",
          installNeeded: true,
          installCmd: jsInstall(profile, "vitest"),
          configFile: "vitest.config.ts",
          evidence: "Vite project — Vitest shares the same config and is zero-config",
        };
      }
      // ts-node: built-in node:test, no dep
      return {
        framework: "node:test",
        installNeeded: false,
        installCmd: null,
        configFile: null,
        evidence: "Node.js project — node:test is built-in since Node 18, zero deps",
      };
    }

    case "PHP": {
      if (has("Laravel")) {
        return {
          framework: "Pest",
          installNeeded: true,
          installCmd: "composer require pestphp/pest --dev --with-all-dependencies && ./vendor/bin/pest --init",
          configFile: "phpunit.xml",
          evidence: "Laravel — Pest is the community-preferred testing framework",
        };
      }
      return {
        framework: "PHPUnit",
        installNeeded: true,
        installCmd: "composer require phpunit/phpunit --dev",
        configFile: "phpunit.xml",
        evidence: "PHP project — PHPUnit is the standard",
      };
    }

    case "Python": {
      if (has("Django")) {
        return {
          framework: "pytest",
          installNeeded: true,
          installCmd: "pip install pytest pytest-django",
          configFile: "pytest.ini",
          evidence: "Django — pytest-django integrates Django test runner with pytest",
        };
      }
      if (has("FastAPI")) {
        return {
          framework: "pytest",
          installNeeded: true,
          installCmd: "pip install pytest pytest-asyncio httpx",
          configFile: "pytest.ini",
          evidence: "FastAPI — pytest-asyncio + httpx for async endpoint testing",
        };
      }
      return {
        framework: "pytest",
        installNeeded: true,
        installCmd: "pip install pytest",
        configFile: "pytest.ini",
        evidence: "Python — pytest is the de-facto standard",
      };
    }

    case "Go":
      return {
        framework: "testing",
        installNeeded: false,
        installCmd: null,
        configFile: null,
        evidence: "Go — testing package is built-in, no install needed",
      };

    case "Rust":
      return {
        framework: "cargo test",
        installNeeded: false,
        installCmd: null,
        configFile: null,
        evidence: "Rust — #[test] and cargo test are built-in",
      };

    case "Java":
    case "Kotlin": {
      if (has("Quarkus")) {
        return {
          framework: "JUnit 5",
          installNeeded: false,
          installCmd: null,
          configFile: null,
          evidence: "Quarkus — quarkus-junit5 is included in the quarkus-test starter; verify pom.xml/build.gradle",
        };
      }
      if (has("Spring Boot")) {
        return {
          framework: "JUnit 5",
          installNeeded: false,
          installCmd: null,
          configFile: null,
          evidence: "Spring Boot — spring-boot-starter-test bundles JUnit 5; verify pom.xml/build.gradle",
        };
      }
      return {
        framework: "JUnit 5",
        installNeeded: false,
        installCmd: null,
        configFile: null,
        evidence: "JVM project — JUnit 5 is the standard; add junit-jupiter dependency if missing",
      };
    }

    case "C#":
      return {
        framework: "xUnit",
        installNeeded: true,
        installCmd: "dotnet add package xunit && dotnet add package xunit.runner.visualstudio && dotnet add package Microsoft.NET.Test.Sdk",
        configFile: null,
        evidence: "C# — xUnit is the most adopted .NET testing framework",
      };

    default:
      return null;
  }
}
