---
name: command-skill-same-name-collision
description: commands/X.md + skills/X/SKILL.md sharing a name — a Skill-tool call for that name from inside the command loops back to the command, not the skill. Fix — give the skill a distinct name.
metadata:
  type: architecture
---

Never give a `commands/<name>.md` file and a `skills/<name>/SKILL.md` file the same
`<name>` when the command's own body invokes the skill via the `Skill` tool
(`skill: "aia-harness:<name>"`). Confirmed in real use, twice: the fully-qualified name
collides, and Claude Code's `Skill` dispatch resolves back to the **command**, not the skill —
the command re-enters itself, looping forever.

**Why this is easy to miss:** `commands/condense-harness-prompts.md` and
`skills/condense-harness-prompts/SKILL.md` already share a name in this exact codebase and
look like a safe precedent to copy — but that command never issues a literal `Skill` tool call
for that name; it just narrates "invoke the X skill, follow its steps" in loose prose. It never
actually exercises the collision path. `commands/revise-agent-routing.md` copied the *shape*
(same-name command+skill pair) but added an explicit
`Skill(skill: "aia-harness:revise-agent-routing")` call — that's what triggered the loop.

**How to apply — fix the name, don't work around the collision.** First attempt was a
workaround (`Read` the skill file directly instead of using the `Skill` tool) — it technically
stopped the loop, but the user rejected it on sight: it still leaves a same-named command and
skill sitting there as a trap for the next person, and it forces every invocation to spend
extra reasoning re-explaining "why we're avoiding the Skill tool here." **Give the skill a
distinct name instead** (e.g. `revise-agent-routing` command + `revise-agent-routing-workflow`
skill) and invoke it normally via the `Skill` tool — same as every other skill invoked this way
elsewhere in the codebase (`revise-claude-md`, `harness-engineering`), none of which share a
name with any `commands/*.md` file, which is why those calls work fine. When renaming: update
the skill directory, its frontmatter `name:`, every `${CLAUDE_PLUGIN_ROOT}/skills/<name>/...`
path reference inside the skill's own body (bash blocks, comments), and the command's `Skill`
tool call target — but leave `commands/help.md`/`README.md` alone, since they only ever
reference the command's public name, never the skill's internal one.
