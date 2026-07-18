---
paths:
  - "**/*"
---

# Subagent Dispatch

## Rule

When dispatching subagents for any implementation, review, or analysis task:

1. **Consult the `## Workflow & Agents` table in CLAUDE.md** before choosing an agent.
2. **Use the specialist that matches** the task type — never the generic agent when a specialist is listed.
3. **Pass the exact name** as `subagent_type` in the dispatch.

## Superpowers bridging

The root `CLAUDE.md` "## Workflow & Agents" section contains a
"Superpowers → Project Specialists" table built from the agents installed in THIS
project. When a superpowers skill example shows `general-purpose`, consult that table
and dispatch the listed specialist instead. Only fall back to `general-purpose` when no
specialist row covers the task.

## Dispatch mechanics

- **Parallel by default** — 2+ independent domains → one agent per domain, all
  dispatched **in the same message** (separate messages run sequentially).
  Sequential only when A's output feeds B. Never two agents writing the same file.
- **Self-contained prompt** — a subagent inherits none of this conversation: give it
  scope, goal, constraints, and the expected output shape. It may also lack MCP servers
  you have — fetch what it needs yourself and paste the result into its prompt.
