---
description: Install the suggested Claude Code plugins for this stack (code-review, hookify, feature-dev, frontend-design, context7, github, claude-code-setup + per-language LSP). One confirmation, then auto-installs.
argument-hint: "[path]"
allowed-tools:
  - Bash
  - Read
  - Edit
  - AskUserQuestion
---

# Install market plugins

Target directory: `$1` if provided, else `$CLAUDE_PROJECT_DIR`. Plugins install at
**user level** (Claude Code has no per-project plugin install).

## 0. Check system dependencies

```bash
"${CLAUDE_PLUGIN_ROOT}/bin/aia-harness" check "${1:-$CLAUDE_PROJECT_DIR}" --json
```

If `status === "block"`: present the list of `missing[]` with `installHint` for the user's platform and stop — do not execute the following steps.

1. Generate the plan and the runnable installer (writes `scripts/install-plugins.mjs`):

   ```bash
   "${CLAUDE_PLUGIN_ROOT}/bin/aia-harness" apply "${1:-$CLAUDE_PROJECT_DIR}" --yes --only=install-plugins
   ```

   (or run a full `/aia-harness:init` first). Inspect the suggested set:

   ```bash
   "${CLAUDE_PLUGIN_ROOT}/bin/aia-harness" plan "${1:-$CLAUDE_PROJECT_DIR}" --json
   ```

2. Present the suggested plugins grouped by purpose (development / quality /
   search / workflow), noting the per-language LSP and which are git-only.

3. Use `AskUserQuestion` to confirm installing them (single confirmation).

4. On approval, run the generated installer (idempotent; safe to re-run):

   ```bash
   node "${1:-$CLAUDE_PROJECT_DIR}/scripts/install-plugins.mjs" -y
   ```

   It runs `claude plugin marketplace add anthropics/claude-plugins-official` then
   `claude plugin install <name>@claude-plugins-official` for each suggested plugin.
   If the user wants a subset, edit `scripts/install-plugins.mjs` first or run the
   specific `claude plugin install` lines.

5. Remind: keep the active set high-signal, and **restart Claude Code** so the new
   plugins load.
