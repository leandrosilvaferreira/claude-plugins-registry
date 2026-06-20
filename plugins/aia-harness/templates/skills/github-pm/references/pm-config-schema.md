# Schema de pm-config.json

Arquivo em `.claude/pm-config.json` do projeto-alvo. Gerado por `/pm:setup-project`.

## Estrutura completa

```json
{
  "owner": "org-ou-usuario",
  "repo": "nome-do-repo",
  "project_number": 1,
  "project_id": "PVT_...",
  "status_field_id": "PVTSSF_...",
  "status_options": {
    "Triage":      "PVTSSFO_...",
    "Backlog":     "PVTSSFO_...",
    "In Progress": "PVTSSFO_...",
    "In Review":   "PVTSSFO_...",
    "Done":        "PVTSSFO_..."
  }
}
```

## Como usar os IDs nas mutations GraphQL

```bash
# Mover item para "In Progress":
ITEM_ID=$(gh api graphql -f query='
  query($proj: ID!, $after: String) {
    node(id: $proj) {
      ... on ProjectV2 {
        items(first: 100, after: $after) {
          nodes { id content { ... on Issue { number } } }
        }
      }
    }
  }' -F proj="<project_id>" --jq ".data.node.items.nodes[] | select(.content.number == <N>) | .id")

gh api graphql -f query='mutation {
  updateProjectV2ItemFieldValue(input: {
    projectId: "<project_id>"
    itemId: "'"$ITEM_ID"'"
    fieldId: "<status_field_id>"
    value: { singleSelectOptionId: "<In Progress ID from status_options>" }
  }) { projectV2Item { id } }
}'
```

## Adicionar issue ao projeto

```bash
ISSUE_URL=$(gh issue view <N> --json url --jq .url --repo <owner>/<repo>)
gh project item-add <project_number> --owner <owner> --url "$ISSUE_URL"
```
