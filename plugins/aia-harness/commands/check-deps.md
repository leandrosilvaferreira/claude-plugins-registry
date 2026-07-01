---
description: Check required system dependencies (Node, Python, Go, etc.) before harness operations.
argument-hint: "[path]"
allowed-tools:
  - Bash
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

4. If `status === "block"`:
   - Highlight the deps in `missing[]` and their `installHint[platform]`
   - Inform the user that **no harness operation can continue** until they are installed
   - Do not proceed to any next step

5. If `status === "ok"` or `"warn"`:
   - Confirm the environment is ready
   - If `warn`: mention absent recommended deps with their hints, but without blocking
