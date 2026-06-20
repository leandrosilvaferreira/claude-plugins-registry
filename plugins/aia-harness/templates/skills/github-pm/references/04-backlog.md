# Workflow 4: Ver backlog e issues pendentes

## Visualizações rápidas

Listar issues abertas (backlog geral):

```bash
gh issue list --repo <owner>/<repo> --state open \
  --json number,title,labels,assignees,milestone \
  --limit 30
```

Filtrar por label:

```bash
gh issue list --repo <owner>/<repo> --label "bug" --state open
```

Filtrar por assignee (meu trabalho):

```bash
gh issue list --repo <owner>/<repo> --assignee "@me" --state open
```

## Ver projetos v2

```bash
gh project list --owner <owner> --format json
gh project item-list <project_number> --owner <owner> --format json
```

## Priorização

Ao apresentar o backlog ao usuário:

1. Agrupar por status atual (Triage / Backlog / In Progress / In Review)
2. Destacar Issues "In Progress" sem atividade recente (possível abandono)
3. Destacar Issues "Triage" sem triagem há mais de 3 dias

Nunca reordenar silenciosamente — apresentar e perguntar ao usuário.
