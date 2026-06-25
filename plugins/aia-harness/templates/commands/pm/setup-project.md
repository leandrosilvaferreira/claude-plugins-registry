---
description: Link repo to GitHub Project and write pm-config.json
allowed-tools: Bash(gh *), Bash(git *), Write
---

Auth status: !`gh auth status 2>&1 | head -5`
Remote: !`git remote get-url origin 2>/dev/null || echo "unknown"`
Current PM config: !`cat .claude/pm-config.json 2>/dev/null || echo "NOT_FOUND"`

Configure GitHub PM for this repository. Execute the following steps:

Use the `github-pm` skill to consult `references/pm-config-schema.md` for the pm-config.json schema.

1. Check authentication: `gh auth status`. If not authenticated → `gh auth login` and stop.

2. Extract owner and repo from the remote URL.

3. List available projects:

   ```bash
   gh project list --owner <owner> --format json --limit 20
   ```

   Present to the user and ask them to select the project number.

4. Fetch IDs via GraphQL:

   ```bash
   gh api graphql -f query='
     query($owner: String!, $num: Int!) {
       user(login: $owner) {
         projectV2(number: $num) {
           id
           fields(first: 20) {
             nodes {
               ... on ProjectV2SingleSelectField {
                 id name options { id name }
               }
             }
           }
         }
       }
     }' -F owner=<owner> -F num=<project_number>
   ```

   Identify the "Status" field and extract IDs for each option
   (Triage, Backlog, In Progress, In Review, Done).

5. Write `.claude/pm-config.json` with the real IDs. Use the Write tool.

6. Check if `PROJECTS_PAT` exists as a repo secret:

   ```bash
   gh secret list --repo <owner>/<repo> 2>/dev/null | grep PROJECTS_PAT || echo "NOT_SET"
   ```

   If NOT_SET → instruct: "Create a PAT with `repo` and `project` scopes at
   github.com/settings/tokens, then run: `gh secret set PROJECTS_PAT --repo <owner>/<repo>`"

7. Confirm: "GitHub PM configured. Run `/pm:backlog` to view the backlog."
