---
name: harness-engineering
description: Use when setting up, scaffolding, bootstrapping, or improving a Claude Code "harness" for a project — hooks, skills, agents, rules, settings.json, .mcp.json, settings.local.json, worktree config, or per-domain CLAUDE.md. Triggers on "set up Claude Code", "harness engineering", "scaffold hooks/rules", "configure this project for Claude", "bootstrap .claude".
---

# Harness engineering

Turn any project into a well-tuned Claude Code workspace, safely. The plugin
ships a deterministic engine (`bin/aia-harness`) that scans the project and
produces a scaffold plan; you orchestrate the **diagnose → approve → apply**
loop and tailor the generated prose.

## The loop (always)

1. **Diagnose** — `"${CLAUDE_PLUGIN_ROOT}/bin/aia-harness" scan <dir>`.
   Present the stack, commands, architecture, and any existing harness.
2. **Plan** — `"${CLAUDE_PLUGIN_ROOT}/bin/aia-harness" plan <dir> --json`.
   Show artifacts grouped by category with rationale + context cost.
3. **Consent** — ask which artifacts to apply (multi-select). Default-select the
   `selected` items; leave `opt-in` ones unchecked.
4. **Diff** — for any existing target, show the diff before overwriting.
5. **Apply** — `... apply <dir> --yes --only=<ids>` (add `--force` only for
   approved overwrites). Then run the `harness-reviewer` agent.
6. **Recommend** — after install, invoke the `claude-automation-recommender`
   skill on the project for Claude's own second opinion on further automations;
   present the new suggestions and offer to act on them. Skip gracefully if the
   skill (from the `claude-code-setup` plugin) is not installed. Read-only.

## What gets generated

- **CLAUDE.md** — concise root memory (stack + canonical commands) plus
  lazy-loaded per-domain files. Keep root well under ~200 lines; bloated memory
  gets ignored. Put hard guarantees in hooks, not prose.
- **.claude/rules/*.md** — path-scoped (`paths:` frontmatter), loaded on demand.
- **.claude/settings.json** — least-privilege permissions + JS hook wiring.
- **.claude/settings.local.json** — env values, gitignored.
- **.mcp.json** — strategic MCP servers (see the `mcp-catalog` skill).
- **.claude/hooks/** — JS hooks run through the node-resolver wrapper (see the
  `safe-hooks` skill).
- **.claude/skills/** — predefined operational skills (run-tests, lint-fix,
  pre-commit-verify) tailored to the stack.
- **.worktreeinclude / .lsp.json / docs/harness/strategies.md** — worktree,
  language-server, and lint/compile/test strategy.
- **ECC-sourced assets, by detected stack** — stack-specific reviewer/build-resolver
  agents (`.claude/agents/`), skills (`.claude/skills/`), and rules mirrored into
  `.claude/rules/ecc/<stack>/`. Vendored from ECC (MIT, Affaan Mustafa); the
  stack→asset map is `lib/data/ecc-catalog.mjs`. Mention the attribution.
- **Project-level tools** (see `/aia-harness:add-tools` and `lib/data/tools-catalog.mjs`):
  caveman + ponytail install as global Claude Code plugins (strategy "plugin" — not vendored, not wired per-project); a guarded rtk `PreToolUse` hook (no-ops if binary absent) and claude-code-worktrees skill are project-level (vendored); and the graphify code-graph
  flow. Binary/pkg tools (rtk, graphify) and plugins (caveman, ponytail) install after one confirmation. rtk hook + worktrees stay project-level — never `~/.claude`.

## Non-negotiable safety rules

- Never write without showing the plan and getting approval.
- Never put secrets in committed files. `.mcp.json` uses `${ENV}` placeholders;
  real values go in `.claude/settings.local.json` (which must be gitignored).
- Never auto-enable a hook the user has not seen. Hooks execute arbitrary code.
- Prefer the deterministic engine's facts; only override with evidence (e.g.
  reading CI). For ambiguous stacks, delegate to the `stack-analyst` agent.

## Scope notes

First-class detection: JavaScript/TypeScript and PHP. Other languages use a
generic fallback — verify the canonical commands with the user before relying on
them.
