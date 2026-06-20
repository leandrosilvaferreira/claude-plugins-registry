# Workflow 2: Trabalhar em uma issue

## Pré-condições

- Issue existe e está no Backlog
- `pm-config.json` disponível

## Passo a passo

1. Ler detalhes da issue:

   ```bash
   gh issue view <N> --json title,labels,body --repo <owner>/<repo>
   ```

2. Gerar slug da branch: `tipo/N-titulo-em-kebab-case`
   - tipo: `feat` (feature/enhancement), `fix` (bug), `chore` (task/infra), `docs`
   - Limitar a 60 chars; caracteres especiais → `-`
   - Exemplo: `feat/42-add-payment-flow`

3. Confirmar o nome da branch com o usuário.

4. Criar worktree (preferencialmente via `/pm:worktree-new <N>`):

   ```bash
   git worktree add .claude/worktrees/<SLUG> -b <SLUG>
   ```

5. Mover issue para In Progress no Projects v2 (usar IDs de pm-config.json):

   ```bash
   # GraphQL mutation — ver pm-config-schema.md para campos 
   gh api graphql -f query='mutation {
     updateProjectV2ItemFieldValue(input: {
       projectId: "<project_id>"
       itemId: "<item_id>"
       fieldId: "<status_field_id>"
       value: { singleSelectOptionId: "<In Progress option ID>" }
     }) { projectV2Item { id } }
   }'
   ```

6. Comentar na issue: "🤖 Iniciando trabalho na branch `<SLUG>`"

## Invariantes

- NUNCA criar branch diretamente em main sem `-b`
- Se worktree já existe para o slug → perguntar se reabre
