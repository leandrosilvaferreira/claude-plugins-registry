/**
 * Build a harness plan (list of artifacts) from a ProjectProfile.
 * @module plan
 */
import path from "node:path";
import { renderRootClaudeMd, renderDomainClaudeMd, DOMAIN_LIMIT } from "./generate/claude-md.mjs";
import { renderRules } from "./generate/rules.mjs";
import { renderSettings, renderSettingsLocal } from "./generate/settings.mjs";
import { renderVerifyOnStop } from "./generate/verify.mjs";
import { renderMcp } from "./generate/mcp.mjs";
import { renderMemoryInstructions } from "./generate/memory.mjs";
import {
  renderStrategies,
  renderLspJson,
  renderWorktreeInclude,
  renderPluginsInstallScript,
} from "./generate/misc.mjs";
import { exists } from "./util/fs.mjs";
import {
  selectEccAssets,
  selectAgkitAssets,
  selectProjectAssets,
  selectProjectHooks,
  selectTools,
  getTool,
  toolSettingsHooks,
  resolveAgentWhenToUse,
  selectGitHubPMAssets,
} from "./data/asset-catalog.mjs";
import { suggestPlugins } from "./data/plugins-catalog.mjs";
import { addHookArtifacts } from "./plan/hook-artifacts.mjs";
import {
  addEccArtifacts,
  addAgkitArtifacts,
  addToolArtifacts,
} from "./plan/vendored-artifacts.mjs";

/**
 * @typedef {Object} Artifact
 * @property {string} id
 * @property {string} relPath
 * @property {string} title
 * @property {"claude-md"|"rules"|"settings"|"mcp"|"git-hooks"|"hooks"|"skills"|"agents"|"commands"|"tools"|"worktree"|"lsp"|"docs"|"script"|"github-pm"} category
 * @property {string} rationale
 * @property {number} contextCost  Estimated tokens added to every session (0 = lazy/not loaded).
 * @property {boolean} defaultSelected
 * @property {boolean} executable
 * @property {string|null} content   Inline content, or null when copyFrom is set.
 * @property {string|null} copyFrom  Absolute source path to copy, or null.
 * @property {boolean} exists        Whether the target already exists.
 * @property {'merge-hooks'} [mergeStrategy]  When set, merge hook arrays into existing file instead of skip/replace.
 */

/**
 * @typedef {Object} HarnessPlan
 * @property {Artifact[]} artifacts
 * @property {string[]} gitignore
 * @property {string[]} notes
 * @property {number} totalContextCost
 */

// verify-on-stop.mjs is added separately: strict mode generates its content; non-strict copies the reminder.
// The static hook list lives in project-catalog.mjs (PROJECT_HOOK_FILES).

/**
 * @param {string} s
 * @returns {number}
 */
function estTokens(s) {
  return Math.ceil(s.length / 4);
}

/**
 * @param {import('./profile.mjs').ProjectProfile} profile
 * @param {{ pluginRoot: string, tools?: string[], strict?: boolean, largeFiles?: "block"|"advisory" }} ctx
 * @returns {HarnessPlan}
 */
