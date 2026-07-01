# Pilar de Testes Unitários — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Quando o harness é aplicado a um projeto sem testes unitários, detectar o gap, recomendar um framework por stack (sugerir) e oferecer instalar+escrever 1 teste real+rodar verde (configurar).

**Architecture:** Engine puro detecta o gap (`detect/testing.mjs`) e recomenda (`data/testing-catalog.mjs`), surfaçando em scan/CLAUDE.md/plan. A parte agêntica (install + teste real + rodar até verde) vive numa skill distribuída `setup-testing` que a `init` dispara pós-apply. Spec: `docs/superpowers/specs/2026-06-18-setup-testing-pillar-design.md`.

**Tech Stack:** Node ≥18, ESM `.mjs`, JSDoc + `tsc --checkJs`, ESLint flat, `node --test` + `node:assert/strict`. Sem build step.

## Global Constraints

- Todo source é `.mjs` ESM com tipos JSDoc — sem `.ts`, sem build. Adicionar `@typedef`/`@param`/`@returns`, não TypeScript.
- `lib/` é puro e testável; IO só nas bordas (`detect` lê, `apply` escreve, `bin` orquestra).
- `testing-catalog.mjs` é catálogo de **decisão** (como `mcp-catalog`) → **NÃO** entra no barrel `asset-catalog.mjs`.
- Skill sob `templates/skills/` que vai a targets **deve** ser registrada em `project-catalog.mjs` (`PROJECT_COMMON.skills`) no mesmo commit.
- `templates/` é excluído de lint e typecheck.
- Cada teste roda com `node --test tests/<arquivo>.test.mjs`; suíte completa = `npm test` (typecheck + lint + unit).
- Commits terminam com o trailer: `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`.
- Estamos na branch default `main` → criar branch antes de começar (Task 0).

---

### Task 0: Branch de trabalho

**Files:** nenhum (git).

- [ ] **Step 1: Criar e checar a branch**

```bash
git checkout -b feat/setup-testing-pillar
```

- [ ] **Step 2: Confirmar baseline verde**

Run: `npm test`
Expected: PASS (typecheck + lint + unit) — baseline limpo antes de mudar nada.

---

### Task 1: Catálogo de recomendação (`testing-catalog.mjs`)

**Files:**
- Create: `lib/data/testing-catalog.mjs`
- Test: `tests/testing-catalog.test.mjs`

**Interfaces:**
- Consumes: `stackKeys(profile)` de `lib/data/stack-keys.mjs`; lê `profile.frameworks`, `profile.packageManagers`, `profile.primaryLanguage` (campos já existentes).
- Produces:
  - `recommendTesting(profile) → TestingRecipe | null`
  - `E2E_FRAMEWORKS: Set<string>` (= `{"Playwright","Cypress"}`)
  - `TestingRecipe` typedef: `{ framework: string, ecosystem: string, installDeps: string[], installNeeded: boolean, install: string|null, configFile: string|null, testGlob: string, alternatives: string[], notes: string }`

- [ ] **Step 1: Escrever o teste falho**

Create `tests/testing-catalog.test.mjs`:

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { recommendTesting, E2E_FRAMEWORKS } from "../lib/data/testing-catalog.mjs";

/** @param {string|null} primaryLanguage @param {string[]} frameworkNames @param {string} [pm] */
function profile(primaryLanguage, frameworkNames = [], pm = "npm") {
  return /** @type {any} */ ({
    primaryLanguage,
    frameworks: frameworkNames.map((name) => ({ name })),
    packageManagers: [{ name: pm, ecosystem: pm === "composer" ? "php" : "js" }],
  });
}

test("React project recommends Vitest + Testing Library, install needed", () => {
  const r = recommendTesting(profile("TypeScript", ["React"]));
  assert.ok(r);
  assert.match(r.framework, /Vitest/);
  assert.equal(r.installNeeded, true);
  assert.equal(r.install, "npm i -D vitest @testing-library/react @testing-library/jest-dom jsdom");
});

test("TS + Vite (no React/Vue) recommends plain Vitest", () => {
  const r = recommendTesting(profile("TypeScript", ["Vite"]));
  assert.ok(r);
  assert.equal(r.framework, "Vitest");
  assert.equal(r.install, "npm i -D vitest");
});

test("plain TS Node recommends node:test, no install", () => {
  const r = recommendTesting(profile("TypeScript", []));
  assert.ok(r);
  assert.equal(r.framework, "node:test");
  assert.equal(r.installNeeded, false);
  assert.equal(r.install, null);
});

test("install command is package-manager aware", () => {
  const r = recommendTesting(profile("TypeScript", ["Vite"], "pnpm"));
  assert.equal(r?.install, "pnpm add -D vitest");
});

test("Laravel recommends Pest via composer", () => {
  const r = recommendTesting(profile("PHP", ["Laravel"], "composer"));
  assert.equal(r?.framework, "Pest");
  assert.equal(r?.install, "composer require --dev pestphp/pest");
});

test("plain PHP recommends PHPUnit", () => {
  const r = recommendTesting(profile("PHP", [], "composer"));
  assert.equal(r?.framework, "PHPUnit");
});

test("Adianti falls back to PHPUnit", () => {
  const r = recommendTesting(profile("PHP", ["Adianti"], "composer"));
  assert.equal(r?.framework, "PHPUnit");
});

