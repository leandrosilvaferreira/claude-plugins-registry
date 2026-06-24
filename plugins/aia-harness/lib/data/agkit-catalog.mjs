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

/** Short "when to use" labels for the CLAUDE.md Workflow & Agents table (≤8 words each). */
export const AGKIT_AGENT_WHEN_TO_USE = /** @type {Record<string,string>} */ ({
  orchestrator:
    "tarefas multi-agente ou cross-domain — despache ESTE para subdelegar; nunca despache agentes genéricos diretamente",
  "project-planner": "planejamento de features, decomposição de tarefas",
  "code-archaeologist": "entender código legado, refatoração",
  "database-architect": "schema, migrations, queries, modelagem de dados",
  "devops-engineer": "deploy, CI/CD, infra, produção",
  "documentation-writer": "apenas quando documentação explicitamente solicitada",
  "performance-optimizer": "otimização de performance, profiling",
  "penetration-tester": "pentest, vulnerabilidades, segurança ofensiva",
  "product-manager": "decisões de produto, priorização, roadmap",
  "product-owner": "refinamento de backlog, critérios de aceite",
  "qa-automation-engineer": "E2E, automação de QA, Playwright/Cypress",
  "test-engineer": "unit tests, integração, cobertura de código",
  "security-auditor": "auditoria de segurança, SAST, revisão defensiva",
  debugger: "depuração de bugs complexos, root cause analysis",
  "explorer-agent": "exploração de codebase desconhecida, mapeamento",
  "backend-specialist": "API, lógica server-side, integração com banco",
  "frontend-specialist": "componentes UI, styling, performance frontend",
  "seo-specialist": "SEO, meta tags, visibilidade em buscadores",
  "mobile-developer": "React Native, Flutter, features mobile",
  "game-developer": "Unity, Godot, mecânicas e engines de jogo",
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
