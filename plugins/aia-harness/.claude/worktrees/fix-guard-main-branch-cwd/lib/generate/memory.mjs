/**
 * Generate .claude/memory/INSTRUCTIONS.md content.
 * Shipped to target projects to drive autonomous session-learning capture.
 * @module generate/memory
 */

/**
 * Renders the memory instructions file for target projects.
 * @returns {string}
 */
export function renderMemoryInstructions() {
  return `# Persistent Memory — Instructions

This file is auto-loaded into every session via \`@.claude/memory/INSTRUCTIONS.md\`.
Read and follow these rules without being asked.

## When to save (do not wait to be asked)

Save a memory **only** when a future session would benefit from knowing this **before trying to discover it alone**.
Hard-won knowledge only — obvious things, summaries, and temporary context do not qualify.

| Learned... | Memory type |
|------------|-------------|
| Model kept repeating a mistake until corrected by the user | \`feedback\` |
| Architecture or pattern discovered after failures or many attempts | \`architecture\` |
| Business rule that affects code and is not obvious from reading the repo | \`business-rule\` |
| Where external info lives (Linear, Grafana, Slack, dashboards, wikis) | \`reference\` |

**Do NOT save:**
- Things derivable by reading the code or git history
- Deadlines, motivations, or temporary project context
- Debug steps or fix recipes (those belong in the commit message)
- Anything already documented in CLAUDE.md files

**Quality test before saving:** Would a future Claude session working on this codebase be surprised
and grateful to know this before starting? If not, skip it.

## How to save

1. Write a \`.md\` file in \`.claude/memory/\` with this frontmatter:

\`\`\`markdown
---
name: kebab-case-slug
description: one-line summary — used to decide relevance in future sessions
metadata:
  type: feedback | architecture | business-rule | reference
---

Fact or rule. **Why:** the reason this matters or was hard to discover. **How to apply:** when and where this applies.
\`\`\`

2. Add one line to \`.claude/memory/MEMORY.md\` (the index):
   \`- [Title](filename.md) — one-line hook describing what this memory is for\`

## Sanitation (mandatory when index is large)

Before writing a new memory entry, count the non-blank lines in \`.claude/memory/MEMORY.md\`.
If ≥ 130 lines, run sanitation first:

1. Read all memory files in \`.claude/memory/\`
2. Score each entry: **recency × specificity × likelihood of preventing a real future mistake**
3. Move low-score files to \`.claude/memory/archive/\` (never delete outright)
4. Rewrite the \`MEMORY.md\` index keeping only the remaining files (target: ≤ 130 lines)
5. Then write the new memory

## Reading memories

Before acting on any complex request: scan \`MEMORY.md\` for entries relevant to the current task.
Load and apply the relevant memory files before responding — do not rely solely on the index summary.
`;
}
