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
