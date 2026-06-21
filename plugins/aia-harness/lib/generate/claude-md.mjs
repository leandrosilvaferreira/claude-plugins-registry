/**
 * Generate CLAUDE.md content (root + per-domain). English output by design.
 * Kept concise: critical rules first, no boilerplate (bloat makes Claude ignore it).
 *
 * @module generate/claude-md
 */

/** @typedef {import('../profile.mjs').ProjectProfile} ProjectProfile */
/** @typedef {import('../profile.mjs').CommandSet} CommandSet */
/** @typedef {import('../profile.mjs').DomainInfo} DomainInfo */
/** @typedef {{ name: string, whenToUse: string }} AgentMeta */

import { skillsForProfile } from "../data/skill-map.mjs";

/**
 * Max sub-domains surfaced by the harness: both the root architecture map and
 * the nested CLAUDE.md files generated for them. Kept in sync so every domain
 * the map links to actually gets a file (no dangling references).
 */
export const DOMAIN_LIMIT = 20;

/**
 * Sentinel comment marking a section the `/init` enrichment pass must never
 * edit, reorder, or remove. It is deliberately NOT an `AI-ENRICH` comment, so
 * the enrichment step (which strips `AI-ENRICH` markers and rewrites
 * `## Conventions`) leaves it intact. `doctor` greps for `aia-harness:fixed`
 * to confirm the non-negotiable rules survived a prior enrichment.
 */
export const FIXED_RULES_MARKER =
  "<!-- aia-harness:fixed — non-negotiable; do not edit, reorder, or remove during enrichment -->";

/**
 * Non-negotiable baseline rules embedded in every generated root CLAUDE.md.
 * They live in their own `## Engineering rules` section (guarded by
 * FIXED_RULES_MARKER) instead of `## Conventions`, because enrichment rewrites
 * `## Conventions` with project-specific rules and would otherwise strip them.
 */
export const ROOT_FIXED_RULES = [
  "Match the style of surrounding code; do not introduce new patterns unprompted.",
  "Write unit tests for every new function or module added.",
  "Run the lint + test commands above before claiming work is complete.",
  "Never commit secrets; keep them in gitignored env files (`.env`/`.env.local`) — `.claude/settings.local.json` is only for MCP-server credentials referenced by `.mcp.json`.",
  'Fix every compilation/syntax/lint error found during a session — regardless of whether you edited the file. Never leave the build broken or label errors "pre-existing, not related".',
];

/**
 * Builds the code-review rule dynamically: always includes `code-reviewer`,
 * plus any stack-specific reviewer agents installed in this project
 * (e.g. `php-reviewer`, `go-reviewer`, `react-reviewer`).
 * @param {AgentMeta[]} agents
 * @returns {string}
 */
export function codeReviewRule(agents) {
  const names = new Set(agents.map((a) => a.name));
  const always = ["code-reviewer", "security-reviewer"].filter((n) => names.has(n));
  const stackReviewers = agents
    .map((a) => a.name)
    .filter((n) => n.endsWith("-reviewer") && !always.includes(n));
  const all = [...always, ...stackReviewers];
  const named = all.map((n) => `\`${n}\``).join(" and ");
  return `When performing a code review (user requests it or a workflow triggers it), always use ${named}.`;
}

/** Per-domain non-negotiable rules; same FIXED_RULES_MARKER protection. */
export const DOMAIN_FIXED_RULES = [
  "Follow the root `CLAUDE.md` canonical commands.",
  "Keep modules focused; prefer small, well-named units over large files.",
];

/**
 * Renders a fixed (non-enrichable) rules section: heading, sentinel marker,
 * then one bullet per rule. Trailing newline included.
 * @param {string} heading
 * @param {readonly string[]} rules
 * @returns {string}
 */
export function fixedRulesBlock(heading, rules) {
  return `## ${heading}\n${FIXED_RULES_MARKER}\n\n${rules.map((r) => `- ${r}`).join("\n")}\n`;
}

/**
 * @param {CommandSet} commands
 * @returns {string}
 */
