---
name: gh-pr-token-404
description: gh PR/API returns 404 for this repo (token scope); use SSH git for push/merge
metadata:
  type: reference
---

`gh pr create` / `gh repo view leandrosilvaferreira/aia_harness` / `gh api repos/leandrosilvaferreira/aia_harness` all fail with **404 "Could not resolve to a Repository"**, even though `git push` over SSH works fine.

**Why:** `gh` authenticates via a fine-grained `GITHUB_TOKEN` PAT whose repo-access list does not include `aia_harness` (fine-grained PATs return 404 — not 403 — for repos out of scope, to avoid leaking existence). SSH push uses the SSH key, which has full access, so git operations succeed while the GitHub **API** path is blind. Clearing `GITHUB_TOKEN` to fall back to the keyring oauth account did **not** help.

**How to apply:** Don't try to open PRs or use `gh api`/`gh repo` for this repo — they will 404. Do push/merge/tag with plain **git over SSH** (`git push origin main`, `git merge --no-ff`, `git tag`). To open a PR, either the user does it in the GitHub UI on the already-pushed branch, or the PAT must be re-scoped to include this repo. Releases go through [[publish-registry-command]] (git/SSH based), which works.
