/**
 * Curated catalog of strategic MCP servers. Server configs use ${ENV}
 * placeholders only — never resolved secrets.
 *
 * @module data/mcp-catalog
 */

/**
 * @typedef {Object} McpServerConfig
 * @property {"stdio"|"http"|"sse"} type
 * @property {string} [command]
 * @property {string[]} [args]
 * @property {string} [url]
 * @property {Record<string, string>} [env]
 * @property {Record<string, string>} [headers]
 */

/**
 * @typedef {Object} McpEntry
 * @property {string} name
 * @property {string} description
 * @property {string} docsUrl
 * @property {McpServerConfig} server
 * @property {string[]} [envPlaceholders] Env vars the user must set in settings.local.json.
 * @property {string} [prereq]  Machine prerequisite to surface (e.g. a CLI to install).
 * @property {(profile: import('../profile.mjs').ProjectProfile) => boolean} recommended
 */

/** @type {McpEntry[]} */
export const MCP_CATALOG = [
  {
    name: "context7",
    description:
      "Up-to-date, version-accurate documentation for libraries and frameworks (key-free).",
    docsUrl: "https://github.com/upstash/context7",
    // No API key needed: the endpoint is open and a key only raises rate limits.
    // The MCP client sends the required Accept header itself.
    server: { type: "http", url: "https://mcp.context7.com/mcp" },
    recommended: () => true,
  },
  {
    name: "playwright",
    description: "Drive a real browser for end-to-end testing and UI verification.",
    docsUrl: "https://github.com/microsoft/playwright-mcp",
    server: { type: "stdio", command: "npx", args: ["-y", "@playwright/mcp@latest"] },
    recommended: (p) => p.frameworks.some((f) => f.name === "Playwright" || f.name === "Cypress"),
  },
  {
    name: "postgres",
    description: "Inspect schema and run read-only queries against PostgreSQL.",
    docsUrl: "https://github.com/modelcontextprotocol/servers/tree/main/src/postgres",
    server: {
      type: "stdio",
      command: "npx",
      args: ["-y", "@modelcontextprotocol/server-postgres", "${DATABASE_URL}"],
      env: {},
    },
    envPlaceholders: ["DATABASE_URL"],
    recommended: () => false,
  },
  {
    name: "filesystem",
    description: "Scoped filesystem access outside the working directory when needed.",
    docsUrl: "https://github.com/modelcontextprotocol/servers/tree/main/src/filesystem",
    server: {
      type: "stdio",
      command: "npx",
      args: ["-y", "@modelcontextprotocol/server-filesystem", "${CLAUDE_PROJECT_DIR}"],
    },
    recommended: () => false,
  },
  {
    name: "memory",
    description: "Persistent knowledge-graph memory across sessions (key-free).",
    docsUrl: "https://github.com/modelcontextprotocol/servers/tree/main/src/memory",
    server: { type: "stdio", command: "npx", args: ["-y", "@modelcontextprotocol/server-memory"] },
    recommended: () => false,
  },
  {
    name: "parallel-search",
    description: "Citation-backed web search over an HTTP MCP endpoint (key-free).",
    docsUrl: "https://parallel.ai",
    server: { type: "http", url: "https://search.parallel.ai/mcp" },
    recommended: () => false,
  },
  {
    name: "supabase",
    description: "Managed Postgres via Supabase: schema inspection and queries.",
    docsUrl: "https://github.com/supabase-community/supabase-mcp",
    server: {
      type: "stdio",
      command: "npx",
      args: ["-y", "@supabase/mcp-server-supabase@latest"],
      env: { SUPABASE_ACCESS_TOKEN: "${SUPABASE_ACCESS_TOKEN}" },
    },
    envPlaceholders: ["SUPABASE_ACCESS_TOKEN"],
    recommended: () => false,
  },
];

/**
 * Entries recommended for a given profile.
 * @param {import('../profile.mjs').ProjectProfile} profile
 * @returns {McpEntry[]}
 */
export function recommendedMcp(profile) {
  return MCP_CATALOG.filter((e) => e.recommended(profile));
}
