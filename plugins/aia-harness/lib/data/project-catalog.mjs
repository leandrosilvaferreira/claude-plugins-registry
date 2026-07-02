/**
 * Catalog of FIRST-PARTY (aia-harness authored) distributable assets — the
 * skills and hooks we own and ship into target projects. NOT vendored from
 * upstream.
 *
 * Provenance split (one module per source):
 *  - ecc-catalog.mjs     ECC assets      MIT © Affaan Mustafa  templates/ecc/
 *  - agkit-catalog.mjs   ag-kit assets   MIT © vudovn          templates/ag-kit/
 *  - tools-catalog.mjs   third-party tools (caveman/ponytail/rtk/graphify)
 *                                                              templates/tools/
 *  - project-catalog.mjs THIS FILE: our own skills + hooks     templates/skills|hooks/
 *  - asset-catalog.mjs   barrel that re-exports all of the above
 *
 * MAINTENANCE (enforced by CLAUDE.md): a skill added under templates/skills/ or
 * a hook added under templates/hooks/ that ships to targets MUST be registered
 * here before merge.
 *
 * @module data/project-catalog
 */
import { stackKeys } from "./stack-keys.mjs";

/** @typedef {{ agents: string[], skills: string[], rules: string[] }} AssetSet */

/** First-party skills shipped to every target project (templates/skills/<name>/). */
export const PROJECT_COMMON = {
  agents: /** @type {string[]} */ ([]),
  skills: [
    "run-tests",
    "lint-fix",
    "pre-commit-verify",
    "setup-testing",
    "goal-builder",
    "uncle-bob-craft",
  ],
  rules: /** @type {string[]} */ ([
    "01-ddd.md",
    "02-design-patterns.md",
    "03-coding-principles.md",
    "04-code-quality.md",
    "05-testing.md",
    "06-security.md",
    "07-subagent-dispatch.md",
  ]),
};

/**
 * First-party per-stack skills and rules. Key = stack key from stack-keys.mjs.
 * Skills must exist under templates/skills/<name>/.
 * Rules must exist under templates/rules/<path>.
 * @type {Record<string, AssetSet>}
 */
export const PROJECT_BY_STACK = {
  typescript: { agents: [], skills: [], rules: ["typescript/coding-standards.md"] },
  react: { agents: [], skills: [], rules: ["react/coding-standards.md"] },
  next: { agents: [], skills: [], rules: ["next/coding-standards.md"] },
  vue: { agents: [], skills: [], rules: ["vue/coding-standards.md"] },
  go: { agents: [], skills: [], rules: ["go/coding-standards.md"] },
  rust: { agents: [], skills: [], rules: ["rust/coding-standards.md"] },
  java: { agents: [], skills: [], rules: ["java/coding-standards.md"] },
  "java-spring": { agents: [], skills: [], rules: ["java-spring/coding-standards.md"] },
  "java-quarkus": { agents: [], skills: [], rules: ["java-quarkus/coding-standards.md"] },
  kotlin: { agents: [], skills: [], rules: ["kotlin/coding-standards.md"] },
  python: { agents: [], skills: [], rules: ["python/coding-standards.md"] },
  django: { agents: [], skills: [], rules: ["django/coding-standards.md"] },
  fastapi: { agents: [], skills: [], rules: ["fastapi/coding-standards.md"] },
  nestjs: {
    agents: ["nestjs-code-reviewer", "nestjs-security-reviewer"],
    skills: ["nestjs-db-migration", "nestjs-gen-test", "nestjs-pr-check"],
    rules: [
      "nestjs/architecture.md",
      "nestjs/auth-security.md",
      "nestjs/config-env.md",
      "nestjs/database-drizzle.md",
      "nestjs/error-handling.md",
      "nestjs/interceptors.md",
      "nestjs/observability.md",
      "nestjs/swagger-openapi.md",
      "nestjs/testing-jest.md",
      "nestjs/validation-zod.md",
    ],
  },
  php: { agents: [], skills: [], rules: ["php/coding-standards.md"] },
  "php-laravel": { agents: [], skills: [], rules: ["php-laravel/coding-standards.md"] },
  "php-adianti": {
    agents: [],
    skills: ["adianti-framework", "new-module-adianti"],
    rules: ["php-adianti/coding-standards.md"],
  },
  csharp: { agents: [], skills: [], rules: ["csharp/coding-standards.md"] },
  cpp: { agents: [], skills: [], rules: ["cpp/coding-standards.md"] },
  dart: { agents: [], skills: [], rules: ["dart/coding-standards.md"] },
};

/**
 * First-party hook scripts copied verbatim into every target's .claude/hooks/
 * (from templates/hooks/<file>). Stack-independent. Conditionally-generated
 * hooks (format-on-edit, verify-on-stop, set-files-changed) are built in
 * plan.mjs because they depend on the profile / strict flag.
 */
export const PROJECT_HOOK_FILES = [
  "secret-scan.mjs",
  "rtk-hook.mjs",
  "large-file-warning.mjs",
  "guard-main-branch.mjs",
  "memory-stop.mjs",
  "sql-idempotent-review.mjs",
  "worktree-subagent-ctx.mjs",
  "worktree-session-ctx.mjs",
  "worktree-prompt-ctx.mjs",
  "worktree-write-guard.mjs",
  "check-deps-on-start.mjs",
  "validate-settings-schema.mjs",
];

const HOOK_DIR = "${CLAUDE_PROJECT_DIR}/.claude/hooks";

