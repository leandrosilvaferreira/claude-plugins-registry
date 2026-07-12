/**
 * Add root/domain CLAUDE.md and memory-instructions/index artifacts to a plan.
 * Extracted from plan.mjs to keep that orchestrator under 350 lines.
 * @module plan/claude-md-artifacts
 */
import { renderRootClaudeMd, renderDomainClaudeMd, DOMAIN_LIMIT } from "../generate/claude-md.mjs";
import { renderMemoryInstructions } from "../generate/memory.mjs";

/** @typedef {(a: any) => void} AddFn */

/**
 * @param {string} s
 * @returns {number}
 */
function estTokens(s) {
  return Math.ceil(s.length / 4);
}

/**
 * Add CLAUDE.md (root + per-domain), memory instructions, and the memory index.
 * @param {AddFn} add
 * @param {import('../profile.mjs').ProjectProfile} profile
 * @param {{ name: string, whenToUse: string }[]} agentMetas
 */
export function addClaudeMdArtifacts(add, profile, agentMetas) {
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
}
