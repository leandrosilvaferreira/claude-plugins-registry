# Workflow 1 — Criar Issue (pedido humano)

Cria issue completa a partir de um pedido humano. Exige **confirmação do usuário** antes de criar.

## Passo a passo

### 1. Analisar a descrição

Ler o pedido e extrair: contexto, problema/objetivo, restrições, referências a specs/PRDs/documentos.

### 2. Classificar Issue Type

| Tipo | Quando usar | Template | Label |
|------|-------------|----------|-------|
| **Feature** | Nova funcionalidade | `feature.yml` | `enhancement` |
| **Bug** | Comportamento incorreto/inesperado | `bug.yml` | `bug` |
| **Tech Debt** | Refactor, dívida técnica, melhoria interna | `task.yml` | `task` |
| **Documentation** | Criar ou atualizar documentação | `task.yml` | `task` |
| **Research** | Investigação, spike, PoC | `task.yml` | `task` |
| **Infra** | CI/CD, infraestrutura, configuração | `task.yml` | `task` |

### 3. Estimar Effort e Business Value

**Effort** (complexidade/tempo):

| Nível | Significado |
|-------|-------------|
| XS | < 2h — mudança trivial, 1-2 arquivos |
| S | 2h–1d — escopo pequeno e claro |
| M | 1–3d — múltiplos componentes, alguma incerteza |
| L | 3–5d — envolve arquitetura ou dependências externas |
| XL | > 5d — épico, dividir em sub-issues |

**Business Value** (impacto no negócio/usuário, escala 1–5):

| Valor | Significado |
|-------|-------------|
| 5 | Crítico — blocante para usuários ou receita |
| 4 | Alto — melhoria significativa de experiência |
| 3 | Médio — útil, não urgente |
| 2 | Baixo — nice-to-have |
| 1 | Mínimo — cosmético, preferência pessoal |

### 4. Sugerir Priority

| Priority | Critério |
|----------|----------|
| P0 | Blocante em produção, perda de dados, segurança |
| P1 | Impacto alto, resolver no sprint atual |
| P2 | Importante, planejar nos próximos sprints |
| P3 | Backlog, resolver quando houver espaço |

### 5. Gerar título e corpo

**Título**: ≤ 80 chars, formato `[Tipo] descrição imperativa concisa`
Exemplos: `[Feature] Adicionar autenticação via OAuth`, `[Bug] Crash ao salvar formulário vazio`

**Corpo**: seguir o template correspondente ao tipo (ver `templates/github/ISSUE_TEMPLATE/`):

- **Bug** (`bug.yml`) → seções: Descrição do problema · Passos para reproduzir · Critérios de aceite · Contexto adicional
- **Feature** (`feature.yml`) → seções: Descrição da feature · Motivação · Critérios de aceite
- **Task/Tech Debt/Docs/Research/Infra** (`task.yml`) → seções: Descrição da tarefa · Critérios de aceite

**Regras do corpo:**

- Critérios de aceite sempre como checkboxes `- [ ]`
- Se o pedido referencia spec / PRD / plano / documento de design:
  - Incluir no corpo a instrução de **seguir a spec detalhadamente**, citando as **seções reais** do documento
  - Linkar o documento em uma seção `## Referências`
- Sempre incluir ao final:

```markdown
### Validação final (OBRIGATÓRIA antes de fechar)
- [ ] Todos os critérios de aceite acima verificados
- [ ] Sem regressão em funcionalidades adjacentes
- [ ] [Adaptar com passos específicos da spec, se houver]
```

### 6. Mostrar ao usuário e pedir confirmação

Exibir título, tipo, labels, effort, business value, priority e corpo completo.
**Aguardar confirmação explícita antes de prosseguir.**

### 7. Criar a issue

```bash
gh issue create \
  --repo "$OWNER/$REPO" \
  --title "<título>" \
  --body "<corpo>" \
  --label "<label-tipo>,priority:<P0|P1|P2|P3>,status:ready"
```

> Ler `$OWNER`, `$REPO` de `.claude/pm-config.json` (ver `pm-config-schema.md`).

### 8. Obter node ID da issue (necessário para Projects v2)

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

### 9. Adicionar ao Project v2

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

### 10. Setar custom fields no projeto

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

> Para campos adicionais (Effort, Priority, Business Value), repetir a mutation com os field IDs correspondentes de `pm-config.json`.

### 11. Responder ao usuário

Retornar:

- URL da issue criada
- Próximo passo sugerido (ex: `/pm:trabalhar-issue <N>` para iniciar o trabalho)
