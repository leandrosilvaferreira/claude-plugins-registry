---
description: Link repo to GitHub Project and write pm-config.json
allowed-tools: Bash(gh *), Bash(git *), Write
---

Auth status: !`gh auth status 2>&1 | head -5`
Remote: !`git remote get-url origin 2>/dev/null || echo "unknown"`
Config PM atual: !`cat .claude/pm-config.json 2>/dev/null || echo "NOT_FOUND"`

Configure o GitHub PM para este repositório. Execute os seguintes passos:

Use a skill `github-pm` para consultar `references/pm-config-schema.md` sobre o schema do pm-config.json.

1. Verificar autenticação: `gh auth status`. Se não autenticado → `gh auth login` e parar.

2. Extrair owner e repo do remote URL.

3. Listar projetos disponíveis:

   ```bash
   gh project list --owner <owner> --format json --limit 20
   ```

   Apresentar ao usuário e pedir que selecione o número do projeto.

4. Buscar IDs via GraphQL:

   ```bash
   gh api graphql -f query='
     query($owner: String!, $num: Int!) {
       user(login: $owner) {
         projectV2(number: $num) {
           id
           fields(first: 20) {
             nodes {
               ... on ProjectV2SingleSelectField {
                 id name options { id name }
               }
             }
           }
         }
       }
     }' -F owner=<owner> -F num=<project_number>
   ```

   Identificar o campo "Status" e extrair IDs de cada opção
   (Triage, Backlog, In Progress, In Review, Done).

5. Escrever `.claude/pm-config.json` com os IDs reais. Usar Write tool.

6. Verificar se `PROJECTS_PAT` existe como secret do repo:

   ```bash
   gh secret list --repo <owner>/<repo> 2>/dev/null | grep PROJECTS_PAT || echo "NOT_SET"
   ```

   Se NOT_SET → instruir: "Crie um PAT com escopos `repo` e `project` em
   github.com/settings/tokens, depois: `gh secret set PROJECTS_PAT --repo <owner>/<repo>`"

7. Confirmar: "GitHub PM configurado. Rode `/pm:backlog` para ver o backlog."
