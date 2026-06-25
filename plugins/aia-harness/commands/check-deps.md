---
description: Check required system dependencies (Node, Python, Go, etc.) before harness operations.
argument-hint: "[path]"
allowed-tools:
  - Bash
---

# Check system dependencies

Target directory: `$1` if provided, else `$CLAUDE_PROJECT_DIR`.

1. Run the checker:

   ```bash
   "${CLAUDE_PLUGIN_ROOT}/bin/aia-harness" check "${1:-$CLAUDE_PROJECT_DIR}" --json
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
