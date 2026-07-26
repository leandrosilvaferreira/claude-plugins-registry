/**
 * Build a harness plan (list of artifacts) from a ProjectProfile.
 * @module plan
 */
import path from "node:path";
import { renderRules } from "./generate/rules.mjs";
import { renderSettings, renderSettingsLocal } from "./generate/settings.mjs";
import { renderVerifyOnStop } from "./generate/verify.mjs";
import { renderMcp } from "./generate/mcp.mjs";
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
  selectObsidianAssets,
  obsidianSettingsHooks,
} from "./data/asset-catalog.mjs";
import { addHookArtifacts } from "./plan/hook-artifacts.mjs";
import {
  addEccArtifacts,
  addAgkitArtifacts,
  addToolArtifacts,
} from "./plan/vendored-artifacts.mjs";
import { addClaudeMdArtifacts } from "./plan/claude-md-artifacts.mjs";
import { addDocsArtifacts } from "./plan/docs-artifacts.mjs";

/**
 * @typedef {Object} Artifact
 * @property {string} id
 * @property {string} relPath
 * @property {string} title
 * @property {"claude-md"|"rules"|"settings"|"mcp"|"git-hooks"|"hooks"|"skills"|"agents"|"commands"|"tools"|"worktree"|"lsp"|"docs"|"script"|"github-pm"|"obsidian"} category
 * @property {string} rationale
 * @property {number} contextCost  Estimated tokens added to every session (0 = lazy/not loaded).
 * @property {boolean} defaultSelected
 * @property {boolean} executable
 * @property {string|null} content   Inline content, or null when copyFrom is set.
 * @property {string|null} copyFrom  Absolute source path to copy, or null.
 * @property {boolean} exists        Whether the target already exists.
 * @property {'merge-settings'|'merge-lines'|'merge-section'|'merge-mcp'} [mergeStrategy]  When set, merge into an existing file instead of skip/replace: "merge-settings" merges a JSON settings file key by key (array-union for permissions.allow/deny/additionalDirectories, object-union for env/enabledPlugins/extraKnownMarketplaces, hook-array union for hooks, keep-existing/add-if-absent for every other key); "merge-lines" appends any canonical line missing from the existing file; "merge-section" replaces (or appends) one markdown section in place — heading level taken from the artifact's own content — leaving sibling sections untouched, but (unlike the other three strategies) not preserving the section's own prior content on a plain apply; under `merge: true` specifically, a section that already exists and differs is therefore parked as a `conflicts[]` entry instead of being replaced, exactly like a strategy-less artifact. **`--force` bypasses every strategy in this list**, `merge-section` included: it writes the artifact's raw content over the whole target file, which for a section artifact means the file is reduced to that lone section and every sibling is destroyed — never force a `merge-section` id; "merge-mcp" merges a JSON .mcp.json file by unioning mcpServers by server key (existing server always wins, incoming servers absent from existing are added) and keep-existing/add-if-absent for every other top-level key.
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

  // --- CLAUDE.md + memory (delegated) ---
  addClaudeMdArtifacts(add, profile, agentMetas);

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
  // dedups by command+args on re-apply (apply.mjs mergeSettingsJson).
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

  // Obsidian vault hooks (UserPromptSubmit/PreToolUse/SessionStart/SessionEnd):
  // wired only when add-obsidian selected "obsidian-mcp" as a tool id. Merges
  // by matcher, same fold-by-matcher logic as the extraHooks loop above (so
  // re-apply stays idempotent via apply.mjs's mergeSettingsJson).
  if (toolIds.includes("obsidian-mcp")) {
    for (const [event, entries] of Object.entries(obsidianSettingsHooks())) {
      const base = extraHooks[event] ?? [];
      for (const grp of entries) {
        const m = grp.matcher ?? "";
        const i = base.findIndex((g) => (g.matcher ?? "") === m);
        if (i === -1) base.push(grp);
        else base[i] = { ...base[i], hooks: [...(base[i].hooks ?? []), ...(grp.hooks ?? [])] };
      }
      extraHooks[event] = base;
    }
  }

  add({
    id: "settings",
    relPath: ".claude/settings.json",
    title: "settings.json",
    category: "settings",
    rationale: "Least-privilege permissions + JS hook wiring (committed).",
    contextCost: 0,
    defaultSelected: true,
    mergeStrategy: "merge-settings",
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
    mergeStrategy: "merge-mcp",
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

  // --- Docs, LSP, worktree, scripts (delegated) ---
  addDocsArtifacts(add, profile, toolIds);

  // `.gitignore` entries `applyPlan` appends under the `# aia-harness` header.
  // Built here, before the artifacts that need them: `.graphifyignore` seeds
  // itself from the project `.gitignore`, which `ensureGitignore` only updates
  // *after* every artifact has been rendered — so a seed taken from the file
  // alone is always one apply behind and parks a self-inflicted conflict on the
  // next apply run.
  const gitignoreEntries = [
    ".claude/settings.local.json",
    ".claude/*.local.*",
    ".claude/.aia-harness-pending/",
    ...(profile.githubPM?.detected ? [".claude/pm-config.json"] : []),
    ...(toolIds.includes("graphify")
      ? ["graphify-out/", "graphify-out/cost.json", "graphify-out/cache/"]
      : []),
  ];

  // --- Vendored assets (ECC, ag-kit, tools) — delegated ---
  addEccArtifacts(add, eccRoot, ecc);
  addAgkitArtifacts(add, agkitRoot, agkit);
  addToolArtifacts(add, toolsRoot, toolIds, profile, gitignoreEntries);

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

  // --- Obsidian vault memory (opt-in; defaultSelected:false; no profile gate) ---
  for (const asset of selectObsidianAssets()) {
    add({
      id: asset.id,
      relPath: asset.dest,
      title: asset.description,
      category: /** @type {any} */ ("obsidian"),
      rationale: asset.description,
      contextCost: 0,
      defaultSelected: false,
      copyFrom: asset.copyFrom,
      ...(asset.mergeStrategy ? { mergeStrategy: asset.mergeStrategy } : {}),
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
    gitignore: gitignoreEntries,
    notes,
    totalContextCost: artifacts.reduce((sum, a) => sum + a.contextCost, 0),
  };
}
