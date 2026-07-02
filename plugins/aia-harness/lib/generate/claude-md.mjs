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
 * Marker comment placed in the superpowers-bridge subsection so `/doctor` and
 * `/scan` can detect a root CLAUDE.md that predates the bridge (whole-file drift
 * is unreliable — enrichment always makes CLAUDE.md differ).
 */
export const AGENT_ROUTING_MARKER =
  "<!-- aia-harness:agent-routing — superpowers→specialist bridge; do not remove -->";

/**
 * Sentinel comment marking the behavioral guidelines section. Like
 * FIXED_RULES_MARKER, it is not an AI-ENRICH comment so enrichment leaves it
 * intact. `doctor` greps for `aia-harness:behavioral` to confirm the block
 * survived a prior enrichment pass.
 */
export const BEHAVIORAL_MARKER =
  "<!-- aia-harness:behavioral — non-negotiable; do not edit, reorder, or remove during enrichment -->";

/**
 * Behavioral guidelines shipped in every generated root CLAUDE.md.
 * Lives in its own `## Behavioral guidelines` section (guarded by
 * BEHAVIORAL_MARKER) placed between `## Conventions` and `## Engineering rules`
 * so it is distinct from project-specific conventions (enrichable) and from
 * technical non-negotiables.
 */
export const BEHAVIORAL_GUIDELINES_BLOCK = `## Behavioral guidelines
${BEHAVIORAL_MARKER}

### 1. Think Before Coding

**Don't assume. Don't hide confusion. Surface tradeoffs.**

Before implementing:

- State your assumptions explicitly. If uncertain, ask.
- If multiple interpretations exist, present them - don't pick silently.
- If a simpler approach exists, say so. Push back when warranted.
- If something is unclear, stop. Name what's confusing. Ask.

### 2. Simplicity First

**Minimum code that solves the problem. Nothing speculative.**

- No features beyond what was asked.
- No abstractions for single-use code.
- No "flexibility" or "configurability" that wasn't requested.
- No error handling for impossible scenarios.
- If you write 200 lines and it could be 50, rewrite it.

Ask yourself: "Would a senior engineer say this is overcomplicated?" If yes, simplify.

### 3. Surgical Changes

**Touch only what you must. Clean up only your own mess.**

When editing existing code:

- Don't "improve" adjacent code, comments, or formatting.
- Don't refactor things that aren't broken.
- Match existing style, even if you'd do it differently.
- If you notice unrelated dead code, mention it - don't delete it.

When your changes create orphans:

- Remove imports/variables/functions that YOUR changes made unused.
- Don't remove pre-existing dead code unless asked.

The test: Every changed line should trace directly to the user's request.

### 4. Goal-Driven Execution

**Define success criteria. Loop until verified.**

Transform tasks into verifiable goals:

- "Add validation" → "Write tests for invalid inputs, then make them pass"
- "Fix the bug" → "Write a test that reproduces it, then make it pass"
- "Refactor X" → "Ensure tests pass before and after"

For multi-step tasks, state a brief plan:

\`\`\`
1. [Step] → verify: [check]
2. [Step] → verify: [check]
3. [Step] → verify: [check]
\`\`\`

Strong success criteria let you loop independently. Weak criteria ("make it work") require constant clarification.
`;

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
  return `When performing a code review (user requests it or a workflow triggers it), always use ${named}, applying the \`uncle-bob-craft\` skill's criteria (Dependency Rule, SOLID in context, code smells) alongside their findings.`;
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
  const lines = rows.filter(([, v]) => v).map(([k, v]) => `- **${k}:** \`${v}\``);
  return lines.length > 0
    ? lines.join("\n")
    : "- _No canonical commands detected — fill these in._";
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
  return `## Skills — for this stack\n\n> Invoke the matching skill before working in its domain.\n\n${lines.join("\n")}\n`;
}

/**
 * Coarse routing role for an agent name, used to build the superpowers bridge.
 * Returns null for agents that don't map to a generic superpowers role.
 * @param {string} name
 * @returns {{ role: string, superpowersGeneric: string } | null}
 */
