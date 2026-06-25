# Workflow 3: Close issue / mark as Done

## Preconditions

- PR merged (auto-close-issue.yml closes automatically; this workflow is manual)
- Or: work completed without PR (e.g.: infra, documentation)

## Step by step

1. Read issue body and verify acceptance criteria:

   ```bash
   gh issue view <N> --json body,title --repo <owner>/<repo>
   ```

2. Confirm with the user which criteria were met.

3. If all criteria met:

   ```bash
   gh issue close <N> --comment "Completed. [describe what was done]" \
     --repo <owner>/<repo>
   ```

4. Move to Done in Projects v2 (IDs from pm-config.json):

   ```bash
   gh api graphql -f query='mutation { updateProjectV2ItemFieldValue(input: {
     projectId: "<project_id>" itemId: "<item_id>" 
     fieldId: "<status_field_id>"
     value: { singleSelectOptionId: "<Done option ID>" }
   }) { projectV2Item { id } } }'
   ```

5. If in worktree → ask if removing with `/pm:worktree-remove`.

## Invariant

- NEVER close without validating acceptance criteria. If criteria were not defined in the issue,
  define them together with the user before closing.
