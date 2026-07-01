# Workflow 2: Work on an issue

## Preconditions

- Issue exists and is in Backlog
- `pm-config.json` available

## Step by step

1. Read issue details:

   ```bash
   gh issue view <N> --json title,labels,body --repo <owner>/<repo>
   ```

2. Generate branch slug: `type/N-title-in-kebab-case`
   - type: `feat` (feature/enhancement), `fix` (bug), `chore` (task/infra), `docs`
   - Limit to 60 chars; special characters → `-`
   - Example: `feat/42-add-payment-flow`

3. Confirm the branch name with the user.

4. Create worktree (preferably via `/pm:worktree-new <N>`):

   ```bash
   git worktree add .claude/worktrees/<SLUG> -b <SLUG>
   ```

5. Move issue to In Progress in Projects v2 (use IDs from pm-config.json):

   ```bash
   # GraphQL mutation — see pm-config-schema.md for fields
   gh api graphql -f query='mutation {
     updateProjectV2ItemFieldValue(input: {
       projectId: "<project_id>"
       itemId: "<item_id>"
       fieldId: "<status_field_id>"
       value: { singleSelectOptionId: "<In Progress option ID>" }
     }) { projectV2Item { id } }
   }'
   ```

6. Comment on the issue: "🤖 Starting work on branch `<SLUG>`"

## Invariants

- NEVER create branch directly on main without `-b`
- If worktree already exists for the slug → ask if re-opening
