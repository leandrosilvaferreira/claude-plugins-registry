# Best Practices — Rules (`.claude/rules/<name>.md`)

> Reference for compressing rule files. Rules são instruções que carregam condicionalmente (com `paths:`) ou incondicionalmente (sem `paths:`). O custo de contexto de regras globais é pago EM TODA sessão — comprimir é crítico aqui.

## Frontmatter fields

| Field | Required | Compressão: regra |
|-------|----------|-------------------|
| `paths` | não | **PRESERVAR EXATO** — governa escopo; remover transforma regra scoped em global (carga em toda sessão) |
| `description` | não | Comprimir se presente — não é campo de descoberta como em skills/agents |

**Regras sem `paths`:** carregam incondicionalmente para toda sessão. Alto custo — comprimir body agressivamente.
**Regras com `paths`:** carregam só quando Claude trabalha com arquivos matching os globs. Comprimir body mas NUNCA tocar `paths`.

## Estrutura válida de `paths`

```yaml
# Lista YAML (correto):
---
paths:
  - "src/api/**/*.ts"
  - "**/*.test.ts"
---

# String CSV (também válido):
---
paths: "src/api/**/*.ts", "**/*.test.ts"
---
```

Preservar o formato original (lista ou string) ao comprimir.

## Comprimindo o body

Rules são o tipo com maior retorno de compressão — toda token economizada é repetida em cada sessão que as carrega.

**Comprimir agressivamente:**
- Prosa introdutória/contextual
- Explicações do porquê das regras (relevante para CLAUDE.md, não para rules)
- Repetições entre itens de uma lista
- Hedging ("It is recommended that you...", "Please make sure to...")
- Qualquer texto que não seja a regra em si

**Preservar obrigatoriamente:**
- Os imperativos concretos: "Always X", "Never Y", "When Z do W"
- Thresholds numéricos: "máx 350 linhas", "≥ 2 revisores"
- Nomes de ferramentas, comandos, padrões de arquivo específicos
- Exemplos concretos que definem o comportamento correto vs errado
- Qualquer negação explícita ("NEVER", "must not", "proibido")
- Enumerações de valores válidos/inválidos
- Code blocks com padrões obrigatórios

## Padrão de estrutura ótima

Rules devem ser curtas e imperativas. O ideal é uma lista de bullets diretos:

```markdown
---
paths:
  - "src/api/**/*.ts"
---

# API Rules

- All endpoints require input validation with Zod
- Use standard error format: `{ error: string, code: string }`
- Include OpenAPI `@tags` comment above each handler
- Never expose internal stack traces to API responses
- Rate limit all public endpoints (max 100 req/min)
```

**RUIM (prolixo):**
```markdown
When you are working on API files, please make sure that you validate all inputs
that come into the endpoints. This is important for security. You should also use
our standard error format which we have defined to ensure consistency across the
API surface...
```

**BOM (imperativo):**
```markdown
- Validate all endpoint inputs
- Standard error format: `{ error: string, code: string }`
```

## Escopo correto: rule vs CLAUDE.md vs skill

| Conteúdo | Onde colocar |
|----------|--------------|
| Convenção específica a tipo de arquivo | `rules/*.md` com `paths:` |
| Convenção cross-cutting sem scope | `rules/*.md` sem `paths:` |
| Procedimento/workflow reutilizável | skill |
| Fato sobre o projeto/arquitetura | `CLAUDE.md` |
| Instrução longa com muitos detalhes | skill (lazy-load) |

Ao comprimir: se o body de uma rule é grande demais (>50 linhas), identificar ao usuário que pode ser melhor como skill (lazy-load) em vez de rule (carga incondicional).

## Invariantes — nunca violar ao comprimir

- `paths:` com qualquer valor — remover transforma regra em global; preservar exato
- Negações explícitas (NEVER/never/must not/proibido) — preservar completo
- Thresholds numéricos — comprimir a prosa ao redor mas manter o número e unidade
- Code blocks — preservar byte a byte
- Nomes de ferramentas/comandos/arquivos específicos referenciados como padrão obrigatório

## Alerta de custo de contexto

Rules globais (sem `paths`) são carregadas em TODA sessão do projeto. Uma rule de 500 tokens custa 500 tokens × N sessões por dia × M desenvolvedores. Comprimir rules globais é o maior ROI de toda a condensação.

Ao condensar: priorizar agressividade máxima em rules globais; aceitar pequenas perdas de prosa narrativa se o imperativo for preservado.
