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

<!-- aia-harness:target-dir-resolution -->
Resolve the target directory **once**, at the start of this command, into a concrete literal
absolute path. `$CLAUDE_PROJECT_DIR` is documented as available "when hooks are executed" but is
not guaranteed inside the general-purpose Bash tool used to run these instructions — it can
silently expand empty there, and the CLI then falls back to the shell's *current* working
directory, which is wrong if the agent has since `cd`'d elsewhere (e.g. into the scratchpad for
intermediate file work). Reuse that one resolved literal path in every subsequent CLI invocation
below — never re-expand a bare `$CLAUDE_PROJECT_DIR` in a later, separately-issued Bash call,
since each Bash tool call is a fresh shell (only cwd persists, not exported variables) and an
earlier `cd` silently redirects any later bare-env-var fallback to the wrong place.

## 0. Check system dependencies

```bash
node "${CLAUDE_PLUGIN_ROOT}/bin/harness.mjs" check "${1:-$CLAUDE_PROJECT_DIR}" --json
```

If `status === "block"`: present the list of `missing[]` with `installHint` for the user's platform and stop — do not execute the following steps.

1. Generate the plan and the runnable installer (writes `scripts/install-plugins.mjs`):

   ```bash
   node "${CLAUDE_PLUGIN_ROOT}/bin/harness.mjs" apply "${1:-$CLAUDE_PROJECT_DIR}" --yes --only=install-plugins
   ```

   (or run a full `/aia-harness:init` first). Inspect the suggested set:

   ```bash
   node "${CLAUDE_PLUGIN_ROOT}/bin/harness.mjs" plan "${1:-$CLAUDE_PROJECT_DIR}" --json
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
