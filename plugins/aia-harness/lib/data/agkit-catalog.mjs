/**
 * Curated map of detected-stack -> ag-kit assets (agents / skills / commands /
 * scripts). Single source of truth for BOTH the sync script (what to vendor)
 * and the planner (what to install). Asset names are ag-kit's filenames.
 *
 * @module data/agkit-catalog
 */
import { stackKeys as baseStackKeys } from "./stack-keys.mjs";

/** @typedef {{ agents: string[], skills: string[], commands: string[], scripts: string[] }} AgkitAssetSet */

/** Workflows that survive the name-collision rule (only `status` collides). */
const AGKIT_COMMANDS = [
  "brainstorm",
  "coordinate",
  "create",
  "debug",
  "deploy",
  "enhance",
  "orchestrate",
  "plan",
  "preview",
  "remember",
  "test",
  "verify",
];

/** Installed for every project. */
export const AGKIT_COMMON = {
  agents: [
    "orchestrator",
    "project-planner",
    "code-archaeologist",
    "documentation-writer",
    "devops-engineer",
    "database-architect",
    "performance-optimizer",
    "qa-automation-engineer",
    "test-engineer",
    "penetration-tester",
    "security-auditor",
    "product-manager",
    "product-owner",
    "debugger",
    "explorer-agent",
  ],
  skills: [
    "architecture",
    "clean-code",
    "context-compression",
    "memory-system",
    "lint-and-validate",
    "behavioral-modes",
    "intelligent-routing",
    "coordinator-mode",
    "batch-operations",
    "documentation-templates",
    "deployment-procedures",
    "testing-patterns",
    "database-design",
    "server-management",
    "performance-profiling",
    "bash-linux",
    "powershell-windows",
    "red-team-tactics",
    "vulnerability-scanner",
  ],
  commands: AGKIT_COMMANDS,
  scripts: ["verify_all", "checklist"],
};

const WEB = {
  agents: ["frontend-specialist", "backend-specialist", "seo-specialist"],
  skills: ["tailwind-patterns", "web-design-guidelines", "app-builder", "i18n-localization"],
  commands: [],
  scripts: [],
};
const BACKEND = { agents: ["backend-specialist"], skills: [], commands: [], scripts: [] };
const MOBILE = {
  agents: ["mobile-developer", "backend-specialist"],
  skills: ["mobile-design", "i18n-localization"],
  commands: [],
  scripts: [],
};
const GAMES = {
  agents: ["game-developer", "backend-specialist"],
  skills: ["game-development"],
  commands: [],
  scripts: [],
};

/** @type {Record<string, AgkitAssetSet>} */
export const AGKIT_BY_STACK = {
  react: WEB,
  vue: WEB,
  typescript: BACKEND,
  python: BACKEND,
  go: BACKEND,
  rust: BACKEND,
  java: BACKEND,
  "java-spring": BACKEND,
  "java-quarkus": BACKEND,
  kotlin: BACKEND,
  php: BACKEND,
  "php-laravel": BACKEND,
  "php-adianti": BACKEND,
  django: BACKEND,
  fastapi: BACKEND,
  csharp: BACKEND,
  cpp: BACKEND,
  dart: MOBILE,
  mobile: MOBILE,
  games: GAMES,
};

/**
 * ag-kit stack keys: ECC's keys plus ag-kit-only `mobile`/`games` derived from
 * the same profile (no new detectors).
 * @param {import('../profile.mjs').ProjectProfile} profile
 * @returns {string[]}
 */
export function stackKeys(profile) {
  const keys = baseStackKeys(profile);
  const fw = profile.frameworks.map((f) => f.name);
  if (profile.primaryLanguage === "Dart" || fw.some((n) => /react native|expo|flutter/i.test(n))) {
    keys.push("mobile");
  }
  if (fw.some((n) => /unity|godot|phaser|unreal|bevy/i.test(n))) keys.push("games");
  return [...new Set(keys)];
}

/**
 * @param {{agents:Set<string>,skills:Set<string>,commands:Set<string>,scripts:Set<string>}} into
 * @param {AgkitAssetSet} from
 */
function merge(into, from) {
  from.agents.forEach((a) => into.agents.add(a));
  from.skills.forEach((s) => into.skills.add(s));
  from.commands.forEach((c) => into.commands.add(c));
  from.scripts.forEach((s) => into.scripts.add(s));
}

/** @param {{agents:Set<string>,skills:Set<string>,commands:Set<string>,scripts:Set<string>}} sets @returns {AgkitAssetSet} */
function freeze(sets) {
  return {
    agents: [...sets.agents].sort(),
    skills: [...sets.skills].sort(),
    commands: [...sets.commands].sort(),
    scripts: [...sets.scripts].sort(),
  };
}

/** @returns {{agents:Set<string>,skills:Set<string>,commands:Set<string>,scripts:Set<string>}} */
function commonSets() {
  return {
    agents: new Set(AGKIT_COMMON.agents),
    skills: new Set(AGKIT_COMMON.skills),
    commands: new Set(AGKIT_COMMON.commands),
    scripts: new Set(AGKIT_COMMON.scripts),
  };
}

