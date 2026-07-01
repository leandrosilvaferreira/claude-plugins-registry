---
description: Scan the current project and print a Claude Code harness diagnosis (read-only, writes nothing).
argument-hint: "[path]"
allowed-tools:
  - Bash
  - Read
---

# Diagnose the project's harness readiness

Run the deterministic scanner and present the result. This command is read-only.

## 0. Check system dependencies

```bash
node "${CLAUDE_PLUGIN_ROOT}/bin/harness.mjs" check "${1:-$CLAUDE_PROJECT_DIR}" --json
```

Read the returned JSON. If `status === "block"`: present the list of `missing[]`
with `installHint` for the user's platform and stop — do not execute the following steps.

1. Determine the target directory: `$1` if provided, otherwise `$CLAUDE_PROJECT_DIR`.

   <!-- aia-harness:target-dir-resolution -->
   Resolve this **once**, at the start, into a concrete literal absolute path.
   `$CLAUDE_PROJECT_DIR` is documented as available "when hooks are executed" but is not
   guaranteed inside the general-purpose Bash tool used to run these instructions — it can
   silently expand empty there, and the CLI then falls back to the shell's *current* working
   directory, which is wrong if the agent has since `cd`'d elsewhere (e.g. into the scratchpad
   for intermediate file work). Reuse that one resolved literal path in every subsequent CLI
   invocation for the rest of this command — never re-expand a bare `$CLAUDE_PROJECT_DIR` in a
   later, separately-issued Bash call, since each Bash tool call is a fresh shell (only cwd
   persists, not exported variables) and an earlier `cd` silently redirects any later
   bare-env-var fallback to the wrong place.

2. Run:

   ```bash
   node "${CLAUDE_PLUGIN_ROOT}/bin/harness.mjs" scan "${1:-$CLAUDE_PROJECT_DIR}"
   ```

3. Present the diagnosis to the user: primary language, stack,
   package manager, frameworks, monorepo, canonical commands, architecture
   domains, and any existing harness artifacts.
4. If `profile.githubPM.detected` is true, add a "GitHub PM" section to the report:
   - Remote: github.com detected ✓
   - Issue templates: present / absent
   - Workflows: present / absent
   - pm-config.json: configured / not configured
   - Suggest `/add-github-pm` if not yet installed.

5. **Graphify git hooks:** If `profile.vcs.isGit` is true **and** a `graphify-out/` directory exists in the target project (indicating graphify has been initialized):
   - `profile.existingHarness.graphifyGitHooks.postCommit: true` → ✅ post-commit hook installed
   - `profile.existingHarness.graphifyGitHooks.postCommit: false` → ⚠ post-commit hook not installed
   - `profile.existingHarness.graphifyGitHooks.postCheckout: true` → ✅ post-checkout hook installed
   - `profile.existingHarness.graphifyGitHooks.postCheckout: false` → ⚠ post-checkout hook not installed

   If either hook is missing, suggest: "Run `/aia-harness:doctor` to install the graphify hooks."
   If `graphify-out/` does not exist (graphify not initialized) or not a git repo, omit this section silently.

## 6. Harness drift (only if already configured)

If the project already has the harness installed (gate: `existingHarness.claudeMd === true` in
the scan JSON), run a dry-run apply to detect drift (omitting `--yes` keeps this read-only — no
files are written):

```bash
node "${CLAUDE_PLUGIN_ROOT}/bin/harness.mjs" apply "${1:-$CLAUDE_PROJECT_DIR}" --json
```

Parse the returned JSON `differs[]` array. If it is non-empty:

- For each unique category in `differs[]`, print one line: `"N <category> artifact(s) are out of date vs the current plugin version."`
- Also grep the root `CLAUDE.md` file for the marker `aia-harness:agent-routing`. If the marker
  is absent **and** `.claude/agents/*.md` files exist in the target project (derive "agents exist"
  from disk: `ls "${1:-$CLAUDE_PROJECT_DIR}/.claude/agents/"*.md 2>/dev/null`), note:
  `"⚠ Superpowers bridge (aia-harness:agent-routing) is missing from CLAUDE.md while agents exist."`

Then point the user to:

- `/aia-harness:doctor` for guided fixes of out-of-date artifacts
- `/aia-harness:patch` to selectively force-overwrite specific categories

If `differs[]` is empty and the bridge marker is present (or no agents exist), omit this section
silently.

Do **not** write any files. If the user wants to scaffold the harness, point them to
`/aia-harness:init`.

If the scanner cannot find Node.js, tell the user to install Node 18+ or set
`CLAUDE_NODE`, and offer to run the diagnosis manually instead.
