/**
 * Obsidian vault memory pillar — distributable asset catalog.
 * Parallel to github-pm-catalog.mjs — one module per provenance. 100% opt-in:
 * no profile/stack gate, never defaultSelected. Only ever applied when
 * /aia-harness:add-obsidian selects these ids explicitly.
 *
 * @module data/obsidian-catalog
 */
import path from "node:path";
import { fileURLToPath } from "node:url";

const PLUGIN_ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const HOOKS = path.join(PLUGIN_ROOT, "templates", "hooks");
const RULES = path.join(PLUGIN_ROOT, "templates", "rules");
const TOOL_ROOT = path.join(PLUGIN_ROOT, "templates", "tools", "obsidian");

/**
 * @typedef {Object} ObsidianArtifactDef
 * @property {string} id             id prefix "obsidian:" — reserved in patch.md
 * @property {string} description
 * @property {string} copyFrom       absolute path under templates/
 * @property {string} dest           relative path in the target project
 * @property {"merge-section"} [mergeStrategy]
 */

/** @type {ObsidianArtifactDef[]} */
const OBSIDIAN_ARTIFACTS = [
  {
    id: "obsidian:rule",
    description: "Vault usage rule: MCP-only access, write-tool traps, folder structure",
    copyFrom: path.join(RULES, "obsidian.md"),
    dest: ".claude/rules/obsidian.md",
  },
  {
    id: "obsidian:hook:vault-orient",
    description: "UserPromptSubmit hook: reminds to search the vault before answering",
    copyFrom: path.join(HOOKS, "vault-orient.mjs"),
    dest: ".claude/hooks/vault-orient.mjs",
  },
  {
    id: "obsidian:hook:vault-guard",
    description: "PreToolUse hook: denies direct file access to the vault directory",
    copyFrom: path.join(HOOKS, "vault-guard.mjs"),
    dest: ".claude/hooks/vault-guard.mjs",
  },
  {
    id: "obsidian:hook:compile",
    description: "SessionStart hook: promotes yesterday's daily note into the PARA folders",
    copyFrom: path.join(HOOKS, "compile.mjs"),
    dest: ".claude/hooks/compile.mjs",
  },
  {
    id: "obsidian:hook:session-log",
    description: "SessionEnd hook: appends a session summary to today's daily note",
    copyFrom: path.join(HOOKS, "session-log.mjs"),
    dest: ".claude/hooks/session-log.mjs",
  },
  {
    id: "obsidian:hook:vault-note-merge",
    description: "Section-merge helper used by the compile pipeline (no hook contract of its own)",
    copyFrom: path.join(HOOKS, "vault-note-merge.mjs"),
    dest: ".claude/hooks/vault-note-merge.mjs",
  },
  {
    id: "obsidian:hook:vault-pipeline-shared",
    description: "Shared helpers for the compile/session-log hook + runner pairs",
    copyFrom: path.join(HOOKS, "vault-pipeline-shared.mjs"),
    dest: ".claude/hooks/vault-pipeline-shared.mjs",
  },
  {
    id: "obsidian:script:compile-runner",
    description: "Detached worker spawned by compile.mjs to do the real promotion work",
    copyFrom: path.join(TOOL_ROOT, "scripts", "compile-runner.mjs"),
    dest: ".claude/scripts/compile-runner.mjs",
  },
  {
    id: "obsidian:script:session-log-runner",
    description: "Detached worker spawned by session-log.mjs to write the daily note",
    copyFrom: path.join(TOOL_ROOT, "scripts", "session-log-runner.mjs"),
    dest: ".claude/scripts/session-log-runner.mjs",
  },
  {
    id: "obsidian:claude-md",
    description: "CLAUDE.md section wiring the obsidian-vault rule trigger",
    copyFrom: path.join(TOOL_ROOT, "claude-md-section.md"),
    // Root CLAUDE.md — the always-loaded project memory, same target the main
    // harness writes (lib/plan/claude-md-artifacts.mjs). merge-section appends
    // or refreshes only the obsidian-vault section, creating the file if absent.
    dest: "CLAUDE.md",
    mergeStrategy: "merge-section",
  },
  {
    id: "obsidian:memory-instructions",
    description:
      "Persistent-memory Sanitation section: migrate stale entries to the vault instead of a local archive",
    copyFrom: path.join(TOOL_ROOT, "memory-instructions-section.md"),
    // Same target the base harness writes (lib/plan/claude-md-artifacts.mjs,
    // id claude-md:memory-instructions) — a ## subsection of that file, not
    // the whole thing. merge-section (now level-agnostic, lib/apply.mjs)
    // replaces just the "## Sanitation" block by heading match, leaving
    // "When to save" / "How to save" / "Reading memories" — and any
    // project-specific edits already there — untouched. Unlike
    // obsidian:claude-md above, this one is NOT safe to apply against a
    // target that doesn't exist yet: a lone Sanitation section with no
    // surrounding document is broken, not merely minimal. Only
    // /aia-harness:add-obsidian's own flow applies this id, gated on the
    // destination file already existing.
    dest: ".claude/memory/INSTRUCTIONS.md",
    mergeStrategy: "merge-section",
  },
];

/**
 * Obsidian vault artifacts — unconditional (no stack/profile gate). Only
 * ever applied when /aia-harness:add-obsidian selects them explicitly via
 * `--only=<ids>`; never defaultSelected, never suggested by plain /init.
 * @returns {ObsidianArtifactDef[]}
 */
export function selectObsidianAssets() {
  return OBSIDIAN_ARTIFACTS;
}

/**
 * Settings.json hook fragment for the 4 registered obsidian hooks
 * (vault-note-merge.mjs and vault-pipeline-shared.mjs are plain imported
 * modules, not wired directly). Same shape as tools-catalog.mjs's
 * toolSettingsHooks() output — merged into plan.mjs's `extraHooks` when
 * "obsidian-mcp" is a wired tool id.
 * @returns {Record<string, { matcher?: string, hooks: { type: "command", command: string, args: string[], timeout: number }[] }[]>}
 */
export function obsidianSettingsHooks() {
  const dir = "${CLAUDE_PROJECT_DIR}/.claude/hooks";
  const cmd = (/** @type {string} */ script) => ({ command: "node", args: [`${dir}/${script}`] });
  return {
    UserPromptSubmit: [
      {
        hooks: [
          { type: /** @type {const} */ ("command"), ...cmd("vault-orient.mjs"), timeout: 10 },
        ],
      },
    ],
    PreToolUse: [
      {
        matcher: "Read|Grep|Glob|Write|Edit|MultiEdit|NotebookEdit|Bash|PowerShell",
        hooks: [{ type: /** @type {const} */ ("command"), ...cmd("vault-guard.mjs"), timeout: 10 }],
      },
    ],
    SessionStart: [
      { hooks: [{ type: /** @type {const} */ ("command"), ...cmd("compile.mjs"), timeout: 10 }] },
    ],
    SessionEnd: [
      {
        hooks: [{ type: /** @type {const} */ ("command"), ...cmd("session-log.mjs"), timeout: 10 }],
      },
    ],
  };
}
