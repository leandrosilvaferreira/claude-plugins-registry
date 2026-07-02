---
description: Audit agent frontmatter descriptions in .claude/agents and sync them with CLAUDE.md routing mentions on an existing target project.
argument-hint: "[path]"
allowed-tools:
  - Bash
  - Read
  - Edit
  - AskUserQuestion
---

# Revise agent routing on an existing project

Target directory: `$1` if provided, else `$CLAUDE_PROJECT_DIR`.

<!-- aia-harness:target-dir-resolution -->
Resolve this **once**, at the
start of this command, into a concrete literal absolute path. `$CLAUDE_PROJECT_DIR` is documented
as available "when hooks are executed" but is not guaranteed inside the general-purpose Bash tool
used to run these instructions — it can silently expand empty there, and the CLI then falls back
to the shell's *current* working directory, which is wrong if the agent has since `cd`'d elsewhere
(e.g. into the scratchpad for intermediate file work). Reuse that one resolved literal path in
every subsequent invocation below, never re-expand a bare `$CLAUDE_PROJECT_DIR` in a later,
separately-issued Bash call, since each Bash tool call is a fresh shell (only cwd persists, not
exported variables) and an earlier `cd` silently redirects any later bare-env-var fallback to the
wrong place.

`Read` `"${CLAUDE_PLUGIN_ROOT}/skills/revise-agent-routing/SKILL.md"` and follow its Phase 1-4
workflow exactly, using the resolved path above as its target directory.

**Do not** invoke the `Skill` tool by name to reach it. `skills/revise-agent-routing/SKILL.md`
shares its fully-qualified name (`aia-harness:revise-agent-routing`) with this very command — a
`Skill` tool call for that name issued from *inside* this command resolves back to this command
itself instead of the skill file, looping forever (confirmed in real use). Reading the file
directly and following its content sidesteps the collision entirely; this is the same pattern
`commands/condense-harness-prompts.md` already uses for its own identically-named skill.

Do **not** re-implement the audit beyond what's needed to read and follow the skill file — it
owns the full Phase 1-4 workflow (audit agent frontmatter, map CLAUDE.md coverage, apply fixes
with consent, report). This command exists only to guarantee the target-dir-resolution
boilerplate above runs identically to `/aia-harness:doctor` and `/aia-harness:patch` before
handing off.
