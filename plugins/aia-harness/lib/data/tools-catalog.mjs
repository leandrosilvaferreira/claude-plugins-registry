/**
 * Catalog of project-level installable tools (token-economy + code-graph).
 * Single source of truth for the sync script (what to vendor), the planner
 * (vendor copies + settings hooks), and the add-tools command (machine deps).
 *
 * Strategies:
 *  - "vendor"    : files copied into the target `.claude/` + hooks wired in settings.json
 *  - "hook-wire" : only a settings.json hook is written (binary is a machine dep)
 *  - "cli"       : installed/configured by a CLI at project scope (machine dep)
 *
 * @module data/tools-catalog
 */

/** @typedef {import('../profile.mjs').ProjectProfile} ProjectProfile */

/**
 * @typedef {Object} ToolHook
 * @property {"SessionStart"|"UserPromptSubmit"|"PreToolUse"|"PostToolUse"|"Stop"} event
 * @property {string} [matcher]  Tool matcher (PreToolUse/PostToolUse).
 * @property {string} [script]   Vendored hook script relative to `.claude/hooks/` (vendor tools).
 * @property {string} [command]  Raw command string for hook-wire tools only (legacy shell-form).
 * @property {number} [timeout]
 */

/**
 * @typedef {Object} ToolDef
 * @property {string} id
 * @property {string} name
 * @property {"token-economy"|"code-graph"|"workflow"} category
 * @property {"vendor"|"hook-wire"|"cli"} strategy
 * @property {string} license
 * @property {string} repo
 * @property {string[]} deps          e.g. "node", "binary:rtk", "uv"
 * @property {ToolHook[]} hooks       Settings-hook entries to wire.
 * @property {(p: ProjectProfile) => boolean} recommended
 */

const HOOK_DIR = "${CLAUDE_PROJECT_DIR}/.claude/hooks";

/**
 * Exec-form object for a vendored JS hook (no shell required).
 * Spread into the hook entry: { type: "command", ...vendorHookCommand(rel), timeout }.
 * @param {string} rel  Path under `.claude/hooks/`, e.g. "caveman/caveman-activate.js".
 * @returns {{ command: string, args: string[] }}
 */
export function vendorHookCommand(rel) {
  return { command: "node", args: [`${HOOK_DIR}/${rel}`] };
}

/** @type {ToolDef[]} */
export const TOOLS = [
  {
    id: "caveman",
    name: "Caveman",
    category: "token-economy",
    strategy: "vendor",
    license: "MIT",
    repo: "JuliusBrussee/caveman",
    deps: ["node"],
    hooks: [
      { event: "SessionStart", script: "caveman/caveman-activate.js", timeout: 10 },
      { event: "UserPromptSubmit", script: "caveman/caveman-mode-tracker.js", timeout: 10 },
    ],
    recommended: () => true,
  },
  {
    id: "ponytail",
    name: "Ponytail",
    category: "token-economy",
    strategy: "vendor",
    license: "MIT",
    repo: "DietrichGebert/ponytail",
    deps: ["node"],
    hooks: [
      { event: "SessionStart", script: "ponytail/ponytail-activate.js", timeout: 10 },
      { event: "UserPromptSubmit", script: "ponytail/ponytail-mode-tracker.js", timeout: 10 },
    ],
    recommended: () => true,
  },
  {
    id: "rtk",
    name: "rtk (Rust Token Killer)",
    category: "token-economy",
    strategy: "vendor",
    license: "Apache-2.0",
    repo: "rtk-ai/rtk",
    deps: ["binary:rtk"],
    hooks: [{ event: "PreToolUse", matcher: "Bash", script: "rtk-hook.mjs", timeout: 15 }],
    recommended: () => true,
  },
  {
    id: "graphify",
    name: "Graphify",
    category: "code-graph",
    strategy: "cli",
    license: "MIT",
    repo: "safishamsi/graphify",
    deps: ["uv"],
    hooks: [],
    recommended: (p) => p.primaryLanguage != null,
  },
  {
    id: "claude-code-worktrees",
    name: "Claude Code Worktrees (skill)",
    category: "workflow",
    strategy: "vendor",
    license: "user-authored",
    repo: "local",
    deps: [],
    hooks: [],
    recommended: () => true,
  },
];

/**
 * @param {string} id
 * @returns {ToolDef|undefined}
 */
export function getTool(id) {
  return TOOLS.find((t) => t.id === id);
}

/**
 * Tools recommended for a profile.
 * @param {ProjectProfile} profile
 * @returns {ToolDef[]}
 */
export function selectTools(profile) {
  return TOOLS.filter((t) => t.recommended(profile));
}

/**
 * Build settings.json hook fragments for the given tool ids (vendor + hook-wire
 * tools only; "cli" tools wire themselves).
 * @param {string[]} toolIds
 * @returns {Record<string, { matcher?: string, hooks: { type: "command", command: string, args?: string[], timeout: number }[] }[]>}
 */
export function toolSettingsHooks(toolIds) {
  /** @type {Record<string, { matcher?: string, hooks: { type: "command", command: string, args?: string[], timeout: number }[] }[]>} */
  const out = {};
  for (const id of toolIds) {
    const tool = getTool(id);
    if (!tool || tool.strategy === "cli") continue;
    for (const h of tool.hooks) {
      const cmdValue = h.command ?? (h.script ? vendorHookCommand(h.script) : null);
      if (!cmdValue) continue;
      const hookBase = typeof cmdValue === "string"
        ? { type: /** @type {const} */ ("command"), command: cmdValue }
        : { type: /** @type {const} */ ("command"), ...cmdValue };
      const entry = h.matcher
        ? { matcher: h.matcher, hooks: [{ ...hookBase, timeout: h.timeout ?? 30 }] }
        : { hooks: [{ ...hookBase, timeout: h.timeout ?? 30 }] };
      (out[h.event] ??= []).push(entry);
    }
  }
  return out;
}