export function routingRole(name) {
  if (name.endsWith("-build-resolver"))
    return { role: "Fix a failing build", superpowersGeneric: "general-purpose" };
  if (name.endsWith("-reviewer"))
    return { role: "Review / audit changed code", superpowersGeneric: "general-purpose" };
  /** @type {Record<string,string>} */
  const exact = {
    "backend-specialist": "Backend / API / server-side / domain logic",
    "frontend-specialist": "UI / components / styling / pages",
    "database-architect": "Schema / migration / query / data modeling",
    "test-engineer": "Unit / integration tests",
    "qa-automation-engineer": "E2E / QA automation",
    debugger: "Bug / crash / root-cause analysis",
    "explorer-agent": "Explore / map an unfamiliar codebase",
    "code-archaeologist": "Understand legacy code before changing it",
    orchestrator: "Multi-domain feature — subdelegates to specialists",
    "performance-optimizer": "Performance profiling / optimization",
    "devops-engineer": "Deploy / CI/CD / infra",
    "security-auditor": "Security audit / defensive review",
    "penetration-tester": "Offensive security / pentest",
    "mobile-developer": "Mobile (React Native / Flutter)",
    "documentation-writer": "Documentation (only when explicitly requested)",
  };
  return exact[name] ? { role: exact[name], superpowersGeneric: "general-purpose" } : null;
}

/** Priority order for the agents table — most-used roles first. */
const AGENT_ORDER = [
  "orchestrator",
  "code-reviewer",
  "security-reviewer",
  "go-reviewer",
  "rust-reviewer",
  "typescript-reviewer",
  "react-reviewer",
  "vue-reviewer",
  "java-reviewer",
  "kotlin-reviewer",
  "php-reviewer",
  "python-reviewer",
  "django-reviewer",
  "fastapi-reviewer",
  "csharp-reviewer",
  "cpp-reviewer",
  "flutter-reviewer",
  "go-build-resolver",
  "rust-build-resolver",
  "react-build-resolver",
  "java-build-resolver",
  "kotlin-build-resolver",
  "django-build-resolver",
  "dart-build-resolver",
  "cpp-build-resolver",
  "qa-automation-engineer",
  "test-engineer",
  "database-architect",
  "devops-engineer",
  "backend-specialist",
  "frontend-specialist",
  "seo-specialist",
  "mobile-developer",
  "game-developer",
  "performance-optimizer",
  "product-manager",
  "product-owner",
  "project-planner",
  "code-archaeologist",
  "debugger",
  "explorer-agent",
  "documentation-writer",
  "penetration-tester",
  "security-auditor",
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

  // Group agents by unique role label; preserve first appearance order
  /** @type {Map<string, string[]>} */
  const roleToAgents = new Map();
  sorted.forEach((a) => {
    const r = routingRole(a.name);
    if (r) {
      if (!roleToAgents.has(r.role)) {
        roleToAgents.set(r.role, []);
      }
      const agents = roleToAgents.get(r.role);
      if (agents) agents.push(a.name);
    }
  });

  const bridgeRows = Array.from(roleToAgents.entries())
    .map(([role, names]) => `| ${role} | ${names.map((n) => `\`${n}\``).join(" / ")} |`)
    .join("\n");

  const bridge = bridgeRows
    ? `
### Superpowers → Project Specialists (mandatory bridging)
${AGENT_ROUTING_MARKER}

