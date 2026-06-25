---
description: Work on a GitHub issue: set In Progress + worktree
argument-hint: "[issue-number]"
allowed-tools: Bash(gh *), Bash(git *)
---

Issue: !`gh issue view ${ARGUMENTS:-} --json number,title,labels,body 2>/dev/null || echo "NOT_FOUND"`
Config PM: !`cat .claude/pm-config.json 2>/dev/null || echo "NOT_FOUND"`
Existing worktrees: !`git worktree list 2>/dev/null`

Use the `github-pm` skill to execute the start work workflow (Workflow 2).
Issue number: `$ARGUMENTS`.

The skill will:

1. Read issue details
2. Suggest a branch name (type/N-slug)
3. Create a worktree in .claude/worktrees/
4. Move the issue to In Progress in Projects v2
5. Comment on the issue

## After completing the issue setup

Once the worktree is created and the issue is In Progress, invoke the
`superpowers:brainstorming` skill passing the full issue context:

```text
Issue #<N>: <title>
Labels: <labels>
Body:
<body>

Goal: generate a detailed implementation plan with technical approach,
architecture, files to create/modify, edge cases, and execution order.
```

The skill will produce a structured plan. Present the plan to the user and wait
for confirmation before starting implementation.

**When the user approves the plan**, use the `superpowers:writing-plans`
skill to record the plan, then begin implementation following the order
defined in the approved plan.
