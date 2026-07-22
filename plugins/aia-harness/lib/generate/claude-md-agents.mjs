/**
 * Renders the "## Workflow & Agents" section of the generated root CLAUDE.md:
 * the specialist-agent routing table plus the superpowers→specialist bridge.
 * Split from claude-md.mjs so each module keeps a single rendering concern.
 *
 * @module generate/claude-md-agents
 */

/** @typedef {{ name: string, whenToUse: string }} AgentMeta */

/**
 * Marker comment placed in the superpowers-bridge subsection so `/doctor` and
 * `/scan` can detect a root CLAUDE.md that predates the bridge (whole-file drift
 * is unreliable — enrichment always makes CLAUDE.md differ).
 */
export const AGENT_ROUTING_MARKER =
  "<!-- aia-harness:agent-routing — superpowers→specialist bridge; do not remove -->";

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

Superpowers skills (\`superpowers:dispatching-parallel-agents\`, \`superpowers:subagent-driven-development\`,
\`superpowers:executing-plans\`, \`superpowers:systematic-debugging\`) show \`general-purpose\` as the default
\`subagent_type\` in their examples. **Never dispatch \`general-purpose\` (or a generic
implementer) when a specialist below covers the domain** — pass the specialist's exact
name as \`subagent_type\` instead.

> Basis: superpowers itself states "User's explicit instructions (CLAUDE.md) — highest
> priority." This section applies that priority over the agent types its examples suggest.
> The normal flow is unchanged (\`superpowers:brainstorming\` → \`superpowers:writing-plans\` → \`superpowers:subagent-driven-development\`);
> only the dispatched \`subagent_type\` changes.

| When superpowers would use \`general-purpose\` for… | Dispatch instead |
|---|---|
${bridgeRows}
`
    : "";

  return `## Workflow & Agents

Invoke \`superpowers:subagent-driven-development\` for **non-trivial** implementation — trigger it when the request meets **≥2** of:
- touches **3+ files** or **2+ domains/layers** (UI + agent, API + DB…)
- is a **new feature / epic / cross-cutting refactor** (not a one-line or single-function change)
- needs a **multi-step plan** or ordered tasks, each with its own verification
- has **unclear scope or root cause** and needs exploration before coding

Skip it — implement inline — for typo/copy fixes, single-function edits, config tweaks, or one-file bugs with an obvious cause.

When dispatching subagents, you MUST use the matching specialist agent from the table below — never the generic agent when a specialist is listed. Cross-reference the task type with the "When to use" column and pass the exact name as \`subagent_type\`.

Model dispatch: an agent's frontmatter \`model\` wins; a generic dispatch or a project/user agent with no \`model\` in frontmatter is force-set to \`sonnet\` by a PreToolUse hook, so it never silently inherits this session's model — except namespaced plugin agents (\`plugin:name\`), left unrewritten since their frontmatter isn't reliably hook-resolvable. Pass \`model\` explicitly yourself for those, or to override for complex work: \`haiku\` for search/exploration, \`sonnet\` for implementation, \`opus\` for architectural judgment — cheapest tier that fits.

| Agent | When to use |
|---|---|
${rows}
${bridge}`;
}