export const AGKIT_AGENT_WHEN_TO_USE = /** @type {Record<string,string>} */ ({
  orchestrator:
    "Coordinates multi-agent or cross-domain tasks by subdelegating to specialized agents. Use proactively when a task spans multiple domains or requires parallel subagent execution. MUST BE USED instead of dispatching generic agents directly for complex workflows.",
  "project-planner":
    "Breaks features and epics into ordered, executable tasks with clear acceptance criteria. Use proactively when starting a new feature, sprint, or significant refactor that needs a structured plan before implementation begins.",
  "code-archaeologist":
    "Reverse-engineers undocumented or legacy code to uncover intent, trace logic, and map hidden dependencies. Use proactively before refactoring unfamiliar legacy code or when you need to understand why existing behavior exists.",
  "database-architect":
    "Designs schemas, migrations, indexes, and query strategies for correctness, integrity, and scalability. Use proactively when adding tables, modifying schemas, planning migrations, or diagnosing slow queries.",
  "devops-engineer":
    "Owns deployment, CI/CD pipelines, infrastructure configuration, and production operations. Use proactively when deploying, configuring servers, setting up CI, or troubleshooting production incidents.",
  "documentation-writer":
    "Produces clear, example-rich technical documentation — READMEs, API docs, runbooks, and guides. Use when documentation is explicitly requested or after a feature ships and needs user-facing docs.",
  "performance-optimizer":
    "Profiles and fixes performance bottlenecks — slow endpoints, high memory usage, poor Core Web Vitals, and database query inefficiency. Use proactively after profiling reveals a bottleneck or when response times degrade.",
  "penetration-tester":
    "Simulates attacker techniques to find exploitable vulnerabilities using PTES and OWASP methodologies. Use proactively before a security release, after adding new auth flows, or when a pentest is required.",
  "product-manager":
    "Clarifies ambiguous requirements and prioritizes roadmap decisions when requirements are undefined before a story exists. Use when discovery and prioritization need structured analysis.",
  "product-owner":
    "Translates business objectives into actionable technical specs and defines acceptance criteria for existing stories before implementation begins. Use when a story needs clear acceptance criteria before development starts.",
  "qa-automation-engineer":
    "Writes and maintains E2E tests (Playwright/Cypress) and CI/CD quality gates. Use proactively after new user flows are implemented or when E2E coverage is missing for a critical path.",
  "test-engineer":
    "Writes unit and integration tests with TDD discipline, coverage analysis, and edge-case discovery. Use proactively after implementing new logic or when test coverage gaps are identified.",
  "security-auditor":
    "Performs defensive SAST reviews, threat modeling, and hardening recommendations using defense-in-depth principles. Use proactively before a major release or after architectural changes that touch auth, data handling, or trust boundaries.",
  debugger:
    "Finds the root cause of bugs, crashes, and flaky behavior through systematic, evidence-based investigation. Use proactively when a test fails or a defect is reported, before attempting a fix.",
  "explorer-agent":
    "Maps an unfamiliar or complex codebase — architecture, patterns, dependencies, and risk areas — to inform planning and integration decisions. Use proactively when onboarding to a new codebase or before planning a cross-cutting change.",
  "backend-specialist":
    "Implements and reviews API endpoints, server-side business logic, authentication, and database integration. Use proactively when building or modifying backend services, REST/GraphQL routes, or persistence layers.",
  "frontend-specialist":
    "Designs and implements UI components, layouts, styling, and frontend performance with accessibility and maintainability in mind. Use proactively when building or refactoring UI components, design systems, or frontend architecture.",
  "seo-specialist":
    "Optimizes metadata, structured data, crawlability, and GEO (AI search) visibility for traditional and AI-powered search engines. Use proactively when adding or modifying public-facing pages that need search visibility.",
  "mobile-developer":
    "Builds cross-platform mobile features in React Native or Flutter — navigation, offline support, platform APIs, and native conventions. Use proactively when implementing mobile-specific features, screens, or fixing platform-specific issues.",
  "game-developer":
    "Implements game mechanics, physics, AI, and rendering for Unity, Godot, Phaser, or Bevy projects. Use proactively when building game systems, scenes, or solving engine-specific performance and behavior problems.",
});

/**
 * Resolve the ag-kit assets to install for a profile (deduped, common included).
 * @param {import('../profile.mjs').ProjectProfile} profile
 * @returns {AgkitAssetSet}
 */
export function selectAgkitAssets(profile) {
  const sets = commonSets();
  for (const key of stackKeys(profile)) {
    const set = AGKIT_BY_STACK[key];
    if (set) merge(/** @type {any} */ (sets), set);
  }
  return freeze(sets);
}

/**
 * The union of every catalogued asset — used by the sync script to decide what
 * to vendor.
 * @returns {AgkitAssetSet}
 */
export function allAgkitAssets() {
  const sets = commonSets();
  for (const set of Object.values(AGKIT_BY_STACK)) merge(/** @type {any} */ (sets), set);
  return freeze(sets);
}