test("Go recommends built-in testing, no install", () => {
  const r = recommendTesting(profile("Go", [], "go"));
  assert.match(r?.framework ?? "", /testing/);
  assert.equal(r?.installNeeded, false);
  assert.equal(r?.install, null);
});

test("Django refines python recommendation", () => {
  const r = recommendTesting(profile("Python", ["Django"], "pip"));
  assert.match(r?.framework ?? "", /pytest-django/);
});

test("unknown stack returns null", () => {
  const r = recommendTesting(profile(null, []));
  assert.equal(r, null);
});

test("E2E_FRAMEWORKS lists Playwright and Cypress", () => {
  assert.ok(E2E_FRAMEWORKS.has("Playwright"));
  assert.ok(E2E_FRAMEWORKS.has("Cypress"));
});
```

- [ ] **Step 2: Rodar o teste — deve falhar**

Run: `node --test tests/testing-catalog.test.mjs`
Expected: FAIL — `Cannot find module '../lib/data/testing-catalog.mjs'`.

- [ ] **Step 3: Implementar o catálogo**

Create `lib/data/testing-catalog.mjs`:

```js
/**
 * Opinionated unit-testing recommendation catalog. Decides WHICH unit-test
 * framework to recommend per stack when a project has none. Pure data +
 * resolver — a DECISION catalog (like mcp-catalog), NOT a distributable-asset
 * catalog, so it is intentionally NOT part of the asset-catalog barrel.
 *
 * @module data/testing-catalog
 */
import { stackKeys } from "./stack-keys.mjs";

/**
 * @typedef {Object} TestingRecipe
 * @property {string} framework
 * @property {string} ecosystem    js|php|python|go|rust|jvm|dotnet
 * @property {string[]} installDeps
 * @property {boolean} installNeeded
 * @property {string|null} install  PM-aware install command, or null when built-in.
 * @property {string|null} configFile
 * @property {string} testGlob
 * @property {string[]} alternatives
 * @property {string} notes
 */

/** E2E frameworks that do NOT count as unit-test coverage. */
export const E2E_FRAMEWORKS = new Set(["Playwright", "Cypress"]);

/** @typedef {Omit<TestingRecipe, "install">} RecipeTemplate */

/** @type {Record<string, RecipeTemplate>} */
const RECIPES = {
  react: {
    framework: "Vitest + Testing Library",
    ecosystem: "js",
    installDeps: ["vitest", "@testing-library/react", "@testing-library/jest-dom", "jsdom"],
    installNeeded: true,
    configFile: "vitest.config.ts",
    testGlob: "src/**/*.test.tsx",
    alternatives: ["Jest + Testing Library"],
    notes: "environment: jsdom para componentes.",
  },
  vue: {
    framework: "Vitest + @vue/test-utils",
    ecosystem: "js",
    installDeps: ["vitest", "@vue/test-utils", "jsdom"],
    installNeeded: true,
    configFile: "vitest.config.ts",
    testGlob: "src/**/*.test.ts",
    alternatives: ["Jest"],
    notes: "environment: jsdom para componentes.",
  },
  "ts-vite": {
    framework: "Vitest",
    ecosystem: "js",
    installDeps: ["vitest"],
    installNeeded: true,
    configFile: "vitest.config.ts",
    testGlob: "src/**/*.test.ts",
    alternatives: ["Jest", "node:test"],
    notes: "Vite detectado — Vitest reusa a config do Vite.",
  },
  "ts-node": {
    framework: "node:test",
    ecosystem: "js",
    installDeps: [],
    installNeeded: false,
    configFile: null,
    testGlob: "test/**/*.test.mjs",
    alternatives: ["Vitest", "Jest"],
    notes: "Runner nativo do Node (sem dependência).",
  },
  "php-laravel": {
    framework: "Pest",
    ecosystem: "php",
    installDeps: ["pestphp/pest"],
    installNeeded: true,
    configFile: "tests/Pest.php",
    testGlob: "tests/**/*Test.php",
    alternatives: ["PHPUnit"],
    notes: "Rodar `php artisan pest:install` após instalar.",
  },
  php: {
    framework: "PHPUnit",
    ecosystem: "php",
    installDeps: ["phpunit/phpunit"],
    installNeeded: true,
    configFile: "phpunit.xml",
    testGlob: "tests/**/*Test.php",
    alternatives: ["Pest"],
    notes: "",
  },
  python: {
    framework: "pytest",
    ecosystem: "python",
    installDeps: ["pytest"],
    installNeeded: true,
    configFile: "pytest.ini",
    testGlob: "test_*.py",
    alternatives: ["unittest"],
    notes: "",
  },
  django: {
    framework: "pytest + pytest-django",
    ecosystem: "python",
    installDeps: ["pytest", "pytest-django"],
    installNeeded: true,
    configFile: "pytest.ini",
    testGlob: "tests/test_*.py",
    alternatives: ["Django TestCase"],
    notes: "Definir DJANGO_SETTINGS_MODULE em pytest.ini.",
  },
  fastapi: {
    framework: "pytest + httpx",
    ecosystem: "python",
    installDeps: ["pytest", "httpx"],
    installNeeded: true,
    configFile: "pytest.ini",
    testGlob: "test_*.py",
    alternatives: ["unittest"],
    notes: "httpx para o TestClient.",
  },
  go: {
    framework: "testing (built-in)",
    ecosystem: "go",
    installDeps: [],
    installNeeded: false,
    configFile: null,
    testGlob: "*_test.go",
    alternatives: ["testify"],
    notes: "Pacote testing da stdlib.",
  },
  rust: {
    framework: "built-in #[test]",
    ecosystem: "rust",
    installDeps: [],
    installNeeded: false,
    configFile: null,
    testGlob: "#[cfg(test)] / tests/",
    alternatives: [],
    notes: "Testes inline com #[cfg(test)].",
  },
  "java-spring": {
    framework: "JUnit 5",
    ecosystem: "jvm",
    installDeps: ["spring-boot-starter-test"],
    installNeeded: false,
    configFile: null,
    testGlob: "src/test/java/**/*Test.java",
    alternatives: [],
    notes: "Normalmente já presente via starter; adicionar só se faltar.",
  },
  "java-quarkus": {
    framework: "JUnit 5 + @QuarkusTest",
    ecosystem: "jvm",
    installDeps: ["quarkus-junit5"],
    installNeeded: false,
    configFile: null,
    testGlob: "src/test/java/**/*Test.java",
    alternatives: [],
    notes: "Normalmente já presente; adicionar só se faltar.",
  },
  java: {
    framework: "JUnit 5",
    ecosystem: "jvm",
    installDeps: ["org.junit.jupiter:junit-jupiter"],
    installNeeded: true,
    configFile: null,
    testGlob: "src/test/java/**/*Test.java",
    alternatives: [],
    notes: "",
  },
  csharp: {
    framework: "xUnit",
    ecosystem: "dotnet",
    installDeps: ["xunit", "xunit.runner.visualstudio"],
    installNeeded: true,
    configFile: null,
    testGlob: "*Tests.cs",
    alternatives: ["NUnit"],
    notes: "",
  },
};

