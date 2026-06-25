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
"${CLAUDE_PLUGIN_ROOT}/bin/aia-harness" check "${1:-$CLAUDE_PROJECT_DIR}" --json
```

Read the returned JSON. If `status === "block"`: present the list of `missing[]`
with `installHint` for the user's platform and stop — do not execute the following steps.

1. Determine the target directory: `$1` if provided, otherwise `$CLAUDE_PROJECT_DIR`.
2. Run:

   ```bash
   "${CLAUDE_PLUGIN_ROOT}/bin/aia-harness" scan "${1:-$CLAUDE_PROJECT_DIR}"
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

6. Do **not** write any files. If the user wants to scaffold the harness,
   point them to `/aia-harness:init`.

If the scanner cannot find Node.js, tell the user to install Node 18+ or set
`CLAUDE_NODE`, and offer to run the diagnosis manually instead.
