---
description: Suggest and generate strategic MCP server entries for the project's .mcp.json (env placeholders only).
argument-hint: "[path]"
allowed-tools:
  - Bash
  - Read
  - Edit
  - AskUserQuestion
---

# Add strategic MCP servers

Use the **mcp-catalog** skill for the curated list and safety rules.

Target directory: `$1` if provided, else `$CLAUDE_PROJECT_DIR`.

1. Show the recommended MCP servers for this project. Get them from the plan:

   ```bash
   "${CLAUDE_PLUGIN_ROOT}/bin/aia-harness" plan "${1:-$CLAUDE_PROJECT_DIR}" --json
   ```

   (the `.mcp.json` artifact lists the recommended servers and required env vars),
   plus any others from the `mcp-catalog` skill.

2. Use `AskUserQuestion` (multi-select) to let the user pick which servers to add.

3. Merge the chosen servers into the project-root `.mcp.json` (create it if
   absent). Use `${ENV_VAR}` placeholders for every secret — never a literal
   token. If `.mcp.json` already exists, show a diff and merge, don't clobber.

4. For each required env var, add an empty entry under `env` in
   `.claude/settings.local.json` (gitignored) and tell the user to fill it.
   For **github** (default on any git repo): prereq is the `gh` CLI — the user can
   generate `GITHUB_PERSONAL_ACCESS_TOKEN` with `gh auth token`. Surface any
   prereqs reported in the plan's `.mcp.json` rationale.

5. Remind the user to restart Claude Code so the servers load, and to keep the
   server count small (high-signal servers only).
