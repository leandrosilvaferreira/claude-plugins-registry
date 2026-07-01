---
description: Create worktree for issue with auto-named branch
argument-hint: "[issue-number]"
allowed-tools: Bash(gh *), Bash(git *), AskUserQuestion
---

Issue: !`gh issue view ${ARGUMENTS:-} --json number,title,labels 2>/dev/null || echo "NOT_FOUND"`
Config PM: !`cat .claude/pm-config.json 2>/dev/null || echo "NOT_FOUND"`
Existing worktrees: !`git worktree list 2>/dev/null`
Current branch: !`git branch --show-current`

Use the `github-pm` skill to execute the worktree creation workflow:

1. Read `gh issue view $ARGUMENTS --json title,labels` to determine the type and title.
2. Generate slug: type/N-title-in-kebab-case (max 60 chars; special chars → `-`)
   - type: `feat` (feature/enhancement), `fix` (bug), `chore` (task), `docs`
   - Example: `feat/42-add-payment-flow`
3. Confirm the branch name with the user via AskUserQuestion.
4. If a worktree already exists for the slug → warn and ask if it should be reopened.
5. Create the worktree:

   ```bash
   git worktree add .claude/worktrees/<SLUG> -b <SLUG>
   ```

6. Enter the worktree via EnterWorktree (if available) or instruct the user.
7. Comment on the issue: "🤖 Worktree created: branch `<SLUG>`"
8. Move the issue to In Progress in Projects v2 (use pm-config.json).

RULES:

- NEVER create without `-b <SLUG>` (always a new branch)
- NEVER branch off main without creating a separate branch
