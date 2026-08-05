---
description: Safely merge a PR — validates CI before merging
argument-hint: "[pr-or-issue-number]"
allowed-tools: Bash(gh *), Bash(git *), Bash(bash *), Bash(python3 *), AskUserQuestion
---

Config PM: !`cat .claude/pm-config.json 2>/dev/null || echo "NOT_FOUND"`
Current branch: !`git branch --show-current`

Use the `github-pm` skill to execute the safe merge. The `$ARGUMENTS`
argument can be a PR number or an issue number.

**Worktree-safe execution:** run every `git`/`gh` command below as its own
separate, plain Bash call — never chain two of them with `&&`, `;`, or `$(...)`
command substitution. A worktree-isolated session refuses any command it cannot
statically verify stays inside the worktree, and a compound git invocation is
exactly what gets refused. Every `<PLACEHOLDER>` below is a value **you**
substitute literally into the command before running it — never a shell
variable. A shell variable does not survive from one Bash call to the next, so
`gh pr merge $PR_NUMBER $MERGE_FLAG --delete-branch` with both unset silently
degrades to `gh pr merge --delete-branch`, which merges whatever PR the current
branch happens to point at, with the default strategy. (`$ARGUMENTS` is the one
exception: it is a Claude Code command placeholder the loader substitutes before
the command ever runs.)

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
gh pr view <PR_NUMBER> --json isDraft --jq '.isDraft'
```

If true → ask via the **AskUserQuestion** tool ("PR is a draft — mark it
ready?", options "Mark ready" / "Keep as draft, stop"). If they choose to mark
it ready:

```bash
gh pr ready <PR_NUMBER>
```

Then wait for CI: `gh pr checks <PR_NUMBER> --watch`

**Step 3 — Authoritative gate (ALWAYS run, NEVER skip)**

```bash
node .claude/skills/github-pm/scripts/check-pr-status.mjs <PR_NUMBER> <OWNER>/<REPO>
```

- Exit 0 → proceed
- Exit 1 → BLOCK. List failures, do not merge.
- Exit 2 → ask via **AskUserQuestion** ("CI still running — wait for it?", options "Wait" / "Stop"); if Wait → `gh pr checks <PR_NUMBER> --watch`, then re-run the gate
- Exit 3 → STOP (invalid PR)
- Exit 4 → warn "CI green but no approved review". Ask via **AskUserQuestion** ("Merge without an approved review?", options "Merge anyway" / "Stop") before any merge.

**Step 4 — Detect merge strategy**

This prints one of `--squash` / `--rebase` / `--merge`. That printed string is
`<MERGE_FLAG>` in Step 5 — substitute it literally there.

```bash
gh repo view --json squashMergeAllowed,rebaseMergeAllowed,mergeCommitAllowed --jq 'if .squashMergeAllowed then "--squash" elif .rebaseMergeAllowed then "--rebase" else "--merge" end'
```

**Step 5 — Merge**

```bash
gh pr merge <PR_NUMBER> <MERGE_FLAG> --delete-branch
```

If exit ≠ 0 → report the exact error, STOP without post-merge.

**Step 6 — Post-merge (only if merge exit 0)**

- Comment on the issue: "PR #<PR_NUMBER> merged ✅"
- Close the issue: `gh issue close <ISSUE_NUMBER> --repo <OWNER>/<REPO>`
- Move to Done in Projects v2 (use pm-config.json)

**Step 7 — Cleanup**

- If in a worktree → ask via **AskUserQuestion** ("Remove the worktree now?", options "Remove (`/pm:worktree-remove`)" / "Keep it")
- If on the main checkout, refresh it with two separate Bash calls (not joined
  by `&&`), where `<DEFAULT_BRANCH>` is the repository's default branch — `main`
  on most repos, `master` on older ones:

  ```bash
  git checkout <DEFAULT_BRANCH>
  ```

  ```bash
  git pull --ff-only
  ```

CRITICAL RULES (never violate):

- NEVER `gh pr merge` without the Step 3 gate with exit 0 (or exit 4 + explicit confirmation)
- NEVER close the issue before confirming merge exit 0
- NEVER `--admin` without explicit request + double confirmation
