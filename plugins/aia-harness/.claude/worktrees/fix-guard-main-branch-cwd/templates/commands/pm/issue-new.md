---
description: Create a new GitHub issue and add it to the project board
argument-hint: "[description]"
allowed-tools: Bash(gh *), Bash(git *), Write
---

Config PM: !`cat .claude/pm-config.json 2>/dev/null || echo "NOT_FOUND"`
Remote: !`git remote get-url origin 2>/dev/null || echo "unknown"`

Use the `github-pm` skill to execute the issue creation workflow (Workflow 1).
For issue CRUD, the `github-issues` skill provides the necessary MCP tools.

If an argument is provided (`$ARGUMENTS`), use it as the initial issue title.
Confirm the title, type (bug/feature/task), and acceptance criteria with the user before creating.
