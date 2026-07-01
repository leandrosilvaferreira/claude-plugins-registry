---
name: claude-cannot-invoke-builtin-slash-commands
description: The model has no tool to run built-in REPL/CLI slash commands (e.g. /reload-plugins, /clear) on its own — only a human typing them can; the Skill tool only covers plugin-provided skills
metadata:
  type: architecture
---

Built-in, harness-level slash commands (`/reload-plugins`, `/plugin`, `/hooks`, `/clear`,
`/compact`, etc.) are operational actions on the CLI/session runtime itself, not tool
calls the model can invoke. The model's `Skill` tool only invokes *plugin-provided*
skills/commands (e.g. `/aia-harness:scan`) — there is no equivalent "run this built-in
REPL command" tool. Nothing in a normal tool-set lets the model trigger one of these
on its own initiative, no matter how strongly a hook's `additionalContext` instructs it to.

**Why this matters:** it's tempting to design a "fully automatic" feature as "the hook
updates something in the background, then Claude notices and just runs the follow-up
command itself" — that middle step is impossible for anything in this built-in-command
class. The actual ceiling is: the background step can be silent/automatic, but the
follow-up (reload, restart, etc.) always needs a human to type it, or a fresh session to
happen naturally. Confirmed the hard way in this repo: a plugin self-update hook design
first assumed "Claude can just run `/reload-plugins` itself" — this had to be walked back
once verified, since no tool surface exposes that action to the model. Also: even where a
slash command exists in Claude Code's docs, a given **host UI may not expose it** —
observed in this exact session, a VSCode-extension host had no `/reload-plugins` command
available at all, and the safe universal fallback (start a new session) was used instead.

**How to apply:** when designing a hook/feature whose payoff depends on Claude
"proactively doing X next," check whether X is a plugin skill (model-invokable) or a
built-in command (human-only, and possibly host-UI-dependent) before promising
"automatic" behavior around it. If it's built-in, the most honest design is
detect-and-silently-act-in-the-background + tell the user what manual step (if any)
remains — never assume the model can chain into performing the manual step itself, and
don't assume a documented slash command is available in every host UI.