/** stack-keys sem recipe própria que reusam outra. */
const ALIAS = /** @type {Record<string,string>} */ ({ "php-adianti": "php", kotlin: "java" });

/**
 * @param {import('../profile.mjs').ProjectProfile} profile
 * @param {string[]} deps
 * @returns {string}
 */
function jsInstall(profile, deps) {
  const pm = profile.packageManagers[0]?.name;
  const list = deps.join(" ");
  switch (pm) {
    case "pnpm": return `pnpm add -D ${list}`;
    case "yarn": return `yarn add -D ${list}`;
    case "bun": return `bun add -d ${list}`;
    default: return `npm i -D ${list}`;
  }
}

/**
 * @param {import('../profile.mjs').ProjectProfile} profile
 * @param {RecipeTemplate} r
 * @returns {string|null}
 */
function resolveInstall(profile, r) {
  if (!r.installNeeded || r.installDeps.length === 0) return null;
  switch (r.ecosystem) {
    case "js": return jsInstall(profile, r.installDeps);
    case "php": return `composer require --dev ${r.installDeps.join(" ")}`;
    case "python": return `pip install -U ${r.installDeps.join(" ")}`;
    case "dotnet": return r.installDeps.map((d) => `dotnet add package ${d}`).join(" && ");
    default: return null; // jvm managed via pom/gradle by the skill
  }
}

/**
 * Within the `typescript` stack key, refine by frameworks present.
 * @param {import('../profile.mjs').ProjectProfile} profile
 * @returns {string}
 */
function jsKey(profile) {
  const fw = profile.frameworks.map((f) => f.name);
  if (fw.includes("React") || fw.includes("Next.js") || fw.includes("NestJS")) return "react";
  if (fw.includes("Vue") || fw.includes("Nuxt")) return "vue";
  if (fw.includes("Vite")) return "ts-vite";
  return "ts-node";
}

/**
 * @param {string[]} keys
 * @param {import('../profile.mjs').ProjectProfile} profile
 * @returns {string|null}
 */
function pickRecipeKey(keys, profile) {
  if (keys.includes("typescript")) return jsKey(profile);
  // Most specific keys are appended after the base (e.g. ["python","django"]).
  for (const k of [...keys].reverse()) {
    const kk = ALIAS[k] ?? k;
    if (RECIPES[kk]) return kk;
  }
  return null;
}

/**
 * Recommend a unit-testing recipe for a profile, or null when no stack matches.
 * @param {import('../profile.mjs').ProjectProfile} profile
 * @returns {TestingRecipe|null}
 */
export function recommendTesting(profile) {
  const keys = stackKeys(profile);
  if (keys.length === 0) return null;
  const key = pickRecipeKey(keys, profile);
  if (!key || !RECIPES[key]) return null;
  const base = RECIPES[key];
  return { ...base, install: resolveInstall(profile, base) };
}
```

- [ ] **Step 4: Rodar o teste — deve passar**

Run: `node --test tests/testing-catalog.test.mjs`
Expected: PASS (todos os testes).

- [ ] **Step 5: Typecheck + lint do módulo novo**

Run: `npm run typecheck && npm run lint`
Expected: PASS sem erros.

- [ ] **Step 6: Commit**

```bash
git add lib/data/testing-catalog.mjs tests/testing-catalog.test.mjs
git commit -m "feat(testing): add unit-testing recommendation catalog

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: Detecção do gap (`detect/testing.mjs` + profile + wiring)

