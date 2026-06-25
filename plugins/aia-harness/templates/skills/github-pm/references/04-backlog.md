# Workflow 4: View backlog and pending issues

## Quick views

List open issues (general backlog):

```bash
gh issue list --repo <owner>/<repo> --state open \
  --json number,title,labels,assignees,milestone \
  --limit 30
```

Filter by label:

```bash
gh issue list --repo <owner>/<repo> --label "bug" --state open
```

Filter by assignee (my work):

```bash
gh issue list --repo <owner>/<repo> --assignee "@me" --state open
```

## View Projects v2

```bash
gh project list --owner <owner> --format json
gh project item-list <project_number> --owner <owner> --format json
```

## Prioritization

When presenting the backlog to the user:

1. Group by current status (Triage / Backlog / In Progress / In Review)
2. Highlight "In Progress" issues with no recent activity (possible abandonment)
3. Highlight "Triage" issues without triage for more than 3 days

Never silently reorder — present and ask the user.
