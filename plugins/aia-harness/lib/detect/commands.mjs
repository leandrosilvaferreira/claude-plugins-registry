/**
 * Command discovery: lint / format / typecheck / test / build / run.
 * Priority: declared scripts > config-implied tool > ecosystem default.
 * @module detect/commands
 */
import path from "node:path";
import { readJson, exists } from "../util/fs.mjs";

/** @typedef {import('../profile.mjs').CommandSet} CommandSet */

/**
 * @param {string|undefined} pm
 * @returns {(script: string) => string}
 */
function jsRunner(pm) {
  switch (pm) {
    case "pnpm":
      return (s) => `pnpm ${s}`;
    case "yarn":
      return (s) => `yarn ${s}`;
    case "bun":
      return (s) => `bun run ${s}`;
    default:
      return (s) => `npm run ${s}`;
  }
}

/**
 * @param {string} root
 * @param {import('../profile.mjs').PackageManagerInfo|undefined} pm
 * @param {Set<string>} rootFiles
 * @returns {CommandSet}
 */
function jsCommands(root, pm, rootFiles) {
  const pkg = readJson(path.join(root, "package.json")) ?? {};
  /** @type {Record<string, string>} */
  const scripts =
    pkg.scripts && typeof pkg.scripts === "object" ? pkg.scripts : {};
  const run = jsRunner(pm?.name);

  /** @param {...string} names */
  const pick = (...names) => {
    for (const n of names) if (scripts[n]) return run(n);
    return null;
  };

  const hasTs =
    rootFiles.has("tsconfig.json") ||
    !!pkg.devDependencies?.typescript ||
    !!pkg.dependencies?.typescript;
  const biome = rootFiles.has("biome.json") || rootFiles.has("biome.jsonc");
  const eslint = [
    ".eslintrc",
    ".eslintrc.js",
    ".eslintrc.cjs",
    ".eslintrc.json",
    ".eslintrc.yml",
    "eslint.config.js",
    "eslint.config.mjs",
    "eslint.config.cjs",
  ].some((f) => rootFiles.has(f));
  const prettier = [
    ".prettierrc",
    ".prettierrc.json",
    ".prettierrc.js",
    ".prettierrc.cjs",
    "prettier.config.js",
    "prettier.config.mjs",
  ].some((f) => rootFiles.has(f));

  const installCmd =
    pm?.name === "pnpm"
      ? "pnpm install"
      : pm?.name === "yarn"
        ? "yarn"
        : pm?.name === "bun"
          ? "bun install"
          : "npm install";

  return {
    install: installCmd,
    lint:
      pick("lint") ??
      (biome ? "npx @biomejs/biome lint ." : eslint ? "npx eslint ." : null),
    format:
      pick("format", "fmt") ??
      (biome
        ? "npx @biomejs/biome format --write ."
        : prettier
          ? "npx prettier --write ."
          : null),
    typecheck:
      pick("typecheck", "type-check", "tsc", "check-types") ??
      (hasTs ? "npx tsc --noEmit" : null),
    test: pick("test"),
    build: pick("build"),
    run: pick("dev", "start", "serve"),
    source: "package.json scripts + config",
    raw: scripts,
  };
}

/**
 * @param {string} root
 * @param {Set<string>} rootFiles
 * @returns {CommandSet}
 */
function phpCommands(root, rootFiles) {
  const hasComposer = rootFiles.has("composer.json");
  const composer = hasComposer ? (readJson(path.join(root, "composer.json")) ?? {}) : {};
  /** @type {Record<string, string>} */
  const scripts =
    composer.scripts && typeof composer.scripts === "object" ? composer.scripts : {};
  /** @type {Record<string, unknown>} */
  const req = { ...(composer.require ?? {}), ...(composer["require-dev"] ?? {}) };
  const dep = (/** @type {string} */ n) => n in req;
  const vendorBin = (/** @type {string} */ n) => exists(path.join(root, "vendor", "bin", n));

  const hasPest = dep("pestphp/pest") || vendorBin("pest");
  const hasPhpunit =
    dep("phpunit/phpunit") ||
    vendorBin("phpunit") ||
    rootFiles.has("phpunit.xml") ||
    rootFiles.has("phpunit.xml.dist");
  const hasPint = dep("laravel/pint") || vendorBin("pint");
  const hasCsFixer = dep("friendsofphp/php-cs-fixer") || vendorBin("php-cs-fixer");
  const hasPhpstan =
    dep("phpstan/phpstan") ||
    vendorBin("phpstan") ||
    rootFiles.has("phpstan.neon") ||
    rootFiles.has("phpstan.neon.dist");
  const hasPsalm = dep("vimeo/psalm") || vendorBin("psalm") || rootFiles.has("psalm.xml");
  const isLaravel = dep("laravel/framework") || rootFiles.has("artisan");

  const staticAnalysis = hasPhpstan
    ? "./vendor/bin/phpstan analyse"
    : hasPsalm
      ? "./vendor/bin/psalm"
      : null;

  let test = null;
  if (scripts.test) test = "composer test";
  else if (hasPest) test = "./vendor/bin/pest";
  else if (hasPhpunit) test = "./vendor/bin/phpunit";

  return {
    install: hasComposer ? "composer install" : null,
    lint: staticAnalysis,
    format: hasPint
      ? "./vendor/bin/pint"
      : hasCsFixer
        ? "./vendor/bin/php-cs-fixer fix"
        : null,
    typecheck: staticAnalysis,
    test,
    build: isLaravel ? "php artisan optimize" : null,
    run: isLaravel ? "php artisan serve" : hasComposer ? null : "php -S localhost:8000",
    source: hasComposer ? "composer.json + config" : "PHP native (no Composer)",
    raw: scripts,
  };
}