export function commandsBlock(commands) {
  /** @type {[string, string|null][]} */
  const rows = [
    ["Install", commands.install],
    ["Lint", commands.lint],
    ["Format", commands.format],
    ["Typecheck", commands.typecheck],
    ["Test", commands.test],
    ["Build", commands.build],
    ["Run/Dev", commands.run],
  ];
  const lines = rows
    .filter(([, v]) => v)
    .map(([k, v]) => `- **${k}:** \`${v}\``);
  return lines.length > 0 ? lines.join("\n") : "- _No canonical commands detected — fill these in._";
}

/**
 * Renders the "## Skills" section for a profile. Returns "" if no skills apply
 * (section is omitted rather than showing an empty block).
 *
 * @param {ProjectProfile} profile
 * @returns {string}
 */
export function skillsBlock(profile) {
  const entries = skillsForProfile(profile);
  if (entries.length === 0) return "";
  const lines = entries.map((e) => `- **${e.label}** → \`/${e.skill}\` — ${e.description}`);
  return `## Skills — use para esta stack\n\n> Invoque a skill correspondente antes de trabalhar no domínio dela.\n\n${lines.join("\n")}\n`;
}

/** Priority order for the agents table — most-used roles first. */
const AGENT_ORDER = [
  "orchestrator",
  "code-reviewer", "security-reviewer",
  "go-reviewer", "rust-reviewer", "typescript-reviewer",
  "react-reviewer", "vue-reviewer",
  "java-reviewer", "kotlin-reviewer",
  "php-reviewer", "python-reviewer", "django-reviewer", "fastapi-reviewer",
  "csharp-reviewer", "cpp-reviewer", "flutter-reviewer",
  "go-build-resolver", "rust-build-resolver", "react-build-resolver",
  "java-build-resolver", "kotlin-build-resolver", "django-build-resolver",
  "dart-build-resolver", "cpp-build-resolver",
  "qa-automation-engineer", "test-engineer", "database-architect", "devops-engineer",
  "backend-specialist", "frontend-specialist", "seo-specialist",
  "mobile-developer", "game-developer", "performance-optimizer",
  "product-manager", "product-owner",
  "project-planner", "code-archaeologist", "debugger", "explorer-agent",
  "documentation-writer", "penetration-tester", "security-auditor",
];

/**
 * Renders the "## Workflow & Agents" section. Returns "" if no agents selected.
 * @param {AgentMeta[]} agents
 * @returns {string}
 */
export function agentsWorkflowBlock(agents) {
  if (!agents.length) return "";
  const sorted = [...agents].sort((a, b) => {
    const ai = AGENT_ORDER.indexOf(a.name);
    const bi = AGENT_ORDER.indexOf(b.name);
    if (ai === -1 && bi === -1) return a.name.localeCompare(b.name);
    if (ai === -1) return 1;
    if (bi === -1) return -1;
    return ai - bi;
  });
  const rows = sorted.map((a) => `| \`${a.name}\` | ${a.whenToUse} |`).join("\n");
  return `## Workflow & Agents

Toda implementação não-trivial: invoke \`superpowers:subagent-driven-development\`.
Ao despachar subagentes, você DEVE usar o agente especialista correspondente da tabela abaixo — nunca o agente genérico quando um especialista estiver listado. Cruze o tipo da tarefa com a coluna "When to use" e passe o nome exato como \`subagent_type\`.

| Agent | When to use |
|---|---|
${rows}
`;
}

/**
 * @param {ProjectProfile} profile
 * @returns {string}
 */
function stackLine(profile) {
  const langs = profile.languages
    .filter((l) => l.type === "programming")
    .slice(0, 3)
    .map((l) => l.name);
  const fws = profile.frameworks
    .filter((f) => f.category !== "test" && f.category !== "build")
    .slice(0, 4)
    .map((f) => f.name);
  const pm = profile.packageManagers[0]?.name;
  const parts = [];
  if (langs.length) parts.push(langs.join(", "));
  if (fws.length) parts.push(fws.join(" + "));
  if (pm) parts.push(`${pm}`);
  return parts.join(" · ") || "Unknown stack";
}