**Files:**
- Modify: `lib/profile.mjs` (adicionar typedef `TestingInfo` + campo `testing` em `ProjectProfile`)
- Create: `lib/detect/testing.mjs`
- Modify: `lib/detect/index.mjs` (a função `scanProject`, montagem do profile ~linhas 64-78)
- Test: `tests/detect-testing.test.mjs`

**Interfaces:**
- Consumes: `recommendTesting`, `E2E_FRAMEWORKS` (Task 1); `import('../util/fs.mjs').CollectedFile` (tem `.rel` e `.base`); `profile.frameworks`, `profile.commands.raw`, `profile.packageManagers`.
- Produces:
  - `TestingInfo` typedef: `{ configured: boolean, framework: string|null, hasTestFiles: boolean, hasTestScript: boolean, recommended: string|null, installNeeded: boolean, evidence: string }`
  - `detectTesting(profile, files) → TestingInfo`
  - `profile.testing: TestingInfo` em todo `ProjectProfile`.

- [ ] **Step 1: Escrever o teste falho**

Create `tests/detect-testing.test.mjs`:

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { scanProject } from "../lib/detect/index.mjs";
import { detectTesting } from "../lib/detect/testing.mjs";

const FIX = path.join(path.dirname(fileURLToPath(import.meta.url)), "fixtures");

test("js-ts-app: configured (vitest dep + test script)", () => {
  const p = scanProject(path.join(FIX, "js-ts-app"));
  assert.equal(p.testing.configured, true);
  assert.equal(p.testing.recommended, null);
});

test("php-laravel: configured (pest dep + test script)", () => {
  const p = scanProject(path.join(FIX, "php-laravel"));
  assert.equal(p.testing.configured, true);
});

test("go-app: NOT configured despite ecosystem-default test command", () => {
  const p = scanProject(path.join(FIX, "go-app"));
  // commands.test is "go test ./..." (ecosystem default), but no real tests exist.
  assert.equal(p.commands.test, "go test ./...");
  assert.equal(p.testing.configured, false);
  assert.equal(p.testing.hasTestScript, false);
  assert.match(p.testing.recommended ?? "", /testing/);
  assert.equal(p.testing.installNeeded, false);
});

test("E2E-only framework does not count as unit tests", () => {
  const profile = /** @type {any} */ ({
    primaryLanguage: "TypeScript",
    frameworks: [{ name: "Playwright", category: "test" }],
    packageManagers: [{ name: "npm", ecosystem: "js" }],
    commands: { raw: {} },
  });
  const t = detectTesting(profile, []);
  assert.equal(t.configured, false);
  assert.equal(t.framework, null);
});

test("test files alone mark configured", () => {
  const profile = /** @type {any} */ ({
    primaryLanguage: "Go",
    frameworks: [],
    packageManagers: [{ name: "go", ecosystem: "go" }],
    commands: { raw: {} },
  });
  const t = detectTesting(profile, [{ rel: "main_test.go", base: "main_test.go" }]);
  assert.equal(t.hasTestFiles, true);
  assert.equal(t.configured, true);
});
```

- [ ] **Step 2: Rodar o teste — deve falhar**

Run: `node --test tests/detect-testing.test.mjs`
Expected: FAIL — `Cannot find module '../lib/detect/testing.mjs'`.

- [ ] **Step 3: Adicionar os typedefs em `lib/profile.mjs`**

Inserir o typedef `TestingInfo` antes do typedef `ProjectProfile` (após `ExistingHarness`, ~linha 78):

```js
/**
 * @typedef {Object} TestingInfo
 * @property {boolean} configured     Project already uses unit tests (framework dep OR test files OR declared test script).
 * @property {string|null} framework  Detected unit-test framework name, or null.
 * @property {boolean} hasTestFiles   Test files found via per-ecosystem glob.
 * @property {boolean} hasTestScript  A DECLARED `test` script exists (not the ecosystem default).
 * @property {string|null} recommended Recommended framework when !configured, or null.
 * @property {boolean} installNeeded  Recommended framework requires a dep install (false for built-ins).
 * @property {string} evidence        Short human explanation.
 */
```

Adicionar a propriedade ao typedef `ProjectProfile` (após `existingHarness`, antes de `vcs`):

```js
 * @property {TestingInfo} testing
```

- [ ] **Step 4: Implementar `lib/detect/testing.mjs`**

Create `lib/detect/testing.mjs`:

```js
/**
 * Detect whether the project already uses unit tests, and (when not) what to
 * recommend. Pure: reads the already-collected file list + profile fields.
 * @module detect/testing
 */
import { recommendTesting, E2E_FRAMEWORKS } from "../data/testing-catalog.mjs";

/**
 * Test-file matchers per ecosystem, applied to collected rel paths.
 * @type {Record<string, (rel: string) => boolean>}
 */
