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
import { agentsWorkflowBlock } from "./claude-md-agents.mjs";

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
 * BEHAVIORAL_MARKER) placed right after the intro blockquote, before
 * `## Stack` — first thing the agent reads after the title. Deliberately
 * compact — CLAUDE.md loads every session, so each principle is one dense
 * bullet, not a subsection.
 */
export const BEHAVIORAL_GUIDELINES_BLOCK = `## Behavioral guidelines
${BEHAVIORAL_MARKER}

1. **Think before coding** — state assumptions explicitly; if multiple interpretations exist, present them instead of picking silently; say so when a simpler approach exists; if something is unclear, stop and ask.
2. **Simplicity first** — minimum code that solves the problem. No speculative features, no abstractions for single-use code, no unrequested configurability, no error handling for impossible scenarios. If 200 lines could be 50, rewrite.
3. **Surgical changes** — touch only what the request requires; match existing style; don't refactor, reformat, or "improve" adjacent code. Remove orphans *your* change created; leave pre-existing dead code alone (mention it, don't delete it). Every changed line should trace directly to the user's request.
4. **Goal-driven execution** — turn tasks into verifiable goals ("fix the bug" → "write a test that reproduces it, then make it pass"). For multi-step work, state a brief plan with a verify check per step, then loop until verified.
5. **Main session = orchestrator — it does not implement.** Plan, decide, coordinate; ALL delegable implementation and analysis goes to a specialist subagent via \`Agent\`, parallel when scopes don't conflict.
6. **Write to ASD-STE100.** Put every text you produce — reply, subagent prompt, commit, PR, doc, memory — in Simplified Technical English, and apply the same rules to Portuguese. Lead with the result. Use one term per concept and one meaning per term. Keep an instruction to 20 words and a description to 25. Keep a paragraph to 6 sentences. Write one instruction per sentence, in the imperative, in the active voice and in a simple tense. Put the action in the verb, not in a noun ("validate", not "do the validation"). Give the command before the risk in a warning. Break complex text into a vertical list. Cut preamble, flourish, repetition and recap — but never to the point where a sentence gains a second reading.
`;

/**
 * Sentinel comment marking the lean-delivery section. Like BEHAVIORAL_MARKER,
 * it is not an AI-ENRICH comment so enrichment leaves it intact. `doctor` greps
 * for `aia-harness:lean-delivery` to confirm the block survived a prior
 * enrichment pass.
 */
export const LEAN_DELIVERY_MARKER =
  "<!-- aia-harness:lean-delivery — non-negotiable; do not edit, reorder, or remove during enrichment -->";

/**
 * Lean-delivery rule shipped in every generated root CLAUDE.md: plans specify
 * instead of implementing, the task gate is its scoped tests, and review runs
 * once per finished issue instead of per task. Lives in its own
 * `## Lean delivery — plan, execution and review` section (guarded by
 * LEAN_DELIVERY_MARKER) right after the behavioral guidelines, before
 * `## Stack`. Rendered unconditionally — it governs plans and execution
 * whether or not specialist agents are installed.
 */
export const LEAN_DELIVERY_BLOCK = `## Lean delivery — plan, execution and review
${LEAN_DELIVERY_MARKER}

Applies to every plan (\`superpowers:writing-plans\`, \`/plan\`, planner agents) and every execution (\`superpowers:subagent-driven-development\` in waves, \`/orchestrate\`). On conflict with a skill, rule or agent description, this section wins.

- **A plan specifies; it does not implement.** Per task: \`Files:\` and \`Depends-on:\` (parallel waves), the contract or signature, the rules and business rules that apply (by name), and the test cases. Write code only where the exact form is the requirement: money math, API contract, migration, locking query.
- **A task is a cohesive slice for one specialist, with its own tests** (schema + migration; service + tests; route + contract + tests). No micro-tasks; aim for at most 8. An acceptance criterion is not a task: point to the test that proves it.
- **Out of the plan:** review tasks, final-gate tasks, criteria-matrix tasks (they are pipeline steps), "validate data" apart from the test, scenario simulation in rounds, repeated dry-runs, waits of hours or days, and manual user actions. Simulate only a critical money or security scenario that no automated test covers: one run, inside the task that implements it.
- **What only production can confirm** (real data, a window of days, a manual check) is a criterion marked \`(post-deploy)\`. It becomes one "Post-deploy follow-up" item in the PR body. It is not a task. It never blocks the merge or the issue closing: the PR keeps \`Closes #n\`.
- **Review once per finished issue or sub-issue:** the project's code-review flow (\`/code-review\`, with its own internal rounds) and, on the PR, its normal loop. Never per task, wave or plan phase. No per-task reviewer (not even for money or auth), no fix-and-re-review rounds, and no separate final review from the execution skill. The task gate is its scoped tests passing; if they fail, the same specialist fixes them (2 attempts at most), then escalate. Fix P0/P1 findings directly; minor findings follow the review flow's own severity cut, with no extra round.
- **Implementers are the project's specialist agents with an explicit \`model\`:** \`sonnet\`, or \`haiku\` for docs, config and mechanical edits with a complete spec. Never \`opus\`.
- **Docs and config have no plan:** dispatch directly to a Haiku or Sonnet agent.
- **Status to the user:** 1 line per milestone, not task by task.
`;

/**
 * Non-negotiable baseline rules embedded in every generated root CLAUDE.md.
 * They live in their own `## Engineering rules` section (guarded by
 * FIXED_RULES_MARKER) instead of `## Conventions`, because enrichment rewrites
 * `## Conventions` with project-specific rules and would otherwise strip them.
 */
export const ROOT_FIXED_RULES = [
  "Match the style of surrounding code; do not introduce new patterns unprompted.",
  "Test what can break — business rules, branching logic, money/security/auth, bug regressions; skip trivial getters, wrappers, config, presentational UI (rubric: `.claude/rules/05-testing.md`).",
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

${BEHAVIORAL_GUIDELINES_BLOCK}
${LEAN_DELIVERY_BLOCK}
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
<!-- AI-ENRICH: detect project-specific patterns from source files; replace the placeholder below with 4-7 concrete, project-specific conventions. Keep each convention to 1-2 lines; if one needs more detail, move the detail to a path-scoped rule in .claude/rules/ (paths: frontmatter) and keep a one-line pointer here — CLAUDE.md loads every session, rules load lazily. Leave the "## Behavioral guidelines", "## Lean delivery" and "## Engineering rules" sections untouched — those are fixed and must survive enrichment. -->

- _Project-specific conventions are added here during \`/aia-harness:init\` enrichment._

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
