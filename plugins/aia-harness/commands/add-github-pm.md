---
description: Add GitHub PM pillar to an existing harness
argument-hint: "[path]"
allowed-tools:
  - Bash
  - AskUserQuestion
---

# Add GitHub PM to an existing harness

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

Activate the GitHub PM pillar (issues, Projects v2, commands, workflows) in a project
that already has the harness configured. Analogous to `/add-mcp` and `/add-tools`.

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

## Flow

1. **Scan** the project to check detection:

   ```bash
   node "${CLAUDE_PLUGIN_ROOT}/bin/harness.mjs" scan "${1:-$CLAUDE_PROJECT_DIR}" --json
   ```

   Parse `profile.githubPM.detected`. If `false`:
   → "Remote URL is not github.com — GitHub PM is not applicable to this project." Stop.

2. **Plan** (GitHub PM category only):

   ```bash
   node "${CLAUDE_PLUGIN_ROOT}/bin/harness.mjs" plan "${1:-$CLAUDE_PROJECT_DIR}" --json
   ```

   Filter artifacts with `category === 'github-pm'`. Collect the `id` fields of those
   with **`exists: false`** into a comma-separated string (e.g.
   `"github-pm:skill,github-pm:commands,..."`). Show the list with rationale.

   Collect only the missing ones. An artifact of this category that already exists
   would either be identical (skipped) or exist-and-differ, and merging is now the
   default, so a differing one is never written — it would be staged in `conflicts[]`
   for adjudication instead, which is `/aia-harness:patch`'s job, not this command's.
   Report any `github-pm` artifact with `exists: true` that the user may want
   refreshed and point them at `/aia-harness:patch` for the merge-and-adjudicate
   flow. If **no** artifact has `exists: false`, the pillar is already fully
   installed — say so and stop.

3. **Confirm** with `AskUserQuestion`:
   "Install GitHub PM artifacts? (skill, 10 commands, issue templates, 4 workflows, pm-config template)"
   Options: "Yes, install" / "No, cancel"

4. **Dry run preview** then **apply** using the IDs collected in step 2:

   ```bash
   node "${CLAUDE_PLUGIN_ROOT}/bin/harness.mjs" apply "${1:-$CLAUDE_PROJECT_DIR}" --yes --only=<comma-joined IDs from step 2> --json
   ```

   Merging is now the default, but it never engages here: every id passed comes from
   the `exists: false` bucket in step 2, so the file each one targets is always absent
   — the exists-and-differs branch that merging changes can never fire. This call only
   ever creates.

   Read the JSON anyway and check `conflicts[]` before reporting success. It should be
   empty; if it is not, the target changed between the `plan` in step 2 and this call,
   and those entries are staged at `.claude/.aia-harness-pending/` with nothing in this
   command to resolve them. Adjudicate each one with **`patch.md` section 7 ("Adjudicate
   each conflict")** — `Read` `${CLAUDE_PLUGIN_ROOT}/commands/patch.md` and follow that
   section as written rather than improvising a diff review here; its three preconditions
   are satisfied by this call, the `plan … --json` in step 2, and the target path
   resolved above. Remove the staging directory as that command's step 8 describes once
   every conflict has an answer, and do not claim the pillar is installed until then.

5. **Post-install instructions:**
   "GitHub PM installed. Next step: run `/pm:setup-project` to configure
   the Project ID and status IDs for Projects v2."
