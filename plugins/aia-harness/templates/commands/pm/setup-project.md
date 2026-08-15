---
description: Link repo to GitHub Project and write pm-config.json
---

Auth status: !`gh auth status 2>&1 | head -8`
Remote: !`git remote get-url origin 2>/dev/null || echo "unknown"`
Current PM config: !`cat .claude/pm-config.json 2>/dev/null || echo "NOT_FOUND"`

Configure GitHub PM for this repository. Execute the following steps:

Use the `github-pm` skill to consult `references/pm-config-schema.md` for the pm-config.json schema.

1. Check authentication **and scopes** in the injected "Auth status" above.

   - Not logged in → tell the user to run `gh auth login` and stop.
   - Logged in → read the `Token scopes:` line. This pillar needs `repo`,
     `workflow`, `read:org`, `project` (plus the `admin:public_key`/`gist`
     defaults of the initial login). Anything missing means every Projects v2
     step below will fail with "token has not been granted the required
     scopes", so stop and give the user this command verbatim:

     ```bash
     gh auth refresh -h github.com -s admin:public_key,gist,project,read:org,repo,workflow
     ```

     It adds scopes without revoking existing ones. Ask them to confirm with
     `gh auth status` and re-run `/pm:setup-project`.
   - If the scopes line is absent but the user appears logged in, check whether
     `GH_TOKEN` or `GITHUB_TOKEN` is set in their environment — `gh` prefers it
     over the keyring account, and a fine-grained PAT publishes no scopes header.
     Tell them to `unset GH_TOKEN GITHUB_TOKEN` and re-run.

   Never work around missing scopes by setting `GH_TOKEN` or by generating a
   personal access token in the GitHub web UI.

2. Extract owner and repo from the remote URL.

3. List available projects:

   ```bash
   gh project list --owner <owner> --format json --limit 20
   ```

   Ask the user to pick one via the **AskUserQuestion** tool — one option per
   listed project (label `#<number> <title>`); the tool's free-text "Other"
   fallback covers a number not listed.

4. Fetch IDs via GraphQL. `repositoryOwner` resolves both organization- and user-owned
   projects in one query (a plain `user(login:)` query returns `null` for an
   organization, which is the common case for a team project):

   ```bash
   gh api graphql -f query='
     query($owner: String!, $num: Int!) {
       repositoryOwner(login: $owner) {
         ... on Organization {
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
         ... on User {
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
       }
     }' -F owner=<owner> -F num=<project_number>
   ```

   Both inline fragments produce `projectV2` at the same shape, so extraction is uniform
   regardless of ownership type: `.data.repositoryOwner.projectV2...`. If
   `.data.repositoryOwner` itself is `null`, the owner login does not exist or the
   authenticated token cannot see it — stop and tell the user, do not proceed with a
   partially-written config.

   Identify the "Status" field and extract IDs for each of the 8 options: `Triage`,
   `Backlog`, `Todo`, `Ready`, `In Progress`, `In Review`, `Blocked`, `Done`.

5. Write `.claude/pm-config.json` with the real IDs. Use the Write tool.

6. Check if `PROJECTS_PAT` exists as a repo secret:

   ```bash
   gh secret list --repo <owner>/<repo> 2>/dev/null | grep PROJECTS_PAT || echo "NOT_SET"
   ```

   If NOT_SET → give the user this command verbatim:

   ```bash
   gh secret set PROJECTS_PAT --repo <owner>/<repo> --body "$(gh auth token)"
   ```

   This reuses the token whose scopes step 1 already verified, so there is no
   trip to github.com/settings/tokens. The secret is still needed even though
   the local `gh` session is fine: GitHub Actions run without a user session,
   and the default Actions `GITHUB_TOKEN` has no `project` scope, so the four
   workflow files cannot move Project items without it.

   Mention that this ties the Actions secret to the user's personal login — if
   they would rather keep it independently revocable, a dedicated PAT with
   `repo` + `project` scopes works identically.

7. Confirm: "GitHub PM configured. Run `/pm:backlog` to view the backlog."
