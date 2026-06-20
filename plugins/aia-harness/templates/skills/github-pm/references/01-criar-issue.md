# Workflow 1: Criar issue

## Pré-condições
- Confirmar tipo: bug / feature / task
- Ter título e descrição mínima

## Passo a passo

1. Listar labels disponíveis para orientar o tipo:
   ```bash
   gh label list --repo <owner>/<repo>
   ```

2. Usar `github-issues` skill para criar:
   ```bash
   gh issue create \
     --title "<título conciso>" \
     --body "<descrição + critérios de aceite>" \
     --label "<bug|enhancement|task>" \
     --repo <owner>/<repo>
   ```

3. Adicionar ao Projects v2 (via `mcp__github__projects_write` ou gh CLI):
   ```bash
   # Ler project_id de .claude/pm-config.json
   gh project item-add <project_number> --owner <owner> --url <issue_url>
   ```

4. Definir status como Backlog (via GraphQL mutation — ver pm-config-schema.md).

5. Confirmar URL da issue criada ao usuário.

## Critérios de aceite

O body da issue deve ter:
- Descrição do problema ou funcionalidade
- Critérios de aceite (lista com checkboxes `- [ ]`)
- Contexto (opcional mas recomendado)