Superpowers skills (\`dispatching-parallel-agents\`, \`subagent-driven-development\`,
\`executing-plans\`, \`systematic-debugging\`) show \`general-purpose\` as the default
\`subagent_type\` in their examples. **Never dispatch \`general-purpose\` (or a generic
implementer) when a specialist below covers the domain** — pass the specialist's exact
name as \`subagent_type\` instead.

> Basis: superpowers itself states "User's explicit instructions (CLAUDE.md) — highest
> priority." This section applies that priority over the agent types its examples suggest.
> The normal flow is unchanged (brainstorming → writing-plans → subagent-driven-development);
> only the dispatched \`subagent_type\` changes.

| When superpowers would use \`general-purpose\` for… | Dispatch instead |
|---|---|
${bridgeRows}
`
    : "";

  return `## Workflow & Agents

For every non-trivial implementation: invoke \`superpowers:subagent-driven-development\`.
When dispatching subagents, you MUST use the matching specialist agent from the table below — never the generic agent when a specialist is listed. Cross-reference the task type with the "When to use" column and pass the exact name as \`subagent_type\`.

| Agent | When to use |
|---|---|
${rows}
${bridge}`;
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
      ? `\n> No unit tests yet — recommended: **${t.recommended}**. Run \`/setup-testing\` to seed them.\n`
      : "";

  const isPhp =
    profile.packageManagers.some((pm) => pm.ecosystem === "php") ||
    profile.languages.some((l) => l.name === "PHP" && l.type === "programming");
  const hasPhpstan = isPhp && (profile.commands.typecheck ?? "").includes("phpstan");
  const phpDevToolsNote =
    isPhp && !hasPhpstan
      ? `\n> **PHP dev tools** used by the \`php-reviewer\` agent and \`phpstan-on-edit\` hook are Composer packages (not distributed by the harness). Install if missing:\n> \`composer require --dev phpstan/phpstan laravel/pint phpunit/phpunit\`\n`
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
<!-- AI-ENRICH: detect project-specific patterns from source files; replace the placeholder below with 4-7 concrete, project-specific conventions. Leave the "## Behavioral guidelines" and "## Engineering rules" sections untouched — those are fixed and must survive enrichment. -->

- _Project-specific conventions are added here during \`/aia-harness:init\` enrichment._

${BEHAVIORAL_GUIDELINES_BLOCK}
${fixedRulesBlock("Engineering rules", engineeringRules)}
@.claude/memory/INSTRUCTIONS.md
@.claude/memory/MEMORY.md
<!-- Generated by aia-harness. Edit freely; re-run /aia-harness:doctor to audit. -->
`;
}

/**
 * @param {ProjectProfile} _profile
 * @param {DomainInfo} domain
 * @returns {string}
 */
export function renderDomainClaudeMd(_profile, domain) {
  return `# ${domain.path}

Scope: ${domain.role} (${domain.kind}).

## Responsibility
<!-- AI-ENRICH: Read the real files in ${domain.path}/. State in 2-4 sentences what concretely
     belongs here and what does NOT (where that other code lives). Replace this comment and the line below. -->
The ${domain.role}.

## Key patterns
<!-- AI-ENRICH: Read 3-6 key source files in ${domain.path}/. Extract concrete patterns:
     specific class names, DI tokens, naming conventions, error handling patterns, method names.
     Derive from real code only — no generic advice. Replace comment and placeholder. -->

- _Key patterns are added here during enrichment._

## Applied rules
<!-- AI-ENRICH: Read .claude/rules/ (and all subdirs — ecc/, stack/, etc). List rules relevant
     to ${domain.path}/ as @-references with a 1-2 sentence condensed summary of what matters
     HERE specifically. Format: \`- @.claude/rules/X.md — summary\`.
     Omit generic rules with no domain-specific relevance. Replace comment and placeholder. -->

- _Applicable rules are added here during enrichment._

## Local conventions
<!-- AI-ENRICH: 2-5 conventions actually observed in ${domain.path}/ files (naming, base classes,
     error handling, file layout). Replace the placeholder below. Leave the "## Rules" section untouched. -->

- _Directory-specific conventions are added here during \`/aia-harness:revise-claude-md\` enrichment._

${fixedRulesBlock("Rules", DOMAIN_FIXED_RULES)}
<!-- Generated by aia-harness for domain \`${domain.path}\`. Re-run /aia-harness:revise-claude-md to enrich. -->
`;
}
