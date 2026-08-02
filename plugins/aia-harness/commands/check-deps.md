---
description: Check required system dependencies (Node, Python, Go, etc.) before harness operations.
argument-hint: "[path]"
allowed-tools:
  - Bash
  - AskUserQuestion
---

# Check system dependencies

Target directory: `$1` if provided, else `$CLAUDE_PROJECT_DIR`.

<!-- aia-harness:target-dir-resolution -->
Resolve this **once**, at the
start of this command, into a concrete literal absolute path. `$CLAUDE_PROJECT_DIR` is documented
as available "when hooks are executed" but is not guaranteed inside the general-purpose Bash tool
used to run these instructions — it can silently expand empty there, and the CLI then falls back
to the shell's *current* working directory, which is wrong if the agent has since `cd`'d elsewhere
(e.g. into the scratchpad for intermediate file work). Reuse that one resolved literal path in
every subsequent CLI invocation below — never re-expand a bare `$CLAUDE_PROJECT_DIR` in a later,
separately-issued Bash call, since each Bash tool call is a fresh shell (only cwd persists, not
exported variables) and an earlier `cd` silently redirects any later bare-env-var fallback to the
wrong place.

<!-- aia-harness:version-check -->
## Before anything else — plugin version check

```bash
node "${CLAUDE_PLUGIN_ROOT}/bin/harness.mjs" version-check --json
```

Read `status` from the JSON:

- `"stale"` — report `running` → `latest`, then `AskUserQuestion`: **Update now** (run the
  returned `updateCommand`, then stop and tell the user to run `/reload-plugins` or start a new
  session and re-issue this command — a running plugin copy cannot hot-swap itself) or
  **Continue on the current version** (go straight to the next step).
- `"current"` or `"unknown"` — say nothing, continue.

This check never blocks: it exits 0 even when it cannot reach the registry, and `"unknown"`
means the answer is unavailable, not that something is wrong.
<!-- /aia-harness:version-check -->

1. Run the checker:

   ```bash
   node "${CLAUDE_PLUGIN_ROOT}/bin/harness.mjs" check "${1:-$CLAUDE_PROJECT_DIR}" --json
   ```

2. Detect the user's platform from the `process.platform` field in the JSON
   (or via `node -e "console.log(process.platform)"`).

3. Present the report:
   - **Detected platform:** darwin / linux / win32
   - For each dep in `checks[]`:
     - `✓ <name>  v<version>   <resolvedPath>` if `found: true`
     - `✗ <name>  not found  [<level>]` + install hint for the platform if `found: false`
   - **Overall status:** ok / warn / block

If the payload carries a `ghAuth` object, present it after the dependency list:

- `available: false` → `gh` was found on disk but could not be executed (a
  corrupt binary, a permission problem, or a non-functional shim). Nothing
  else about its auth state could be determined, so ignore `missing` here —
  it is an artifact of the failure, not a finding — and report only this.
  Tell the user to verify the installation themselves by running
  `gh --version`. Never suggest `gh auth refresh` or `gh auth login` —
  neither can fix a binary that will not start.
- `envTokenOverride: true` → report that `GH_TOKEN`/`GITHUB_TOKEN` is set in the
  environment, that `gh` prefers it over the keyring login, and that
  `gh auth refresh` cannot change its permissions. Fix:
  `unset GH_TOKEN GITHUB_TOKEN`.
- otherwise, `authenticated: false` → `gh` is installed but not logged in.
  Give the user this command verbatim to run in their own terminal, with
  `ghAuth.missing` joined by commas in place of `<scopes>`:
  `gh auth login -h github.com -s <scopes>`. Never suggest `GH_TOKEN` or a
  personal access token instead. Never offer to run this yourself —
  `gh auth login` is an interactive browser flow, always the user's to run.
- otherwise, `missing` non-empty → list the missing scopes and give `ghAuth.refreshCmd`
  verbatim for the user to run in their own terminal. It adds scopes without
  revoking existing ones; confirm with `gh auth status`. Never suggest setting
  `GH_TOKEN` or creating a personal access token in the GitHub web UI instead.
  Never offer to run this yourself — `gh auth refresh` is an interactive
  browser flow, always the user's to run.
- otherwise → confirm the gh login carries the scopes this project needs.

Missing scopes never change the overall status and never stop the command.

4. If `status === "block"`:
   - Highlight the deps in `missing[]` and their `installHint[platform]`
   - Inform the user that **no harness operation can continue** until they are installed
   - Do not proceed to any next step

5. If `status === "ok"` or `"warn"`:
   - Confirm the environment is ready
   - If `warn`: mention absent recommended deps with their hints, but without blocking