export function buildPlan(profile, ctx) {
  const { pluginRoot } = ctx;
  const root = profile.root;
  const toolsRoot = path.join(pluginRoot, "templates", "tools");
  const toolIds = ctx.tools ?? selectTools(profile).map((t) => t.id);
  // Wire hooks for:
  //  - vendor tools with a local hooks dir OR with script-form hooks
  //    distributed via PROJECT_HOOK_FILES (rtk-hook.mjs; caveman/ponytail are plugins, not vendored)
  //  - hook-wire tools (legacy shell-form only, none remain after Task 2)
  const wiredToolIds = toolIds.filter((id) => {
    const t = getTool(id);
    if (!t) return false;
    if (t.strategy === "vendor") {
      return exists(path.join(toolsRoot, id, "hooks")) || t.hooks.some((h) => h.script);
    }
    return t.strategy === "hook-wire";
  });
  // Strict Stop loop: on by default, opt out via ctx.strict === false.
  const verifyOnStopSrc = ctx.strict === false ? null : renderVerifyOnStop(profile);
  const strict = verifyOnStopSrc != null;
  // Large-file guard mode: explicit ctx wins, else detector's recommendation, else advisory.
  const largeFiles = ctx.largeFiles ?? profile.largeFiles?.recommended ?? "advisory";
  /** @type {Artifact[]} */
  const artifacts = [];

  /**
   * @param {Omit<Artifact, "executable" | "content" | "copyFrom" | "exists"> &
   *   Partial<Pick<Artifact, "executable" | "content" | "copyFrom" | "exists">>} a
   */
  const add = (a) => {
    const relAbs = path.join(root, a.relPath);
    artifacts.push({
      executable: false,
      content: null,
      copyFrom: null,
      ...a,
      exists: a.exists ?? exists(relAbs),
    });
  };

  // Pre-collect agents (with file-existence gate) for CLAUDE.md Workflow & Agents table.
  const ecc = selectEccAssets(profile);
  const eccRoot = path.join(pluginRoot, "templates", "ecc");
  const agkit = selectAgkitAssets(profile);
  const agkitRoot = path.join(pluginRoot, "templates", "ag-kit");
  const projectAgentsDir = path.join(pluginRoot, "templates", "agents");
  const agentMetas = [
    ...ecc.agents
      .filter((n) => exists(path.join(eccRoot, "agents", `${n}.md`)))
      .map((n) => ({ name: n, whenToUse: resolveAgentWhenToUse(n) })),
    ...agkit.agents
      .filter((n) => exists(path.join(agkitRoot, "agents", `${n}.md`)))
      .map((n) => ({ name: n, whenToUse: resolveAgentWhenToUse(n) })),
    ...selectProjectAssets(profile)
      .agents.filter((n) => exists(path.join(projectAgentsDir, `${n}.md`)))
      .map((n) => ({ name: n, whenToUse: resolveAgentWhenToUse(n) })),
  ].filter((m, i, arr) => arr.findIndex((x) => x.name === m.name) === i);

  // --- CLAUDE.md + memory ---
  const rootMd = renderRootClaudeMd(profile, agentMetas);
  add({
    id: "claude-md-root",
    relPath: "CLAUDE.md",
    title: "Root CLAUDE.md",
    category: "claude-md",
    rationale: "Project memory: stack + canonical commands, loaded every session.",
    contextCost: estTokens(rootMd),
    defaultSelected: true,
    content: rootMd,
  });

  const memInstructions = renderMemoryInstructions();
  add({
    id: "claude-md:memory-instructions",
    relPath: ".claude/memory/INSTRUCTIONS.md",
    title: "Memory instructions",
    category: "claude-md",
    rationale:
      "Auto-loaded via @ import in CLAUDE.md — drives autonomous session-learning capture.",
    contextCost: estTokens(memInstructions),
    defaultSelected: true,
    content: memInstructions,
  });

  // memory-index uses a non-prefixed ID intentionally: it is user-owned data (grows each session)
  // and must NOT be matched by /patch --force (which would erase accumulated project learnings).
  // doctor still detects it as missing via artifact.exists check.
  add({
    id: "memory-index",
    relPath: ".claude/memory/MEMORY.md",
    title: "Memory index (MEMORY.md)",
    category: "claude-md",
    rationale:
      "Auto-loaded via @ import in CLAUDE.md — index of project learnings (created empty, grows over time).",
    contextCost: 0,
    defaultSelected: true,
    content: "# Memory index\n\n",
  });

  for (const d of profile.architecture.domains.slice(0, DOMAIN_LIMIT)) {
    add({
      id: `claude-md:${d.path}`,
      relPath: `${d.path}/CLAUDE.md`,
      title: `CLAUDE.md — ${d.path}`,
      category: "claude-md",
      rationale: `Domain guidance for ${d.path} (lazy-loaded).`,
      contextCost: 0,
      defaultSelected: true,
      content: renderDomainClaudeMd(profile, d),
    });
  }

  // --- Rules (generated) ---
  for (const r of renderRules(profile)) {
    add({
      id: `rule:${r.relPath}`,
      relPath: r.relPath,
      title: `Rule: ${r.title}`,
      category: "rules",
      rationale: "Path-scoped rule, loaded only when matching files are touched.",
      contextCost: 0,
      defaultSelected: true,
      content: r.content,
    });
  }

  // --- Settings + MCP ---
  const stackHooks = selectProjectHooks(profile);
  /** @type {Record<string, any[]>} */
  const extraHooks = { ...toolSettingsHooks(wiredToolIds) };
  for (const [event, entries] of Object.entries(stackHooks.settings)) {
    extraHooks[event] = [...(extraHooks[event] ?? []), ...entries];
  }
  // Graphify orientation guard (PreToolUse): inject "query the graph first" when
  // graphify-out/graph.json exists. Cross-platform node hook (no python3 / POSIX
  // shell) wired exec-form like every other harness hook, so it runs identically on
  // Linux/macOS/Windows. The hook file is copied by addToolArtifacts. Matcher
  // "Bash|Read|Glob" is distinct from the base "Bash" group, so it stands alone and
  // dedups by command+args on re-apply (apply.mjs mergeSettingsHooks).
  if (toolIds.includes("graphify")) {
    extraHooks.PreToolUse = [
      ...(extraHooks.PreToolUse ?? []),
      {
        matcher: "Bash|Read|Glob",
        hooks: [
          {
            type: "command",
            command: "node",
            args: ["${CLAUDE_PROJECT_DIR}/.claude/hooks/graphify-orient.mjs"],
            timeout: 10,
          },
        ],
      },
    ];
  }

  add({
    id: "settings",
    relPath: ".claude/settings.json",
    title: "settings.json",
    category: "settings",
    rationale: "Least-privilege permissions + JS hook wiring (committed).",
    contextCost: 0,
    defaultSelected: true,
    mergeStrategy: "merge-hooks",
    content: renderSettings(profile, extraHooks, { strict, largeFiles }),
  });

  const mcp = renderMcp(profile);
  add({
    id: "mcp",
    relPath: ".mcp.json",
    title: ".mcp.json",
    category: "mcp",
    rationale:
      `Strategic MCP servers: ${mcp.names.join(", ") || "none"} (env placeholders only).` +
      (mcp.prereqs.length > 0 ? ` Prereqs — ${mcp.prereqs.join("; ")}.` : ""),
    contextCost: 0,
    defaultSelected: true,
    content: mcp.content,
  });

  add({
    id: "settings-local",
    relPath: ".claude/settings.local.json",
    title: "settings.local.json",
    category: "settings",
    rationale: "Personal env values (gitignored).",
    contextCost: 0,
    defaultSelected: true,
    content: renderSettingsLocal(mcp.envPlaceholders),
  });

  // --- Hooks (delegated) ---
  addHookArtifacts(add, pluginRoot, profile, { strict, verifyOnStopSrc, stackHooks });

  // --- Skills + first-party rules ---
  for (const s of selectProjectAssets(profile).skills) {
    add({
      id: `skill:${s}`,
      relPath: `.claude/skills/${s}`,
      title: `Skill: ${s}`,
      category: "skills",
      rationale: "Predefined operational skill installed into the project.",
      contextCost: 0,
      defaultSelected: true,
      copyFrom: path.join(pluginRoot, "templates", "skills", s),
    });
  }
  for (const a of selectProjectAssets(profile).agents) {
    add({
      id: `agent:project:${a}`,
      relPath: `.claude/agents/${a}.md`,
      title: `Agent: ${a}`,
      category: "agents",
      rationale: "First-party agent distributed by aia-harness.",
      contextCost: 0,
      defaultSelected: true,
      copyFrom: path.join(pluginRoot, "templates", "agents", `${a}.md`),
    });
  }
  for (const r of selectProjectAssets(profile).rules) {
    add({
      id: `rule:project:${r}`,
      relPath: `.claude/rules/${r}`,
      title: `Rule: ${r}`,
      category: "rules",
      rationale: "First-party rule distributed by aia-harness.",
      contextCost: 0,
      defaultSelected: true,
      copyFrom: path.join(pluginRoot, "templates", "rules", r),
    });
  }

  // --- Docs, LSP, worktree, scripts ---
  add({
    id: "strategies",
    relPath: "docs/harness/strategies.md",
    title: "Harness strategies doc",
    category: "docs",
    rationale: "Lint / compile / language-server / test strategy reference.",
    contextCost: 0,
    defaultSelected: true,
    content: renderStrategies(profile),
  });

  const lsp = renderLspJson(profile);
  if (lsp) {
    add({
      id: "lsp",
      relPath: ".lsp.json",
      title: ".lsp.json (language server)",
      category: "lsp",
      rationale: "Language server config (best-effort; opt-in).",
      contextCost: 0,
      defaultSelected: false,
      content: lsp,
    });
  }

  if (profile.vcs.isGit) {
    add({
      id: "worktree",
      relPath: ".worktreeinclude",
      title: ".worktreeinclude",
      category: "worktree",
      rationale: "Copy local settings/env into new git worktrees.",
      contextCost: 0,
      defaultSelected: true,
      content: renderWorktreeInclude(),
    });
  }

  const pluginSuggestions = suggestPlugins(profile);
  if (pluginSuggestions.length > 0) {
    add({
      id: "install-plugins",
      relPath: "scripts/install-plugins.mjs",
      title: "Plugin installer (runnable)",
      category: "script",
      rationale: `Runnable installer for ${pluginSuggestions.length} suggested plugin(s) — idempotent; run with -y.`,
      contextCost: 0,
      defaultSelected: true,
      content: renderPluginsInstallScript(pluginSuggestions),
    });
  }

  // --- Vendored assets (ECC, ag-kit, tools) — delegated ---
  addEccArtifacts(add, eccRoot, ecc);
  addAgkitArtifacts(add, agkitRoot, agkit);
  addToolArtifacts(add, toolsRoot, toolIds, profile);

  // --- GitHub PM (opt-in; defaultSelected:false) ---
  for (const asset of selectGitHubPMAssets(profile)) {
    add({
      id: asset.id,
      relPath: asset.dest,
      title: asset.description,
      category: /** @type {any} */ ("github-pm"),
      rationale: asset.description,
      contextCost: 0,
      defaultSelected: false,
      copyFrom: asset.copyFrom,
    });
  }

  // --- Notes ---
  /** @type {string[]} */
  const notes = [];
  if (profile.existingHarness.claudeMd) {
    notes.push("Existing CLAUDE.md found — a diff is shown instead of overwriting.");
  }
  if (
    profile.primaryLanguage &&
    !["JavaScript", "TypeScript", "PHP"].includes(profile.primaryLanguage)
  ) {
    notes.push(
      `Primary language ${profile.primaryLanguage} uses the generic fallback (v1 deep support: JS/TS, PHP).`,
    );
  }
  if (!profile.testing.configured && profile.testing.recommended) {
    notes.push(
      `No unit tests detected — recommended: ${profile.testing.recommended}. ` +
        `The setup-testing skill is installed; run /setup-testing to scaffold.`,
    );
  }
  notes.push(
    largeFiles === "block"
      ? "Large-file guard: block mode — the agent refactors any source file over 350 lines before finishing."
      : `Large-file guard: advisory mode — suggests refactors on edit and confirms with you, never blocking` +
          `${profile.largeFiles && profile.largeFiles.count > 0 ? ` (${profile.largeFiles.count} file(s) already over 350 lines)` : ""}.`,
  );

  return {
    artifacts,
    gitignore: [
      ".claude/settings.local.json",
      ".claude/*.local.*",
      ...(profile.githubPM?.detected ? [".claude/pm-config.json"] : []),
      ...(toolIds.includes("graphify")
        ? ["graphify-out/", "graphify-out/cost.json", "graphify-out/cache/"]
        : []),
    ],
    notes,
    totalContextCost: artifacts.reduce((sum, a) => sum + a.contextCost, 0),
  };
}
