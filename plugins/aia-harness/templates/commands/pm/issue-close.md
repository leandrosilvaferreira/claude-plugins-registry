---
description: Close an issue after validating acceptance criteria
argument-hint: "[issue-number]"
---

Issue: !`gh issue view $ARGUMENTS --json number,title,body,state 2>/dev/null || echo "NOT_FOUND"`
Config PM: !`cat .claude/pm-config.json 2>/dev/null || echo "NOT_FOUND"`

Use the `github-pm` skill to execute the issue closing workflow (Workflow 3).
Issue number: `$ARGUMENTS`.

MANDATORY: validate acceptance criteria in the body before closing. Never close without this validation.
