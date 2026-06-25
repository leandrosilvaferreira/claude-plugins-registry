---
description: Parallel code review of a PR using subagents
argument-hint: "[pr-number]"
allowed-tools: Bash(gh *), Bash(bash *), Bash(python3 *)
---

Config PM: !`cat .claude/pm-config.json 2>/dev/null || echo "NOT_FOUND"`
PR info: !`gh pr view ${ARGUMENTS:-} --json number,title,state,isDraft,headRefName,body 2>/dev/null || echo "NOT_FOUND"`
Diff stat: !`gh pr diff ${ARGUMENTS:-} --stat 2>/dev/null || echo "NOT_FOUND"`

Use the `github-pm` skill to execute the parallel code review.
PR number: `$ARGUMENTS`.

**Mandatory sequence:**

1. **Haiku agent** → eligibility: is the PR closed? Already reviewed with no pending fixes? Automated?
   If not eligible → report reason and stop.

2. **Haiku agent** → list relevant CLAUDE.md files from the codebase.

3. **Haiku agent** → summary of PR changes (files, purpose, scope).

4. **6 Sonnet agents in parallel** (single dispatch, not sequential):
   - #1: Compliance with the project's CLAUDE.md
   - #2: Bug scan on modified lines (diff only, not the entire file)
   - #3: Git blame and history of modified files
   - #4: Previous PRs that touched the same files
   - #5: Inline comments in modified files (TODO, FIXME, HACK)
   - #6: Over-engineering, YAGNI, duplications, unnecessary abstractions

5. For each issue found: **Haiku scoring agent** (0-100).
   Criteria: severity, certainty, user impact.

6. Filter: keep only issues with score ≥ 60.

7. **Re-check eligibility** (Haiku): was any issue already fixed between steps?

8. Post result to the PR:

   ```bash
   gh pr comment $ARGUMENTS --body "<formatted result with file:sha#L links>"
   ```

   Format: no emojis; links `owner/repo/blob/<sha>/<file>#L<line>`; grouped by severity.

9. Terminal message:
   - Issues found → "To fix automatically: `/orchestrate`"
   - No issues + CI green → "PR ready to merge: `/pm:pr-merge $ARGUMENTS`"
   - No issues + CI pending/failing → report and do not suggest merge
