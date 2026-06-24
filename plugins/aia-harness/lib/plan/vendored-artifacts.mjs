/**
 * Add vendored ECC, ag-kit, and tool artifacts to a plan.
 * Extracted from plan.mjs to keep that orchestrator under 350 lines.
 * @module plan/vendored-artifacts
 */
import path from "node:path";
import { exists, listDirs } from "../util/fs.mjs";
import { getTool } from "../data/asset-catalog.mjs";
import { renderGraphifyignore } from "../generate/misc.mjs";

/** @typedef {import('../profile.mjs').ProjectProfile} ProjectProfile */
/** @typedef {(a: any) => void} AddFn */

/**
 * @typedef {{ agents: string[], skills: string[], rules: string[] }} EccAssets
 */

/**
 * @typedef {{ agents: string[], skills: string[], commands: string[], scripts: string[] }} AgkitAssets
 */

/**
 * Add ECC-sourced assets (agents, skills, rules) to the plan.
 * @param {AddFn} add
 * @param {string} eccRoot
 * @param {EccAssets} ecc
 */
export function addEccArtifacts(add, eccRoot, ecc) {
  for (const name of ecc.agents) {
    const from = path.join(eccRoot, "agents", `${name}.md`);
    if (!exists(from)) continue;
    add({
      id: `ecc-agent:${name}`,
      relPath: `.claude/agents/${name}.md`,
      title: `ECC agent: ${name}`,
      category: "agents",
      rationale: "Stack-specific reviewer/build-resolver from ECC (MIT, Affaan Mustafa).",
      contextCost: 0,
      defaultSelected: true,
      copyFrom: from,
    });
  }
  for (const name of ecc.skills) {
    const from = path.join(eccRoot, "skills", name);
    if (!exists(from)) continue;
    add({
      id: `ecc-skill:${name}`,
      relPath: `.claude/skills/${name}`,
      title: `ECC skill: ${name}`,
      category: "skills",
      rationale: "Stack skill from ECC (MIT, Affaan Mustafa).",
      contextCost: 0,
      defaultSelected: true,
      copyFrom: from,
    });
  }
  for (const dir of ecc.rules) {
    const from = path.join(eccRoot, "rules", dir);
    if (!exists(from)) continue;
    add({
      id: `ecc-rules:${dir}`,
      relPath: `.claude/rules/ecc/${dir}`,
      title: `ECC rules: ${dir}`,
      category: "rules",
      rationale: "Path-scoped rules mirrored from ECC (MIT, Affaan Mustafa).",
      contextCost: 0,
      defaultSelected: true,
      copyFrom: from,
    });
  }
}

/**
 * Add ag-kit-sourced assets (agents, skills, commands, scripts) to the plan.
 * @param {AddFn} add
 * @param {string} agkitRoot
 * @param {AgkitAssets} agkit
 */
export function addAgkitArtifacts(add, agkitRoot, agkit) {
  for (const name of agkit.agents) {
    const from = path.join(agkitRoot, "agents", `${name}.md`);
    if (!exists(from)) continue;
    add({
      id: `agkit-agent:${name}`,
      relPath: `.claude/agents/${name}.md`,
      title: `ag-kit agent: ${name}`,
      category: "agents",
      rationale: "Role-based specialist from ag-kit (MIT, vudovn).",
      contextCost: 0,
      defaultSelected: true,
      copyFrom: from,
    });
  }
  for (const name of agkit.skills) {
    const from = path.join(agkitRoot, "skills", name);
    if (!exists(from)) continue;
    add({
      id: `agkit-skill:${name}`,
      relPath: `.claude/skills/${name}`,
      title: `ag-kit skill: ${name}`,
      category: "skills",
      rationale: "Skill from ag-kit (MIT, vudovn).",
      contextCost: 0,
      defaultSelected: true,
      copyFrom: from,
    });
  }
  for (const name of agkit.commands) {
    const from = path.join(agkitRoot, "commands", `${name}.md`);
    if (!exists(from)) continue;
    add({
      id: `agkit-command:${name}`,
      relPath: `.claude/commands/${name}.md`,
      title: `ag-kit command: /${name}`,
      category: "commands",
      rationale: "Workflow command from ag-kit (MIT, vudovn).",
      contextCost: 0,
      defaultSelected: true,
      copyFrom: from,
    });
  }
  for (const name of agkit.scripts) {
    const from = path.join(agkitRoot, "scripts", `${name}.py`);
    if (!exists(from)) continue;
    add({
      id: `agkit-script:${name}`,
      relPath: `.claude/scripts/${name}.py`,
      title: `ag-kit script: ${name}.py`,
      category: "script",
      rationale: "Optional Python helper from ag-kit (MIT, vudovn).",
      contextCost: 0,
      defaultSelected: false,
      executable: true,
      copyFrom: from,
    });
  }
}

/**
 * Add vendored project-level tools (caveman, ponytail, rtk, graphify) to the plan.
 * @param {AddFn} add
 * @param {string} toolsRoot
 * @param {string[]} toolIds
 * @param {ProjectProfile} profile
 */
export function addToolArtifacts(add, toolsRoot, toolIds, profile) {
  for (const id of toolIds) {
    const tool = getTool(id);
    if (!tool) continue;
    if (tool.strategy === "vendor") {
      const skillsDir = path.join(toolsRoot, id, "skills");
      for (const skill of listDirs(skillsDir)) {
        add({
          id: `tool-skill:${id}:${skill}`,
          relPath: `.claude/skills/${skill}`,
          title: `Tool skill: ${skill} (${id})`,
          category: "skills",
          rationale: `${tool.name} skill, vendored (${tool.license}).`,
          contextCost: 0,
          defaultSelected: true,
          copyFrom: path.join(skillsDir, skill),
        });
      }
      const hooksDir = path.join(toolsRoot, id, "hooks");
      if (exists(hooksDir)) {
        add({
          id: `tool-hooks:${id}`,
          relPath: `.claude/hooks/${id}`,
          title: `Tool hooks: ${id}`,
          category: "tools",
          rationale: `${tool.name} hooks, vendored (${tool.license}); wired in settings.json.`,
          contextCost: 0,
          defaultSelected: true,
          copyFrom: hooksDir,
        });
      }
    }
    if (id === "graphify") {
      add({
        id: "graphifyignore",
        relPath: ".graphifyignore",
        title: ".graphifyignore",
        category: "tools",
        rationale: "Graphify ignore patterns seeded from the detected stack.",
        contextCost: 0,
        defaultSelected: true,
        content: renderGraphifyignore(profile),
      });
      if (profile.vcs?.isGit) {
        const gitHooksDir = path.join(toolsRoot, "graphify", "git-hooks");
        add({
          id: "graphify-git-hook:post-commit",
          relPath: ".git/hooks/post-commit",
          title: "Graphify git hook: post-commit",
          category: "git-hooks",
          rationale: "Auto-rebuilds knowledge graph after each commit (cross-platform, uv-aware).",
          contextCost: 0,
          defaultSelected: true,
          executable: true,
          copyFrom: path.join(gitHooksDir, "post-commit"),
        });
        add({
          id: "graphify-git-hook:post-checkout",
          relPath: ".git/hooks/post-checkout",
          title: "Graphify git hook: post-checkout",
          category: "git-hooks",
          rationale: "Auto-rebuilds knowledge graph on branch switch (cross-platform, uv-aware).",
          contextCost: 0,
          defaultSelected: true,
          executable: true,
          copyFrom: path.join(gitHooksDir, "post-checkout"),
        });
      }
    }
  }
}
