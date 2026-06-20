# Workflow 3: Fechar issue / marcar como Done

## Pré-condições

- PR mergeado (o auto-close-issue.yml fecha automaticamente; este workflow é manual)
- Ou: trabalho concluído sem PR (ex.: infra, documentação)

## Passo a passo

1. Ler body da issue e verificar critérios de aceite:

   ```bash
   gh issue view <N> --json body,title --repo <owner>/<repo>
   ```

2. Confirmar com o usuário quais critérios foram atendidos.

3. Se todos os critérios atendidos:

   ```bash
   gh issue close <N> --comment "Concluído. [descrever o que foi feito]" \
     --repo <owner>/<repo>
   ```

4. Mover para Done no Projects v2 (IDs de pm-config.json):

   ```bash
   gh api graphql -f query='mutation { updateProjectV2ItemFieldValue(input: {
     projectId: "<project_id>" itemId: "<item_id>" 
     fieldId: "<status_field_id>"
     value: { singleSelectOptionId: "<Done option ID>" }
   }) { projectV2Item { id } } }'
   ```

5. Se em worktree → perguntar se remove com `/pm:worktree-remove`.

## Invariante

- NUNCA fechar sem validar critérios de aceite. Se critérios não foram definidos na issue,
  definir junto com o usuário antes de fechar.
