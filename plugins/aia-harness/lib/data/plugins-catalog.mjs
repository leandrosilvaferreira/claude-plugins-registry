/**
 * Curated catalog of external Claude Code marketplaces and plugins worth
 * suggesting, grouped by purpose and (where sensible) keyed to a detected stack.
 *
 * Marketplace identifiers have TWO forms: the `repo` used by
 * `claude plugin marketplace add <repo>`, and the registered `name` (from the
 * marketplace's marketplace.json) used by `claude plugin install <plugin>@<name>`.
 * All plugin names below are verified to exist in `claude-plugins-official`.
 *
 * @module data/plugins-catalog
 */

/** @typedef {import('../profile.mjs').ProjectProfile} ProjectProfile */

/** @typedef {{ repo: string, name: string, description: string }} Marketplace */

/**
 * @typedef {Object} PluginSuggestion
 * @property {string} name
 * @property {string} marketplace        Registered marketplace NAME (for install), e.g. "claude-plugins-official".
 * @property {"development"|"quality"|"search"|"workflow"} purpose
 * @property {string} description
 * @property {(p: ProjectProfile) => boolean} [when]  Stack predicate; omit = always.
 */

/** @type {Marketplace[]} */
export const MARKETPLACES = [
  {
    repo: "anthropics/claude-plugins-official",
    name: "claude-plugins-official",
    description: "Official Anthropic-curated marketplace.",
  },
  {
    repo: "obra/superpowers",
    name: "superpowers-dev",
    description: "Superpowers — core skills library (TDD, debugging, collaboration) by Jesse Vincent.",
  },
  {
    repo: "nextlevelbuilder/ui-ux-pro-max-skill",
    name: "ui-ux-pro-max-skill",
    description: "UI/UX Pro Max — design intelligence skill (styles, palettes, typography) by nextlevelbuilder.",
  },
];

const OFFICIAL = "claude-plugins-official";
const SUPERPOWERS = "superpowers-dev";
const UIUX = "ui-ux-pro-max-skill";

/** @param {ProjectProfile} p @param {string[]} langs */
function langIn(p, langs) {
  return p.primaryLanguage != null && langs.includes(p.primaryLanguage);
}

/** @type {PluginSuggestion[]} */
export const PLUGIN_SUGGESTIONS = [
  // Language servers (one per detected language).
  { name: "typescript-lsp", marketplace: OFFICIAL, purpose: "development", description: "TypeScript/JavaScript language server.", when: (p) => langIn(p, ["TypeScript", "JavaScript"]) },
  { name: "pyright-lsp", marketplace: OFFICIAL, purpose: "development", description: "Python language server (Pyright).", when: (p) => langIn(p, ["Python"]) },
  { name: "gopls-lsp", marketplace: OFFICIAL, purpose: "development", description: "Go language server (gopls).", when: (p) => langIn(p, ["Go"]) },
  { name: "jdtls-lsp", marketplace: OFFICIAL, purpose: "development", description: "Java language server (Eclipse JDT).", when: (p) => langIn(p, ["Java"]) },
  { name: "kotlin-lsp", marketplace: OFFICIAL, purpose: "development", description: "Kotlin language server.", when: (p) => langIn(p, ["Kotlin"]) },
  { name: "csharp-lsp", marketplace: OFFICIAL, purpose: "development", description: "C# language server.", when: (p) => langIn(p, ["C#"]) },
  { name: "clangd-lsp", marketplace: OFFICIAL, purpose: "development", description: "C/C++ language server (clangd).", when: (p) => langIn(p, ["C", "C++"]) },
  { name: "php-lsp", marketplace: OFFICIAL, purpose: "development", description: "PHP language server.", when: (p) => langIn(p, ["PHP"]) },
  // Always-on core (auto-installed by default).
  { name: "claude-code-setup", marketplace: OFFICIAL, purpose: "development", description: "Setup helpers incl. the claude-automation-recommender used by /aia-harness:init." },
  { name: "claude-md-management", marketplace: OFFICIAL, purpose: "development", description: "CLAUDE.md audit/improve + revise-claude-md (claude-md-improver, revise-claude-md skills)." },
  { name: "superpowers", marketplace: SUPERPOWERS, purpose: "workflow", description: "Core skills library: TDD, systematic-debugging, brainstorming, planning, worktrees, collaboration patterns (Jesse Vincent / obra)." },
  { name: "ui-ux-pro-max", marketplace: UIUX, purpose: "workflow", description: "UI/UX design intelligence: 67 styles, 96 palettes, 57 font pairings, 25 charts, 13 stack guidelines (nextlevelbuilder)." },
  { name: "context7", marketplace: OFFICIAL, purpose: "search", description: "Up-to-date library/framework docs (plugin form)." },
  { name: "github", marketplace: OFFICIAL, purpose: "workflow", description: "GitHub issues / PRs / releases integration.", when: (p) => p.vcs.isGit },
  // Quality.
  { name: "hookify", marketplace: OFFICIAL, purpose: "quality", description: "Create hooks from conversation patterns to prevent repeat mistakes." },
  { name: "code-review", marketplace: OFFICIAL, purpose: "quality", description: "Structured pull-request / diff review." },
  { name: "pr-review-toolkit", marketplace: OFFICIAL, purpose: "quality", description: "Deeper PR review workflow.", when: (p) => p.vcs.isGit },
  { name: "security-guidance", marketplace: OFFICIAL, purpose: "quality", description: "Security best-practice guidance and review." },
  // Workflow.
  { name: "commit-commands", marketplace: OFFICIAL, purpose: "workflow", description: "Commit / push / open-PR helper commands." },
  { name: "feature-dev", marketplace: OFFICIAL, purpose: "workflow", description: "Guided feature development with codebase understanding." },
  { name: "frontend-design", marketplace: OFFICIAL, purpose: "workflow", description: "Distinctive, production-grade frontend implementation (Anthropic)." },
];

/**
 * Plugin suggestions relevant to a profile.
 * @param {ProjectProfile} profile
 * @returns {PluginSuggestion[]}
 */
export function suggestPlugins(profile) {
  return PLUGIN_SUGGESTIONS.filter((s) => !s.when || s.when(profile));
}

/**
 * Resolve the `marketplace add` repo for a registered marketplace name.
 * @param {string} name
 * @returns {string}
 */
export function marketplaceRepo(name) {
  return MARKETPLACES.find((m) => m.name === name)?.repo ?? name;
}
