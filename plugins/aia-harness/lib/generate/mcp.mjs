/**
 * Generate the project-root `.mcp.json` from the curated catalog.
 * @module generate/mcp
 */
import { MCP_CATALOG, recommendedMcp } from "../data/mcp-catalog.mjs";

/**
 * @param {import('../profile.mjs').ProjectProfile} profile
 * @param {string[]} [selected] Explicit server names; defaults to recommended.
 * @returns {{ content: string, envPlaceholders: string[], names: string[], prereqs: string[] }}
 */
export function renderMcp(profile, selected) {
  const entries = selected
    ? MCP_CATALOG.filter((e) => selected.includes(e.name))
    : recommendedMcp(profile);

  /** @type {Record<string, import('../data/mcp-catalog.mjs').McpServerConfig>} */
  const mcpServers = {};
  /** @type {Set<string>} */
  const env = new Set();
  /** @type {string[]} */
  const prereqs = [];
  for (const e of entries) {
    mcpServers[e.name] = e.server;
    for (const k of e.envPlaceholders ?? []) env.add(k);
    if (e.prereq) prereqs.push(`${e.name}: ${e.prereq}`);
  }

  return {
    content: JSON.stringify({ mcpServers }, null, 2) + "\n",
    envPlaceholders: [...env],
    names: entries.map((e) => e.name),
    prereqs,
  };
}
