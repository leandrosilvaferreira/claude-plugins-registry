---
description: Create a new GitHub issue and add it to the project board
argument-hint: "[description]"
---

Config PM: !`cat .claude/pm-config.json 2>/dev/null || echo "NOT_FOUND"`
Remote: !`git remote get-url origin 2>/dev/null || echo "unknown"`

Use the `github-pm` skill to execute the issue creation workflow (Workflow 1).
For issue CRUD, the `github-issues` skill provides the necessary MCP tools.

If an argument is provided (`$ARGUMENTS`), use it as the initial issue title.

Before creating, confirm the details with the user via the **AskUserQuestion**
tool: the issue **type** as a choice ("bug" / "feature" / "task"), and the
**title** and **acceptance criteria** (use the tool's free-text "Other" option
to capture or adjust them). Only create the issue once confirmed.
