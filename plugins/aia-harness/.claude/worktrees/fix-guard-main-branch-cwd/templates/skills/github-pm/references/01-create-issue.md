# Workflow 1 — Create Issue (human request)

Creates a complete issue from a human request. Requires **user confirmation** before creating.

## Step by step

### 1. Analyze the description

Read the request and extract: context, problem/objective, constraints, references to specs/PRDs/documents.

### 2. Classify Issue Type

| Type | When to use | Template | Label |
|------|-------------|----------|-------|
| **Feature** | New functionality | `feature.yml` | `enhancement` |
| **Bug** | Incorrect/unexpected behavior | `bug.yml` | `bug` |
| **Tech Debt** | Refactor, technical debt, internal improvement | `task.yml` | `task` |
| **Documentation** | Create or update documentation | `task.yml` | `task` |
| **Research** | Investigation, spike, PoC | `task.yml` | `task` |
| **Infra** | CI/CD, infrastructure, configuration | `task.yml` | `task` |

### 3. Estimate Effort and Business Value

**Effort** (complexity/time):

| Level | Meaning |
|-------|---------|
| XS | < 2h — trivial change, 1-2 files |
| S | 2h–1d — small, clear scope |
| M | 1–3d — multiple components, some uncertainty |
| L | 3–5d — involves architecture or external dependencies |
| XL | > 5d — epic, split into sub-issues |

**Business Value** (business/user impact, scale 1–5):

| Value | Meaning |
|-------|---------|
| 5 | Critical — blocking for users or revenue |
| 4 | High — significant experience improvement |
| 3 | Medium — useful, not urgent |
| 2 | Low — nice-to-have |
| 1 | Minimal — cosmetic, personal preference |

### 4. Suggest Priority

| Priority | Criteria |
|----------|----------|
| P0 | Production blocker, data loss, security |
| P1 | High impact, resolve in current sprint |
| P2 | Important, plan in upcoming sprints |
| P3 | Backlog, resolve when capacity allows |

### 5. Generate title and body

**Title**: ≤ 80 chars, format `[Type] concise imperative description`
Examples: `[Feature] Add OAuth authentication`, `[Bug] Crash when saving empty form`

**Body**: follow the template corresponding to the type (see `templates/github/ISSUE_TEMPLATE/`):

- **Bug** (`bug.yml`) → sections: Problem description · Steps to reproduce · Acceptance criteria · Additional context
- **Feature** (`feature.yml`) → sections: Feature description · Motivation · Acceptance criteria
- **Task/Tech Debt/Docs/Research/Infra** (`task.yml`) → sections: Task description · Acceptance criteria

**Body rules:**

- Acceptance criteria always as checkboxes `- [ ]`
- If the request references a spec / PRD / plan / design document:
  - Include in the body the instruction to **follow the spec in detail**, citing the **real sections** of the document
  - Link the document in a `## References` section
- Always include at the end:

```markdown
### Final validation (REQUIRED before closing)
- [ ] All acceptance criteria above verified
- [ ] No regression in adjacent functionality
- [ ] [Adapt with spec-specific steps, if any]
```

### 6. Show to user and request confirmation

Display title, type, labels, effort, business value, priority, and full body.
**Wait for explicit confirmation before proceeding.**

### 7. Create the issue

```bash
gh issue create \
  --repo "$OWNER/$REPO" \
  --title "<title>" \
  --body "<body>" \
  --label "<type-label>,priority:<P0|P1|P2|P3>,status:ready"
```

> Read `$OWNER`, `$REPO` from `.claude/pm-config.json` (see `pm-config-schema.md`).

### 8. Get the issue node ID (required for Projects v2)

```bash
ISSUE_NUMBER=<N>
NODE_ID=$(gh api graphql -f query='
  query($owner: String!, $repo: String!, $number: Int!) {
    repository(owner: $owner, name: $repo) {
      issue(number: $number) { id }
    }
  }' \
  -F owner="$OWNER" -F repo="$REPO" -F number="$ISSUE_NUMBER" \
  --jq '.data.repository.issue.id')
```

### 9. Add to Project v2

```bash
PROJECT_ID=$(cat .claude/pm-config.json | jq -r '.project_id')

ITEM_ID=$(gh api graphql -f query='
  mutation($project: ID!, $content: ID!) {
    addProjectV2ItemById(input: { projectId: $project, contentId: $content }) {
      item { id }
    }
  }' \
  -F project="$PROJECT_ID" -F content="$NODE_ID" \
  --jq '.data.addProjectV2ItemById.item.id')
```

### 10. Set custom fields on the project

```bash
# Status → Backlog
STATUS_FIELD_ID=$(cat .claude/pm-config.json | jq -r '.status_field_id')
BACKLOG_ID=$(cat .claude/pm-config.json | jq -r '.status_options.Backlog')

gh api graphql -f query='
  mutation($project: ID!, $item: ID!, $field: ID!, $value: String!) {
    updateProjectV2ItemFieldValue(input: {
      projectId: $project
      itemId: $item
      fieldId: $field
      value: { singleSelectOptionId: $value }
    }) { projectV2Item { id } }
  }' \
  -F project="$PROJECT_ID" -F item="$ITEM_ID" \
  -F field="$STATUS_FIELD_ID" -F value="$BACKLOG_ID"
```

> For additional fields (Effort, Priority, Business Value), repeat the mutation with the corresponding field IDs from `pm-config.json`.

### 11. Respond to the user

Return:

- URL of the created issue
- Suggested next step (e.g.: `/pm:work-on-issue <N>` to start work)