const TEST_FILE_MATCHERS = {
  js: (r) => /(^|\/)__tests__\//.test(r) || /\.(test|spec)\.[cm]?[jt]sx?$/.test(r),
  php: (r) => /Test\.php$/.test(r) || /(^|\/)tests\//.test(r) || /^phpunit\.xml(\.dist)?$/.test(r),
  python: (r) =>
    /(^|\/)(test_[^/]+|[^/]+_test)\.py$/.test(r) || /(^|\/)conftest\.py$/.test(r) || /(^|\/)tests\//.test(r),
  go: (r) => /_test\.go$/.test(r),
  jvm: (r) => /(^|\/)src\/test\//.test(r) || /Tests?\.java$/.test(r) || /Spec\.groovy$/.test(r),
  ruby: (r) => /(^|\/)spec\//.test(r) || /_spec\.rb$/.test(r) || /(^|\/)test\//.test(r) || /_test\.rb$/.test(r),
  dotnet: (r) => /Tests?\.cs$/.test(r),
  rust: (r) => /(^|\/)tests\//.test(r),
};

/**
 * @param {import('../profile.mjs').ProjectProfile} profile  Profile WITHOUT a final testing value yet.
 * @param {import('../util/fs.mjs').CollectedFile[]} files
 * @returns {import('../profile.mjs').TestingInfo}
 */
export function detectTesting(profile, files) {
  const ecosystem = profile.packageManagers[0]?.ecosystem ?? "unknown";
  const unitFw = profile.frameworks.find((f) => f.category === "test" && !E2E_FRAMEWORKS.has(f.name));
  const hasFrameworkDep = !!unitFw;
  const hasTestScript = !!profile.commands.raw?.test;
  const matcher = TEST_FILE_MATCHERS[ecosystem];
  const hasTestFiles = matcher ? files.some((f) => matcher(f.rel)) : false;
  const configured = hasFrameworkDep || hasTestFiles || hasTestScript;

  const recipe = configured ? null : recommendTesting(profile);
  const evidence = configured
    ? `unit tests present (${[hasFrameworkDep && unitFw?.name, hasTestFiles && "test files", hasTestScript && "test script"]
        .filter(Boolean)
        .join(", ")})`
    : recipe
      ? `no unit tests — recommend ${recipe.framework}`
      : "no unit tests; no recommendation for this stack";

  return {
    configured,
    framework: unitFw?.name ?? null,
    hasTestFiles,
    hasTestScript,
    recommended: recipe?.framework ?? null,
    installNeeded: recipe?.installNeeded ?? false,
    evidence,
  };
}
```

- [ ] **Step 5: Fiar no `lib/detect/index.mjs`**

Importar no topo (junto aos outros detectores):

```js
import { detectTesting } from "./testing.mjs";
```

Substituir o `return { ... }` final de `scanProject` por uma montagem em duas etapas (placeholder válido + sobrescrita):

```js
  /** @type {import('../profile.mjs').ProjectProfile} */
  const profile = {
    root: abs,
    languages,
    primaryLanguage,
    packageManagers,
    frameworks,
    monorepo,
    commands,
    architecture,
    existingHarness,
    testing: {
      configured: false,
      framework: null,
      hasTestFiles: false,
      hasTestScript: false,
      recommended: null,
      installNeeded: false,
      evidence: "pending",
    },
    vcs,
    markers,
    truncated,
  };
  profile.testing = detectTesting(profile, files);
  return profile;
```

- [ ] **Step 6: Rodar o teste — deve passar**

Run: `node --test tests/detect-testing.test.mjs`
Expected: PASS.

- [ ] **Step 7: Garantir que a suíte inteira segue verde (campo novo no profile)**

Run: `npm test`
Expected: PASS. Se algum teste construir um `ProjectProfile` literal sem cast `/** @type {any} */`, o typecheck acusará falta de `testing` — corrigir adicionando o cast ou o campo. (Os testes atuais usam `scanProject` real ou casts `any`, então deve passar limpo.)

- [ ] **Step 8: Commit**

```bash
git add lib/profile.mjs lib/detect/testing.mjs lib/detect/index.mjs tests/detect-testing.test.mjs
git commit -m "feat(testing): detect unit-test gap in the scan pipeline

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: Surfaçar no scan report (`render.mjs`)

**Files:**
- Modify: `lib/render.mjs` (`renderReport`, adicionar bloco "Unit tests" após "Canonical commands")
- Test: `tests/render-testing.test.mjs`

**Interfaces:**
- Consumes: `profile.testing` (Task 2).
- Produces: relatório de scan com uma seção `## Unit tests`.

- [ ] **Step 1: Escrever o teste falho**

Create `tests/render-testing.test.mjs`:

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { scanProject } from "../lib/detect/index.mjs";
import { renderReport } from "../lib/render.mjs";

const FIX = path.join(path.dirname(fileURLToPath(import.meta.url)), "fixtures");

