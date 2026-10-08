/**
 * Model + reasoning-effort profile of a catalogued agent, and the helper that stamps it
 * onto parsed frontmatter entries. The values live in the `*_AGENT_MODEL` maps of the
 * provenance catalogs (see asset-catalog.mjs). Pure — no IO.
 *
 * @module validate/agent-model
 */
import { resolveAgentModel } from "../data/asset-catalog.mjs";

/** @typedef {{ model: "haiku" | "sonnet" | "opus", effort: "low" | "medium" | "high" | "xhigh" | "max" }} AgentModelProfile */

/**
 * Stamp the catalogued `model` and `effort` onto frontmatter entries: drop any existing
 * `model`/`effort` entry, then append `model` followed by `effort`. Returns `entries`
 * unchanged when the agent is not catalogued, so an unknown agent keeps its own model.
 * @param {{ key: string, value: string }[]} entries
 * @param {string} name
 * @returns {{ key: string, value: string }[]}
 */
export function applyAgentModel(entries, name) {
  const profile = resolveAgentModel(name);
  if (!profile) return entries;
  return [
    ...entries.filter((e) => e.key !== "model" && e.key !== "effort"),
    { key: "model", value: profile.model },
    { key: "effort", value: profile.effort },
  ];
}
