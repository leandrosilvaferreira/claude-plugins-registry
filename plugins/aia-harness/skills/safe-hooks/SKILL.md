---
name: safe-hooks
description: Use when writing, wiring, reviewing, or debugging Claude Code hooks — especially JavaScript hooks. Covers exit codes, the node-resolver wrapper, fail-open vs blocking behavior, matchers, timeouts, and security. Triggers on "write a hook", "PreToolUse/PostToolUse/Stop hook", "hook not blocking", "format on save hook".
---

# Safe hooks (JavaScript-first)

Hooks execute arbitrary code automatically. Treat them as a security surface.

## Exit codes (the #1 footgun)

- **exit 2** → blocks the action; stderr is fed back to Claude. Use for guards.
- **exit 0** → success; stdout JSON (if any) is processed.
- **exit 1 / other** → non-blocking error; the action proceeds anyway.

A guard that uses `exit 1` silently does nothing. Guards must `exit 2`.

## Choose the right event

- **PreToolUse** — guards / validation (can block with exit 2).
- **PostToolUse** — formatting, logging (cannot undo; react only). Keep non-blocking.
- **Stop / SubagentStop** — wrap-up reminders. Avoid blocking.
- **UserPromptSubmit** — runs before *every* prompt with a 30s budget. Keep fast.

Hard allow/deny belongs in the **permission system**, not a Bash-parsing hook.

## JavaScript hooks: the node-resolver wrapper

`node` is often not on PATH (nvm-managed). Never call `node` directly in a hook
command. Invoke the shipped wrapper, which resolves
`$CLAUDE_NODE → node → newest nvm node → bun`:

```json
{
  "PostToolUse": [
    {
      "matcher": "Edit|Write|MultiEdit",
      "hooks": [
        {
          "type": "command",
          "command": "\"${CLAUDE_PROJECT_DIR}/.claude/hooks/node-run.sh\" \"${CLAUDE_PROJECT_DIR}/.claude/hooks/format-on-edit.mjs\"",
          "timeout": 60
        }
      ]
    }
  ]
}
```

Hook scripts are plain ESM `.mjs` — no build step, identical for `.js`-only and
TypeScript projects. They read the event JSON from stdin (`fs.readFileSync(0)`)
and may print control JSON to stdout.

## Rules

- Scope with `matcher` (e.g. `"Edit|Write"`) so hooks don't fire on every call.
- Quote all variables; prefer absolute paths via `${CLAUDE_PROJECT_DIR}` / `${CLAUDE_PLUGIN_ROOT}`.
- Fail open on infrastructure errors (missing runtime) so a broken hook never
  bricks the session — unless the hook is a security guard, which should block.
- Never read or echo secrets; skip `.env` and `.git`.
- Keep blocking hooks fast; move heavy lint/test to non-blocking or on-demand.

The plugin ships ready hooks: `format-on-edit.mjs` (non-blocking format),
`verify-on-stop.mjs` (non-blocking reminder), `secret-scan.mjs` (PreToolUse
guard, exit 2). Wire `secret-scan` under PreToolUse `Edit|Write|MultiEdit`.
