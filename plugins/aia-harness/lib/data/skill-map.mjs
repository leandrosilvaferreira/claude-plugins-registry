/**
 * Static mapping: detected stack → recommended skills to inject into CLAUDE.md.
 * Pure module — no IO, no side effects.
 *
 * @module data/skill-map
 */

/** @typedef {import('../profile.mjs').ProjectProfile} ProjectProfile */

/**
 * @typedef {Object} SkillEntry
 * @property {string} label       Display name shown in CLAUDE.md (e.g. "Next.js")
 * @property {string} skill       Skill identifier used as `/skill` invocation (e.g. "vercel:nextjs")
 * @property {string} description One-line hint for when to invoke the skill
 */

/**
 * Returns the ordered, deduplicated list of skill entries for a given profile.
 * Rules evaluated top-to-bottom; a skill is never added twice.
 *
 * @param {ProjectProfile} profile
 * @returns {SkillEntry[]}
 */
export function skillsForProfile(profile) {
  const fw = new Set(profile.frameworks.map((f) => f.name));
  const lang = profile.primaryLanguage ?? "";

  /** @type {SkillEntry[]} */
  const entries = [];
  const seen = new Set();

  /** @param {string} label @param {string} skill @param {string} description */
  const add = (label, skill, description) => {
    if (seen.has(skill)) return;
    seen.add(skill);
    entries.push({ label, skill, description });
  };

  // --- Framework rules (evaluated in priority order) ---
  if (fw.has("Next.js")) {
    add("Next.js", "vercel:nextjs", "routing, SSR/SSG, cache, middleware");
    add("UI/UX", "ui-ux-pro-max", "component design, accessibility, UX");
  }
  if (fw.has("Nuxt")) {
    add("Nuxt", "vercel:nuxt", "pages, composables, server routes");
    add("UI/UX", "ui-ux-pro-max", "component design, accessibility, UX");
  }
  if (fw.has("Vue") && !fw.has("Nuxt")) {
    add("UI/UX", "ui-ux-pro-max", "component design, accessibility, UX");
  }
  if (fw.has("React") && !fw.has("Next.js")) {
    add("React", "vercel:react-best-practices", "components, hooks, performance");
    add("UI/UX", "ui-ux-pro-max", "component design, accessibility, UX");
  }
  if (fw.has("Angular") || fw.has("SvelteKit") || (fw.has("Svelte") && !fw.has("SvelteKit"))) {
    add("UI/UX", "ui-ux-pro-max", "component design, accessibility, UX");
  }
  if (["NestJS", "Express", "Fastify", "Koa", "Hono", "AdonisJS"].some((n) => fw.has(n))) {
    add("Node.js backend", "node", "APIs, middleware, Node modules");
  }
  if (fw.has("Quarkus")) {
    add("Quarkus", "quarkus-patterns", "extensions, CDI, REST endpoints");
    add("Quarkus verify", "quarkus-verification", "configuration validation and native build");
  }
  if (fw.has("Spring Boot"))
    add("Java/Spring", "java-coding-standards", "Java coding patterns for this project");
  if (fw.has("Laravel")) add("UI/UX", "ui-ux-pro-max", "component design, accessibility, UX");
  if (fw.has("Adianti")) add("Adianti", "adianti-framework", "Adianti framework MVC patterns");
  if (fw.has("shadcn/ui")) add("shadcn/ui", "vercel:shadcn", "components, themes, customization");
  if (fw.has("LangChain.js")) add("LangChain", "langchain", "chains, agents, LLM integrations");
  if (fw.has("Remotion")) add("Remotion", "remotion-best-practices", "React video compositions");
  if (fw.has("amqplib") || fw.has("RabbitMQ")) {
    add("RabbitMQ", "rabbitmq-development", "queues, exchanges, consumers");
  }
  if (fw.has("Prisma") || fw.has("node-postgres")) {
    add("PostgreSQL", "postgresql-database-engineering", "migrations, queries, indexes");
  }

  // --- Language rules (fallbacks when no specific framework matched) ---
  if (lang === "Java" && !fw.has("Spring Boot") && !fw.has("Quarkus")) {
    add("Java", "java-coding-standards", "Java coding patterns for this project");
  }
  if (lang === "Go") {
    add("Go style", "golang-code-style", "idioms, formatting, conventions");
    add("Go patterns", "golang-design-patterns", "Go architecture patterns");
    add("Go modernize", "golang-modernize", "modernizing legacy Go code");
  }

  // --- Fallback: JS/TS frontend with no specific UI skill yet ---
  const hasFrontendSkill =
    seen.has("vercel:nextjs") ||
    seen.has("vercel:nuxt") ||
    seen.has("vercel:react-best-practices") ||
    seen.has("ui-ux-pro-max");
  const hasFrontendFramework = profile.frameworks.some((f) => f.category === "frontend");
  if (
    !hasFrontendSkill &&
    hasFrontendFramework &&
    (lang === "TypeScript" || lang === "JavaScript")
  ) {
    add("UI/UX", "ui-ux-pro-max", "component design, accessibility, UX");
  }

  return entries;
}