/**
 * @param {string} ecosystem
 * @param {Set<string>} rootFiles
 * @returns {CommandSet}
 */
function genericCommands(ecosystem, rootFiles) {
  const maven = rootFiles.has("pom.xml");
  /** @type {Record<string, Partial<CommandSet>>} */
  const table = {
    go: {
      install: "go mod download",
      lint: "go vet ./...",
      format: "gofmt -l -w .",
      typecheck: "go build ./...",
      test: "go test ./...",
      build: "go build ./...",
      run: "go run .",
    },
    rust: {
      install: "cargo fetch",
      lint: "cargo clippy --all-targets",
      format: "cargo fmt",
      typecheck: "cargo check",
      test: "cargo test",
      build: "cargo build",
      run: "cargo run",
    },
    jvm: {
      install: maven ? "mvn install -DskipTests" : "gradle build -x test",
      lint: maven ? "mvn checkstyle:check" : "gradle check",
      test: maven ? "mvn test" : "gradle test",
      build: maven ? "mvn package" : "gradle build",
      run: maven ? "mvn exec:java" : "gradle run",
    },
    ruby: {
      install: "bundle install",
      lint: "bundle exec rubocop",
      format: "bundle exec rubocop -A",
      test: "bundle exec rspec",
      run: "bundle exec ruby",
    },
    python: {
      install: "pip install -r requirements.txt",
      lint: "ruff check",
      format: "ruff format",
      typecheck: "mypy .",
      test: "pytest",
      build: "python -m build",
      run: "python",
    },
  };
  const t = table[ecosystem] ?? {};
  return {
    install: t.install ?? null,
    lint: t.lint ?? null,
    format: t.format ?? null,
    typecheck: t.typecheck ?? null,
    test: t.test ?? null,
    build: t.build ?? null,
    run: t.run ?? null,
    source: ecosystem === "unknown" ? "none" : "ecosystem default",
    raw: {},
  };
}

/**
 * Java/JVM commands, aware of Maven vs Gradle and Spring vs Quarkus.
 * @param {string} root
 * @param {Set<string>} rootFiles
 * @param {import('../profile.mjs').FrameworkInfo[]} frameworks
 * @returns {CommandSet}
 */
function javaCommands(root, rootFiles, frameworks) {
  const maven = rootFiles.has("pom.xml");
  const gradle = rootFiles.has("build.gradle") || rootFiles.has("build.gradle.kts");
  const gw = rootFiles.has("gradlew") ? "./gradlew" : "gradle";
  const names = frameworks.map((f) => f.name);
  const isQuarkus = names.includes("Quarkus");
  const isSpring = names.includes("Spring Boot");

  let run = null;
  if (maven) run = isQuarkus ? "mvn quarkus:dev" : isSpring ? "mvn spring-boot:run" : "mvn exec:java";
  else if (gradle) run = isQuarkus ? `${gw} quarkusDev` : isSpring ? `${gw} bootRun` : `${gw} run`;

  const fw = isQuarkus ? ", quarkus" : isSpring ? ", spring" : "";
  return {
    install: maven ? "mvn -q -DskipTests install" : gradle ? `${gw} build -x test` : null,
    lint: maven ? "mvn -q checkstyle:check" : gradle ? `${gw} check` : null,
    format: maven ? "mvn -q spotless:apply" : gradle ? `${gw} spotlessApply` : null,
    typecheck: maven ? "mvn -q -DskipTests compile" : gradle ? `${gw} compileJava` : null,
    test: maven ? "mvn test" : gradle ? `${gw} test` : null,
    build: maven ? "mvn package" : gradle ? `${gw} build` : null,
    run,
    source: `java (${maven ? "maven" : gradle ? "gradle" : "unknown"}${fw})`,
    raw: {},
  };
}

/**
 * Go commands, preferring golangci-lint when configured.
 * @param {string} _root
 * @param {Set<string>} rootFiles
 * @returns {CommandSet}
 */
function goCommands(_root, rootFiles) {
  const golangci = [".golangci.yml", ".golangci.yaml", ".golangci.toml"].some((f) => rootFiles.has(f));
  return {
    install: "go mod download",
    lint: golangci ? "golangci-lint run" : "go vet ./...",
    format: "gofmt -l -w .",
    typecheck: "go build ./...",
    test: "go test ./...",
    build: "go build ./...",
    run: "go run .",
    source: golangci ? "go (golangci-lint)" : "go",
    raw: {},
  };
}

/**
 * @param {string} root
 * @param {import('../profile.mjs').PackageManagerInfo[]} pms
 * @param {Set<string>} rootFiles
 * @param {import('../profile.mjs').FrameworkInfo[]} [frameworks]
 * @returns {CommandSet}
 */
export function detectCommands(root, pms, rootFiles, frameworks = []) {
  const primary = pms[0];
  const ecosystem = primary?.ecosystem ?? "unknown";
  if (ecosystem === "js") return jsCommands(root, primary, rootFiles);
  if (ecosystem === "php") return phpCommands(root, rootFiles);
  if (ecosystem === "jvm") return javaCommands(root, rootFiles, frameworks);
  if (ecosystem === "go") return goCommands(root, rootFiles);
  return genericCommands(ecosystem, rootFiles);
}
