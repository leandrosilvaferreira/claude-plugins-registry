---
description: Safely merge a PR — validates CI before merging
argument-hint: "[pr-or-issue-number]"
allowed-tools: Bash(gh *), Bash(git *), Bash(bash *), Bash(python3 *)
---

Config PM: !`cat .claude/pm-config.json 2>/dev/null || echo "NOT_FOUND"`
Current branch: !`git branch --show-current`

Use the `github-pm` skill to execute the safe merge. The `$ARGUMENTS`
argument can be a PR number or an issue number.

**NEVER skip the gates below. This is the mandatory sequence:**

**Step 1 — Identify PR**

- Try directly as a PR number: `gh pr view $ARGUMENTS --json number`
- If it fails: look for a PR with branch `feat/$ARGUMENTS-*` or body with `Closes #$ARGUMENTS`

  ```bash
  gh pr list --json number,headRefName,body | python3 -c "
  import sys,json; prs=json.load(sys.stdin)
  n=int('$ARGUMENTS')
  for p in prs:
    if f'/{n}-' in p['headRefName'] or f'#{n}' in p.get('body',''):
      print(p['number']); break
  "
  ```

**Step 2 — Check draft status**

```bash
gh pr view $PR_NUMBER --json isDraft --jq '.isDraft'
```

If true → ask the user if it should be marked as ready:

```bash
gh pr ready $PR_NUMBER
```

Then wait for CI: `gh pr checks $PR_NUMBER --watch`

**Step 3 — Authoritative gate (ALWAYS run, NEVER skip)**

```bash
node .claude/skills/github-pm/scripts/check-pr-status.mjs $PR_NUMBER <OWNER>/<REPO>
```

- Exit 0 → proceed
- Exit 1 → BLOCK. List failures, do not merge.
- Exit 2 → ask if waiting (`gh pr checks $PR_NUMBER --watch`), re-run gate
- Exit 3 → STOP (invalid PR)
- Exit 4 → warn "CI green but no approved review". Ask if proceeding anyway.

**Step 4 — Detect merge strategy**

```bash
gh repo view --json squashMergeAllowed,rebaseMergeAllowed,mergeCommitAllowed \
  --jq 'if .squashMergeAllowed then "--squash" elif .rebaseMergeAllowed then "--rebase" else "--merge" end'
```

**Step 5 — Merge**

```bash
gh pr merge $PR_NUMBER $MERGE_FLAG --delete-branch
```

If exit ≠ 0 → report the exact error, STOP without post-merge.

**Step 6 — Post-merge (only if merge exit 0)**

- Comment on the issue: "PR #$PR_NUMBER merged ✅"
- Close the issue: `gh issue close $ISSUE_NUMBER --repo <OWNER>/<REPO>`
- Move to Done in Projects v2 (use pm-config.json)

**Step 7 — Cleanup**

- If in a worktree → ask: "Do you want to remove the worktree? (`/pm:worktree-remove`)"
- If on the main checkout: `git checkout main && git pull --ff-only`

CRITICAL RULES (never violate):

- NEVER `gh pr merge` without the Step 3 gate with exit 0 (or exit 4 + explicit confirmation)
- NEVER close the issue before confirming merge exit 0
- NEVER `--admin` without explicit request + double confirmation
