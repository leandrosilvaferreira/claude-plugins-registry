---
description: Add GitHub PM pillar to an existing harness
argument-hint: "[path]"
allowed-tools:
  - Bash
  - AskUserQuestion
---

# Add GitHub PM to an existing harness

Target directory: `$1` if provided, else `$CLAUDE_PROJECT_DIR`.

Activate the GitHub PM pillar (issues, Projects v2, commands, workflows) in a project
that already has the harness configured. Analogous to `/add-mcp` and `/add-tools`.

## Flow

1. **Scan** the project to check detection:

   ```bash
   "${CLAUDE_PLUGIN_ROOT}/bin/aia-harness" scan "${1:-$CLAUDE_PROJECT_DIR}" --json
   ```

   Parse `profile.githubPM.detected`. If `false`:
   → "Remote URL is not github.com — GitHub PM is not applicable to this project." Stop.

2. **Plan** (GitHub PM category only):

   ```bash
   "${CLAUDE_PLUGIN_ROOT}/bin/aia-harness" plan "${1:-$CLAUDE_PROJECT_DIR}" --json
   ```

   Filter artifacts with `category === 'github-pm'`. Collect their `id` fields into a
   comma-separated string (e.g. `"github-pm:skill,github-pm:commands,..."`).
   Show the list with rationale.

3. **Confirm** with `AskUserQuestion`:
   "Install GitHub PM artifacts? (skill, 10 commands, issue templates, 4 workflows, pm-config template)"
   Options: "Yes, install" / "No, cancel"

4. **Dry run preview** then **apply** using the IDs collected in step 2:

   ```bash
   "${CLAUDE_PLUGIN_ROOT}/bin/aia-harness" apply "${1:-$CLAUDE_PROJECT_DIR}" --yes --only=<comma-joined IDs from step 2>
   ```

5. **Post-install instructions:**
   "GitHub PM installed. Next step: run `/pm:setup-project` to configure
   the Project ID and status IDs for Projects v2."
