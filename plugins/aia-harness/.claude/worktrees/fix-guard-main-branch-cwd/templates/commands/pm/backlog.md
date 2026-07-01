---
description: Show open issues grouped by Projects v2 status
allowed-tools: Bash(gh *)
---

Config PM: !`cat .claude/pm-config.json 2>/dev/null || echo "NOT_FOUND"`
Remote: !`git remote get-url origin 2>/dev/null || echo "unknown"`

Use the `github-pm` skill to execute the backlog view workflow (Workflow 4).

Display issues grouped by status (Triage / Backlog / In Progress / In Review).
Highlight In Progress issues with no recent activity and Triage issues older than 3 days.