/**
 * Exec-form object for a first-party JS hook (no shell required).
 * Spread into the hook entry: { type: "command", ...projectHookCommand(file), timeout }.
 * @param {string} file  Hook file under .claude/hooks/, e.g. "phpstan-on-edit.mjs".
 * @returns {{ command: string, args: string[] }}
 */
function projectHookCommand(file) {
  return { command: "node", args: [`${HOOK_DIR}/${file}`] };
}

/**
 * @typedef {Object} ProjectHookDef
 * @property {string} file                          Template under templates/hooks/<file>.
 * @property {"PreToolUse"|"PostToolUse"|"Stop"|"SessionStart"|"UserPromptSubmit"|"SubagentStart"} event
 * @property {string} [matcher]                     Tool matcher (Pre/PostToolUse).
 * @property {number} [timeout]
 */

/** PHPStan static analysis after a PHP edit — same wiring across all PHP stacks. */
const PHP_HOOKS = /** @type {ProjectHookDef[]} */ ([
  {
    file: "phpstan-on-edit.mjs",
    event: "PostToolUse",
    matcher: "Edit|Write|MultiEdit",
    timeout: 60,
  },
]);

/**
 * First-party hook scripts shipped only for specific stacks, with their
 * settings.json wiring. Key = stack key from stack-keys.mjs. Files must exist
 * under templates/hooks/<file>. (Stack-independent hooks live in PROJECT_HOOK_FILES.)
 * @type {Record<string, ProjectHookDef[]>}
 */
export const PROJECT_HOOK_BY_STACK = {
  php: PHP_HOOKS,
  "php-laravel": PHP_HOOKS,
  "php-adianti": PHP_HOOKS,
};

/**
 * Stack-specific first-party hooks for a profile: the files to copy into
 * .claude/hooks/ and the settings.json wiring (event → entries), deduped by file.
 * The settings shape matches toolSettingsHooks so plan.mjs can merge both.
 * @param {import('../profile.mjs').ProjectProfile} profile
 * @returns {{ files: string[], settings: Record<string, { matcher?: string, hooks: { type: "command", command: string, args?: string[], timeout: number }[] }[]> }}
 */
export function selectProjectHooks(profile) {
  /** @type {Map<string, ProjectHookDef>} */
  const byFile = new Map();
  for (const key of stackKeys(profile)) {
    for (const def of PROJECT_HOOK_BY_STACK[key] ?? []) {
      if (!byFile.has(def.file)) byFile.set(def.file, def);
    }
  }
  /** @type {Record<string, { matcher?: string, hooks: { type: "command", command: string, args?: string[], timeout: number }[] }[]>} */
  const settings = {};
  for (const d of byFile.values()) {
    const hook = {
      type: /** @type {const} */ ("command"),
      ...projectHookCommand(d.file),
      timeout: d.timeout ?? 30,
    };
    const entry = d.matcher ? { matcher: d.matcher, hooks: [hook] } : { hooks: [hook] };
    (settings[d.event] ??= []).push(entry);
  }
  return { files: [...byFile.keys()], settings };
}

/**
 * First-party assets to install for a profile (common + stack-specific, deduped).
 * @param {import('../profile.mjs').ProjectProfile} profile
 * @returns {AssetSet}
 */
export function selectProjectAssets(profile) {
  /** @type {Set<string>} */ const agents = new Set(PROJECT_COMMON.agents);
  /** @type {Set<string>} */ const skills = new Set(PROJECT_COMMON.skills);
  /** @type {Set<string>} */ const rules = new Set(PROJECT_COMMON.rules);

  for (const key of stackKeys(profile)) {
    const set = PROJECT_BY_STACK[key];
    if (!set) continue;
    set.agents.forEach((a) => agents.add(a));
    set.skills.forEach((s) => skills.add(s));
    set.rules.forEach((r) => rules.add(r));
  }

  return { agents: [...agents].sort(), skills: [...skills].sort(), rules: [...rules].sort() };
}

/**
 * When-to-use descriptions for first-party agents, used by resolveAgentWhenToUse
 * to populate the root CLAUDE.md Agents table.
 * @type {Record<string, string>}
 */
export const PROJECT_AGENT_WHEN_TO_USE = {
  "nestjs-code-reviewer":
    "Reviews NestJS controllers, services, modules, Drizzle schemas, and zod DTOs for architecture, DB, validation, TypeScript, and Swagger compliance. Use proactively after editing any NestJS HTTP or persistence file. MUST BE USED before merging NestJS changes (excluding auth — use nestjs-security-reviewer for those).",
  "nestjs-security-reviewer":
    "Exploitability-focused review of NestJS auth, JWT config, authorization guards, input handling, CORS, and env/secret exposure. Use proactively after any change to auth, users, config/env files, or a new endpoint. MUST BE USED before merging auth or security-sensitive NestJS changes.",
};

/**
 * Union of every first-party catalogued skill — handy for inventory/tests.
 * @returns {AssetSet}
 */
export function allProjectAssets() {
  /** @type {Set<string>} */ const agents = new Set(PROJECT_COMMON.agents);
  /** @type {Set<string>} */ const skills = new Set(PROJECT_COMMON.skills);
  /** @type {Set<string>} */ const rules = new Set(PROJECT_COMMON.rules);
  for (const set of Object.values(PROJECT_BY_STACK)) {
    set.agents.forEach((a) => agents.add(a));
    set.skills.forEach((s) => skills.add(s));
    set.rules.forEach((r) => rules.add(r));
  }
  return { agents: [...agents].sort(), skills: [...skills].sort(), rules: [...rules].sort() };
}
