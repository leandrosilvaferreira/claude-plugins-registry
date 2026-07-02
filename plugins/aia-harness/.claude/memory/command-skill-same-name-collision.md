---
name: command-skill-same-name-collision
description: commands/X.md + skills/X/SKILL.md sharing a name — a Skill-tool call for that name from inside the command loops back to the command, not the skill
metadata:
  type: architecture
---

Never give a `commands/<name>.md` file and a `skills/<name>/SKILL.md` file the same
`<name>`, if the command's own body issues a literal `Skill` tool call
(`skill: "aia-harness:<name>"`) to reach the skill. Confirmed in real use: the fully-qualified
name collides, and Claude Code resolves the Skill-tool dispatch back to the **command**, not
the skill — the command re-enters itself, looping forever.

**Why this is easy to miss:** `commands/condense-harness-prompts.md` and
`skills/condense-harness-prompts/SKILL.md` already share a name in this exact codebase and
look like a safe precedent to copy — but that command never issues a literal `Skill` tool call
for that name; it just narrates "invoke the X skill, follow its steps" in loose prose. It never
actually exercises the collision path. `commands/revise-agent-routing.md` copied the *shape*
(same-name command+skill pair) but added an explicit `Skill(skill: "aia-harness:revise-agent-routing")`
call — that's what triggered the loop. The precedent looked proven; it wasn't proven for the
literal-Skill-tool-call case.

**How to apply:** When building a thin `commands/X.md` wrapper that hands off to a
`skills/X/SKILL.md` (the [[condense-harness-prompts]]-style split), do **not** have the command
issue a literal `Skill` tool call to reach a same-named skill. Instead, have it `Read` the
skill file directly (`"${CLAUDE_PLUGIN_ROOT}/skills/X/SKILL.md"`) and follow its content — this
sidesteps the FQN lookup entirely. If the skill genuinely needs to be `Skill`-tool-invocable
(e.g. dispatched from a different command like `init.md` invokes `revise-claude-md`), give it a
name that does **not** match any `commands/*.md` file in the plugin — every skill invoked via a
literal `Skill` tool call elsewhere in this codebase (`revise-claude-md`, `harness-engineering`)
has no same-named command file, which is why those calls work fine.