test("scan report shows recommendation when no tests", () => {
  const out = renderReport(scanProject(path.join(FIX, "go-app")));
  assert.match(out, /## Unit tests/);
  assert.match(out, /none — recommended:/);
});

test("scan report shows present when tests configured", () => {
  const out = renderReport(scanProject(path.join(FIX, "js-ts-app")));
  assert.match(out, /## Unit tests/);
  assert.match(out, /present/);
});
```

- [ ] **Step 2: Rodar o teste — deve falhar**

Run: `node --test tests/render-testing.test.mjs`
Expected: FAIL — sem `## Unit tests` na saída.

- [ ] **Step 3: Implementar o bloco no `renderReport`**

Em `lib/render.mjs`, dentro de `renderReport`, antes do `return`, computar a linha:

```js
  const t = profile.testing;
  const testingLine = t.configured
    ? `- present${t.framework ? ` — ${t.framework}` : ""}`
    : `- none — recommended: ${t.recommended ?? "n/a (unknown stack)"}`;
```

E inserir a seção no template, logo após o bloco de "Canonical commands":

```js
## Canonical commands (${profile.commands.source})
${commandsBlock(profile.commands)}

## Unit tests
${testingLine}

## Version control
```

(Substituir o `\n## Version control` existente por este trecho com a seção "Unit tests" no meio.)

- [ ] **Step 4: Rodar o teste — deve passar**

Run: `node --test tests/render-testing.test.mjs`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/render.mjs tests/render-testing.test.mjs
git commit -m "feat(testing): surface unit-test status in scan report

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: Nota no CLAUDE.md gerado + nota no plano

**Files:**
- Modify: `lib/generate/claude-md.mjs` (`renderRootClaudeMd`, nota aditiva após `commandsBlock`)
- Modify: `lib/plan.mjs` (`buildPlan`, bloco de `notes` ~linhas 507-514)
- Test: `tests/testing-surfacing.test.mjs`

**Interfaces:**
- Consumes: `profile.testing`.
- Produces: nota condicional no root CLAUDE.md; `notes` do plano com o gap.

- [ ] **Step 1: Escrever o teste falho**

Create `tests/testing-surfacing.test.mjs`:

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { scanProject } from "../lib/detect/index.mjs";
import { buildPlan } from "../lib/plan.mjs";
import { renderRootClaudeMd } from "../lib/generate/claude-md.mjs";

const FIX = path.join(path.dirname(fileURLToPath(import.meta.url)), "fixtures");
const PLUGIN_ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");

test("CLAUDE.md includes setup-testing note when no tests", () => {
  const md = renderRootClaudeMd(scanProject(path.join(FIX, "go-app")));
  assert.match(md, /\/setup-testing/);
  assert.match(md, /recomendado/i);
});

test("CLAUDE.md omits the note when tests are configured", () => {
  const md = renderRootClaudeMd(scanProject(path.join(FIX, "js-ts-app")));
  assert.doesNotMatch(md, /\/setup-testing/);
});

test("plan notes flag the testing gap", () => {
  const plan = buildPlan(scanProject(path.join(FIX, "go-app")), { pluginRoot: PLUGIN_ROOT });
  assert.ok(plan.notes.some((n) => /no unit tests/i.test(n)));
});
```

- [ ] **Step 2: Rodar o teste — deve falhar**

Run: `node --test tests/testing-surfacing.test.mjs`
Expected: FAIL — sem `/setup-testing` no CLAUDE.md e sem nota no plano.

- [ ] **Step 3: Implementar a nota no CLAUDE.md**

Em `lib/generate/claude-md.mjs`, dentro de `renderRootClaudeMd`, após `const agentsWorkflow = agentsWorkflowBlock(agents);`, adicionar:

```js
  const t = profile.testing;
  const testingNote =
    t && !t.configured && t.recommended
      ? `\n> Sem testes unitários ainda — recomendado: **${t.recommended}**. Rode \`/setup-testing\` para semear.\n`
      : "";
```

No template, inserir `${testingNote}` logo após o bloco de comandos (antes da linha de skills):

```js
${commandsBlock(profile.commands)}
${testingNote}${skills ? `\n${skills}` : ""}${agentsWorkflow ? `\n${agentsWorkflow}` : ""}
```

- [ ] **Step 4: Implementar a nota no plano**

Em `lib/plan.mjs`, no bloco `const notes = []` (após os pushes existentes), adicionar:

```js
  if (!profile.testing.configured && profile.testing.recommended) {
    notes.push(
      `No unit tests detected — recommended: ${profile.testing.recommended}. ` +
        `The setup-testing skill is installed; run /setup-testing to scaffold.`,
    );
  }
```

- [ ] **Step 5: Rodar o teste — deve passar**

Run: `node --test tests/testing-surfacing.test.mjs`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add lib/generate/claude-md.mjs lib/plan.mjs tests/testing-surfacing.test.mjs
git commit -m "feat(testing): note the testing gap in CLAUDE.md and plan

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 5: Skill `setup-testing` + registro no catálogo

**Files:**
- Create: `templates/skills/setup-testing/SKILL.md`
- Modify: `lib/data/project-catalog.mjs` (`PROJECT_COMMON.skills`)
- Test: `tests/project-catalog.test.mjs` (estender) + `tests/setup-testing-skill.test.mjs` (novo)

**Interfaces:**
- Consumes: nada em runtime (skill é asset markdown).
- Produces: `setup-testing` em `PROJECT_COMMON.skills`; arquivo `templates/skills/setup-testing/SKILL.md`.

- [ ] **Step 1: Escrever os testes falhos**

Estender `tests/project-catalog.test.mjs` — adicionar:

```js
test("setup-testing is a common first-party skill", () => {
  const a = selectProjectAssets(profile("Go"));
  assert.ok(a.skills.includes("setup-testing"));
});
```

Create `tests/setup-testing-skill.test.mjs`:

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { PROJECT_COMMON } from "../lib/data/project-catalog.mjs";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");

test("every common skill has a template directory with SKILL.md", () => {
  for (const skill of PROJECT_COMMON.skills) {
    const md = path.join(ROOT, "templates", "skills", skill, "SKILL.md");
    assert.ok(fs.existsSync(md), `missing template for skill: ${skill}`);
  }
});

test("setup-testing SKILL.md declares the right name and triggers", () => {
  const md = fs.readFileSync(path.join(ROOT, "templates", "skills", "setup-testing", "SKILL.md"), "utf8");
  assert.match(md, /name:\s*setup-testing/);
  assert.match(md, /verde/i); // "rodar até verde"
});
```

- [ ] **Step 2: Rodar os testes — devem falhar**

Run: `node --test tests/setup-testing-skill.test.mjs tests/project-catalog.test.mjs`
Expected: FAIL — skill não catalogada e arquivo inexistente.

- [ ] **Step 3: Criar a skill**

Create `templates/skills/setup-testing/SKILL.md`:

```markdown
---
name: setup-testing
description: Semeia testes unitários num projeto que não tem nenhum — instala o framework recomendado para a stack, escreve um teste real num módulo existente, fia o script `test` e roda até passar verde. Use quando o projeto não tem testes, ao "configurar testes", "setup tests", "adicionar testes" ou "criar suíte de testes".
---

# Setup unit testing

Semeia a infraestrutura de testes unitários e prova que roda. **Nunca alegue verde sem ter rodado e visto a saída.**

## 1. Framework
Leia o framework recomendado no `CLAUDE.md` (linha "recomendado: ..."). Se ausente, use a tabela pela stack detectada. Confirme com o usuário — ele pode escolher uma alternativa.

| Stack | Framework | Instalar | Config |
| --- | --- | --- | --- |
| JS/TS + Vite/Vue/React | Vitest (+ Testing Library/jsdom p/ UI) | `npm i -D vitest ...` (use o PM do projeto: pnpm/yarn/bun) | `vitest.config.ts` |
| JS/TS Node puro | node:test | — (nativo) | — |
| PHP Laravel | Pest | `composer require --dev pestphp/pest` + `php artisan pest:install` | scaffold do Pest |
| PHP outros/Adianti | PHPUnit | `composer require --dev phpunit/phpunit` | `phpunit.xml` |
| Python | pytest (+ pytest-django/httpx) | `pip install -U pytest ...` | `pytest.ini` |
| Go | testing (stdlib) | — | — |
| Rust | `#[test]` | — | — |
| JVM Spring | JUnit 5 (spring-boot-starter-test) | já no starter — verifique no pom/gradle | — |
| JVM Quarkus | JUnit 5 + @QuarkusTest | já presente — verifique | — |
| Ruby Rails | RSpec | `bundle add rspec-rails --group "development, test"` + `rails g rspec:install` | `.rspec` |
| .NET | xUnit | `dotnet add package xunit xunit.runner.visualstudio` | — |

## 2. Instalar
Para frameworks não-nativos: **confirme com o usuário antes de instalar** (é ação de máquina, não só escrita de arquivo). Rode o comando de install. Se built-in (Go/Rust/node:test), pule.

## 3. Config
Escreva o arquivo de config adaptado ao projeto real — paths corretos, ESM/CJS, `environment: jsdom` para componentes de UI.

## 4. Escrever 1 teste REAL
Escolha **um módulo puro/determinístico** existente (util/helper/função de domínio: poucos imports, sem IO/rede/DB). Leia o código, entenda o comportamento e escreva 1 teste unitário genuíno cobrindo casos reais (caminho feliz + 1 borda).
- Se nenhum módulo adequado existir, escreva um smoke test mínimo (piso garantido) e **diga ao usuário que é placeholder** a ser substituído.

## 5. Script de teste
Garanta o comando de teste no manifesto (`package.json` `"test"`, `composer.json` `scripts.test`, etc.). Não duplique se já existir.

## 6. Rodar até verde
Rode o comando de teste. Corrija config/paths/imports até passar. Mostre a saída real (contagem pass/fail). Se a instalação falhar (rede/permissão), reporte o comando exato para o usuário rodar e **não** alegue verde.

## 7. Reportar
Resuma: framework instalado, arquivo de config, arquivo de teste criado e a saída verde. Lembre o usuário de revisar o teste gerado e expandir a cobertura.
```

- [ ] **Step 4: Registrar no catálogo**

Em `lib/data/project-catalog.mjs`, adicionar `"setup-testing"` ao array `PROJECT_COMMON.skills`:

```js
  skills: ["run-tests", "lint-fix", "pre-commit-verify", "setup-testing"],
```

- [ ] **Step 5: Rodar os testes — devem passar**

Run: `node --test tests/setup-testing-skill.test.mjs tests/project-catalog.test.mjs`
Expected: PASS.

- [ ] **Step 6: Suíte completa (a skill agora entra no plano/apply)**

Run: `npm test`
Expected: PASS. Se algum teste de plano/apply assertar a lista exata de skills, atualizar para incluir `setup-testing`.

- [ ] **Step 7: Commit**

```bash
git add templates/skills/setup-testing/SKILL.md lib/data/project-catalog.mjs tests/setup-testing-skill.test.mjs tests/project-catalog.test.mjs
git commit -m "feat(testing): ship setup-testing skill and catalog it

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 6: Disparo na `init` + menção no `doctor`

**Files:**
- Modify: `commands/init.md` (novo passo 5.7, entre 5.5 enrich e 6 review)
- Modify: `commands/doctor.md` (mencionar o gap de testes no relatório)

**Interfaces:**
- Consumes: `profile.testing` (via `scan`/`plan --json`); skill `setup-testing` (Task 5).
- Produces: nada testável por unidade — docs de comando. Verificação = leitura + `npm test` verde.

- [ ] **Step 1: Adicionar o passo 5.7 em `commands/init.md`**

Inserir após o bloco do passo "5.5. **Enrich CLAUDE.md.**" e antes de "6. **Review.**":

```markdown
5.7. **Seed unit tests (se faltar).** Leia `profile.testing` do `scan`/`plan --json`.
   **Se `testing.configured === false` e `testing.recommended` não for nulo**, ofereça
   configurar agora com `AskUserQuestion` (single-select), em português:
   _"Este projeto não tem testes unitários. Configurar agora? Recomendado: `<testing.recommended>`."_
   — opções: **"Sim, configurar"** / **"Sim, mas escolher outro framework"** / **"Não, depois"**.

   - **"Sim"** → invoque a skill **`setup-testing`** (ela instala o framework com confirmação,
     escreve a config + 1 teste real num módulo existente, fia o script `test` e roda até verde).
   - **"Sim, mas escolher outro"** → pergunte qual framework e passe a escolha à skill.
   - **"Não"** → siga sem configurar; a skill fica instalada para `/setup-testing` depois.

   Se `testing.configured === true`, pule este passo silenciosamente.
```

- [ ] **Step 2: Adicionar a menção em `commands/doctor.md`**

No ponto em que o doctor apresenta o diagnóstico/relatório do `scan`, acrescentar uma linha instruindo a reportar o gap:

```markdown
- **Unit tests:** reporte `profile.testing` — se `configured` for `false`, sinalize o gap e
  recomende `/setup-testing` (framework sugerido: `testing.recommended`).
```

(Adapte ao texto existente do `doctor.md`; o objetivo é que o relatório do doctor cite o gap de testes.)

- [ ] **Step 3: Verificar que nada quebrou**

Run: `npm test`
Expected: PASS (sem novos testes unitários; apenas docs de comando).

- [ ] **Step 4: Revisão manual dos comandos**

Ler `commands/init.md` (passo 5.7) e `commands/doctor.md` — confirmar que o fluxo lê `profile.testing`, gateia em `configured === false`, e invoca `setup-testing`. Confirmar que não menciona flags de CLI.

- [ ] **Step 5: Commit**

```bash
git add commands/init.md commands/doctor.md
git commit -m "feat(testing): offer test setup in init, flag gap in doctor

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 7: Documentação do engine (CLAUDE.md do repo)

**Files:**
- Modify: `CLAUDE.md` (raiz do repo — seção de catálogos/pipeline)

**Interfaces:** documentação; sem teste.

- [ ] **Step 1: Documentar o novo catálogo de decisão**

Em `CLAUDE.md`, na descrição do estágio 2 (plan) onde lista catálogos de dados (`mcp-catalog`, `plugins-catalog`, `frameworks`, `languages`), acrescentar `testing-catalog` como catálogo de **decisão** (não-asset, fora do barrel) e mencionar a skill `setup-testing` + o detector `detect/testing.mjs`. Uma ou duas linhas, alinhadas ao estilo existente.

- [ ] **Step 2: Verificação final completa**

Run: `npm test`
Expected: PASS (typecheck + lint + unit).

- [ ] **Step 3: Commit**

```bash
git add CLAUDE.md
git commit -m "docs: document testing-catalog and setup-testing in CLAUDE.md

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Self-Review (preenchido pelo autor do plano)

**1. Spec coverage:**
- §5 detect/testing.mjs → Task 2 ✓; testing-catalog.mjs → Task 1 ✓; profile typedef → Task 2 ✓; index.mjs wiring → Task 2 ✓; claude-md note → Task 4 ✓; plan note → Task 4 ✓; scan report → Task 3 ✓; skill setup-testing → Task 5 ✓; project-catalog registro → Task 5 ✓; init 5.7 → Task 6 ✓; doctor → Task 6 ✓.
- §7 tabela de recomendação → Task 1 RECIPES ✓ (inclui resolução js por framework + alias php-adianti/kotlin).
- §8 detecção (globs, hasTestScript via raw, configured) → Task 2 ✓; refinamento E2E (Playwright/Cypress fora) → Task 1 `E2E_FRAMEWORKS` + Task 2 filtro ✓.
- §14 plano de testes → Tasks 1-5 cobrem detect/catalog/plan/claude-md/skill ✓.
- Doc do engine (CLAUDE.md) — não estava na spec explícita, mas a regra de manutenção de catálogos pede; Task 7 cobre.

**2. Placeholder scan:** sem TBD/TODO; todo passo de código mostra o código; comandos com saída esperada. ✓

**3. Type consistency:** `TestingInfo`/`TestingRecipe` idênticos entre spec e tasks; `detectTesting(profile, files)`, `recommendTesting(profile)`, `E2E_FRAMEWORKS` consistentes em Tasks 1-2 e nos consumidores (3-4). `profile.testing` lido igual em render/claude-md/plan. ✓