/**
 * @param {ProjectProfile} profile
 * @param {AgentMeta[]} [agents]
 * @returns {string}
 */
export function renderRootClaudeMd(profile, agents = []) {
  const name = profile.root.split("/").pop() || "project";
  const domains = profile.architecture.domains;
  const domainMap =
    domains.length > 0
      ? domains
          .slice(0, DOMAIN_LIMIT)
          .map((d) => `- \`${d.path}/\` — ${d.role}`)
          .join("\n")
      : "- _Single-tree project; no sub-domains detected._";

  const skills = skillsBlock(profile);
  const agentsWorkflow = agentsWorkflowBlock(agents);
  const t = profile.testing;
  const testingNote =
    t && !t.configured && t.recommended
      ? `\n> Sem testes unitários ainda — recomendado: **${t.recommended}**. Rode \`/setup-testing\` para semear.\n`
      : "";

  const isPhp =
    profile.packageManagers.some((pm) => pm.ecosystem === "php") ||
    profile.languages.some((l) => l.name === "PHP" && l.type === "programming");
  const hasPhpstan = isPhp && (profile.commands.typecheck ?? "").includes("phpstan");
  const phpDevToolsNote =
    isPhp && !hasPhpstan
      ? `\n> **PHP dev tools** usadas pelo agente \`php-reviewer\` e pelo hook \`phpstan-on-edit\` são pacotes Composer (não distribuídos pelo harness). Instale se ausentes:\n> \`composer require --dev phpstan/phpstan laravel/pint phpunit/phpunit\`\n`
      : "";

  const engineeringRules = [...ROOT_FIXED_RULES, codeReviewRule(agents)];

  return `# ${name}

> Project memory for Claude Code. Keep this file short and high-signal —
> bloated memory gets ignored. Put hard guarantees in hooks, not prose.

## Stack
${stackLine(profile)}

Architecture: **${profile.architecture.style}**${
    profile.monorepo.isMonorepo ? ` (monorepo via ${profile.monorepo.tool})` : ""
  }.

## Canonical commands
Always use these exact commands (do not guess):

${commandsBlock(profile.commands)}
${testingNote}${phpDevToolsNote}${skills ? `\n${skills}` : ""}${agentsWorkflow ? `\n${agentsWorkflow}` : ""}
## Architecture map
<!-- AI-ENRICH: analyze file tree and key source dirs, describe module responsibilities and relationships, replace this section -->

Domain-specific guidance lives in nested CLAUDE.md files (loaded on demand):

${domainMap}

## Conventions
<!-- AI-ENRICH: detect project-specific patterns from source files; replace the placeholder below with 4-7 concrete, project-specific conventions. Leave the "## Engineering rules" section untouched — those are fixed and must survive enrichment. -->

- _Project-specific conventions are added here during \`/aia-harness:init\` enrichment._

${fixedRulesBlock("Engineering rules", engineeringRules)}
@.claude/memory/INSTRUCTIONS.md
@.claude/memory/MEMORY.md
<!-- Generated by aia-harness. Edit freely; re-run /aia-harness:doctor to audit. -->
`;
}

/**
 * @param {ProjectProfile} profile
 * @param {DomainInfo} domain
 * @returns {string}
 */
export function renderDomainClaudeMd(profile, domain) {
  return `# ${domain.path}

Scope: ${domain.role} (${domain.kind}).

## Responsibility
<!-- AI-ENRICH: from the real files in ${domain.path}/, state in 2-4 sentences what concretely belongs here and what does NOT (where that other code lives). Replace this comment and the line below. -->
The ${domain.role}.

## Local conventions
<!-- AI-ENRICH: 2-5 conventions actually observed in ${domain.path}/ (naming, base classes, error handling, file layout). Replace the placeholder below with concrete, directory-specific ones. Leave the "## Rules" section untouched — those are fixed. -->

- _Directory-specific conventions are added here during \`/aia-harness:init\` enrichment._

${fixedRulesBlock("Rules", DOMAIN_FIXED_RULES)}
<!-- Generated by aia-harness for domain \`${domain.path}\`. -->
`;
}
