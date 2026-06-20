/**
 * Generate path-scoped rule files for `.claude/rules/`. Each rule carries
 * `paths:` frontmatter so it is loaded only when relevant files are touched.
 *
 * @module generate/rules
 */

/** @typedef {import('../profile.mjs').ProjectProfile} ProjectProfile */
/** @typedef {{ relPath: string, title: string, content: string }} RuleFile */

/**
 * @param {string[]} paths
 * @param {string} body
 * @returns {string}
 */
function ruleDoc(paths, body) {
  const fm = ["---", "paths:", ...paths.map((p) => `  - "${p}"`), "---", ""].join("\n");
  return fm + body;
}

/**
 * @param {ProjectProfile} profile
 * @returns {RuleFile[]}
 */
export function renderRules(profile) {
  /** @type {RuleFile[]} */
  const rules = [];
  const c = profile.commands;
  const primary = profile.primaryLanguage;

  // Always: a verification rule scoped to all source.
  rules.push({
    relPath: ".claude/rules/verification.md",
    title: "Verification",
    content: ruleDoc(
      ["**/*"],
      `# Verification before completion

Before claiming a task is done:
${[c.typecheck && `- Typecheck: \`${c.typecheck}\``, c.lint && `- Lint: \`${c.lint}\``, c.test && `- Test: \`${c.test}\``]
  .filter(Boolean)
  .join("\n") || "- Run the project's lint and test commands."}

Report the actual command output. Do not assert success without running them.
`,
    ),
  });

  // Always: a testing rule scoped to all source.
  rules.push({
    relPath: ".claude/rules/testing.md",
    title: "Unit tests",
    content: ruleDoc(
      ["**/*"],
      `# Unit tests

For every new function, class, or module added:
- Write at least one unit test covering the happy path.
- Write edge-case tests for non-trivial logic.
- Use the project's existing test framework and conventions.
${c.test ? `- Run \`${c.test}\` before claiming done.` : "- Run the project's test command before claiming done."}
`,
    ),
  });

  if (primary === "JavaScript" || primary === "TypeScript") {
    const isTs = primary === "TypeScript";
    rules.push({
      relPath: ".claude/rules/javascript.md",
      title: "JavaScript / TypeScript",
      content: ruleDoc(
        isTs
          ? ["**/*.ts", "**/*.tsx", "**/*.mts", "**/*.cts"]
          : ["**/*.js", "**/*.jsx", "**/*.mjs", "**/*.cjs"],
        `# ${primary} rules

- Lint: \`${c.lint ?? "configure a linter (eslint or biome)"}\`.
- Format: \`${c.format ?? "configure a formatter"}\`.
${isTs ? `- Typecheck: \`${c.typecheck ?? "npx tsc --noEmit"}\`. Avoid \`any\`; prefer explicit types at boundaries.\n` : ""}- Keep modules small and single-purpose. Prefer named exports.
- Do not add dependencies without a clear need.
`,
      ),
    });
  }

  if (primary === "PHP") {
    rules.push({
      relPath: ".claude/rules/php.md",
      title: "PHP",
      content: ruleDoc(
        ["**/*.php"],
        `# PHP rules

- Static analysis: \`${c.typecheck ?? "./vendor/bin/phpstan analyse"}\`.
- Code style: \`${c.format ?? "./vendor/bin/pint"}\`.
- Tests: \`${c.test ?? "./vendor/bin/phpunit"}\`.
- Follow PSR-12. Use strict types (\`declare(strict_types=1);\`) in new files.
`,
      ),
    });
  }

  return rules;
}
