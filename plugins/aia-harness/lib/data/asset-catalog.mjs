/**
 * Barrel — the single import surface for everything aia-harness distributes
 * into a target project. The rest of the engine (plan.mjs) imports from HERE,
 * not from the individual source catalogs, so there is one centralized place
 * to discover what ships and a stable boundary if a source module moves.
 *
 * Sources (one module per provenance):
 *  ┌────────────────────┬──────────────┬──────────────────────┬─────────────────┐
 *  │ module             │ source       │ license/owner        │ templates dir   │
 *  ├────────────────────┼──────────────┼──────────────────────┼─────────────────┤
 *  │ ecc-catalog.mjs    │ ECC          │ MIT © Affaan Mustafa │ templates/ecc/  │
 *  │ agkit-catalog.mjs  │ ag-kit       │ MIT © vudovn         │ templates/ag-kit│
 *  │ project-catalog.mjs│ first-party  │ ours                 │ templates/skills│
 *  │                    │              │                      │ + templates/hooks│
 *  │ tools-catalog.mjs  │ tools        │ various (vendored)   │ templates/tools/│
 *  └────────────────────┴──────────────┴──────────────────────┴─────────────────┘
 *
 * stack-keys.mjs holds the pure profile→stack-key resolver shared by the
 * stack-specific catalogs.
 *
 * @module data/asset-catalog
 */

export { stackKeys } from "./stack-keys.mjs";

// ECC (MIT © Affaan Mustafa) — templates/ecc/
export {
  ECC_COMMON,
  ECC_BY_STACK,
  ECC_AGENT_WHEN_TO_USE,
  selectEccAssets,
  allEccAssets,
} from "./ecc-catalog.mjs";

// ag-kit (MIT © vudovn) — templates/ag-kit/
export {
  AGKIT_COMMON,
  AGKIT_BY_STACK,
  AGKIT_AGENT_WHEN_TO_USE,
  selectAgkitAssets,
  allAgkitAssets,
} from "./agkit-catalog.mjs";

import { ECC_AGENT_WHEN_TO_USE } from "./ecc-catalog.mjs";
import { AGKIT_AGENT_WHEN_TO_USE } from "./agkit-catalog.mjs";
import { PROJECT_AGENT_WHEN_TO_USE } from "./project-catalog.mjs";

/**
 * Canonical best-practice description for an agent, or null if not catalogued.
 * Single source of truth for BOTH the native-router frontmatter and the
 * CLAUDE.md routing table.
 * @param {string} name
 * @returns {string | null}
 */
export function resolveCanonicalDescription(name) {
  return (
    ECC_AGENT_WHEN_TO_USE[name] ??
    AGKIT_AGENT_WHEN_TO_USE[name] ??
    PROJECT_AGENT_WHEN_TO_USE[name] ??
    null
  );
}

/**
 * Resolve a "when to use" label for the CLAUDE.md table; falls back to the bare
 * name if the agent is not catalogued.
 * @param {string} name
 * @returns {string}
 */
export function resolveAgentWhenToUse(name) {
  return resolveCanonicalDescription(name) ?? name;
}

// First-party (ours) — templates/skills/ + templates/hooks/ + templates/agents/
export {
  PROJECT_COMMON,
  PROJECT_BY_STACK,
  PROJECT_HOOK_FILES,
  PROJECT_HOOK_BY_STACK,
  PROJECT_AGENT_WHEN_TO_USE,
  selectProjectAssets,
  selectProjectHooks,
  allProjectAssets,
} from "./project-catalog.mjs";

// Tools (vendored third-party + local) — templates/tools/. Structurally
// different (ToolDef + machine deps + settings-hook wiring), but re-exported
// here so plan.mjs has a single asset import.
export {
  TOOLS,
  getTool,
  selectTools,
  toolSettingsHooks,
  vendorHookCommand,
} from "./tools-catalog.mjs";

// GitHub PM (first-party + vendored) — templates/skills/github-pm/ + templates/github/ + templates/github-pm-ext/
export { selectGitHubPMAssets } from "./github-pm-catalog.mjs";
