---
name: goal-helper
description: Gera comando /goal otimizado (Claude Code best practices) pronto pra copiar/colar em sessão autônoma. Via AskUserQuestion mapeia gaps de end state, check, escopo, constraints e cap; lê PRDs/specs existentes e extrai requisitos. Output adaptativo: task simples → linha /goal inline; task rica → spec em docs/prd/ + /goal que o referencia. Use quando pedirem "montar um /goal", "gerar prompt de goal", "preparar task autônoma", "overnight goal", "otimizar goal", "goal autônomo" ou usuário mencionar /goal command.
allowed-tools: Read, Glob, Grep, AskUserQuestion, Write
model: opus
---

# Goal Helper

## Invariantes do `/goal` — nunca violar

- Avaliador (Haiku) lê **só o transcript**. Não roda comando, não lê arquivo. Condição só é provada pelo que o agente **escreve na conversa**.
- Toda condição precisa de **check cujo output apareça no transcript** (`npm test exit 0`, `git status clean`, contagem impressa).
- Máx **4000 chars** na condição.
- **Efeito Goodhart:** agente otimiza exato o que mede. Task rica → referenciar spec externo com requisitos de qualidade, não só check.

## Anatomia de um `/goal` (3 + 1)

| # | Componente | Exemplo |
|---|-----------|---------|
| 1 | End state mensurável | "todos testes em `test/auth` passam", "arquivo < 350 LOC" |
| 2 | Check declarado (prova no transcript) | "`npm test` sai 0", "`git status` limpo" |
| 3 | Constraints (o que NÃO pode mudar) | "sem alterar outro arquivo de teste" |
| 4 | Cap obrigatório | "ou parar após 30 turnos" |

## Pipeline de execução — SEMPRE PRESENTE (default obrigatório)

**Todo goal gerado SEMPRE inclui um pipeline.** O pipeline é parte do end state, não opcional.
Ausência de instrução do usuário = usar pipeline padrão. Instrução explícita do usuário = substituir pelo pipeline informado.

### Pipeline padrão do projeto (usar quando usuário não especificar outro)

```
FASE 1 /plan
FASE 2 /orchestrate
FASE 3 /code-review
FASE 4 superpowers:verification-before-completion
FASE 5 superpowers:finishing-a-development-branch
FASE 6 /pm:code-review-pr
```

**Usar pipeline padrão quando:** usuário não menciona pipeline / não lista fases / não especifica fluxo alternativo.

**Substituir pelo pipeline do usuário quando:** usuário lista fases numeradas/com setas com commands (`/plan`, `/orchestrate`, `/code-review`) ou skills (`superpowers:*`, `pm:*`) em sequência — esse pipeline explícito substitui o padrão inteiramente.

**O que incluir sempre no goal gerado:**

1. **Instrução de execução de pipeline** — listar as fases na ordem exata, com o command/skill de cada uma, proibindo pular.
2. **Marcadores de conclusão** — cada fase deve imprimir `"FASE N OK"` no transcript (prova verificável pelo avaliador Haiku).
3. **Checks dos marcadores** — end state inclui "os N marcadores FASE N OK impressos em ordem" como condição verificável.
4. **Cap calibrado** — pipeline de 6 fases: default 120 turnos. Ajustar se escopo muito simples (60t) ou muito amplo (150t+).

**Perguntas adicionais ao mapear gaps:**

| Ponto | Notas |
|-------|-------|
| Cap | Calibrar pelo escopo da task. Default: 120 turnos para pipeline padrão |
| Fase /plan com plano existente | Validar/atualizar existente vs. recriar? Se plano já existe → validar/atualizar |

---

## Workflow OBRIGATÓRIO

**1. Coletar demanda**

- Se o usuário forneceu doc(s) (PRD, plano, spec): `Read` o(s) arquivo(s), extrair objetivos, critérios, constraints, paths. Não re-perguntar o que já está claro no doc.
- Pipeline: **sempre usar o padrão de 6 fases** salvo o usuário listar fases alternativas explicitamente. Registrar qual pipeline aplicar antes de avançar.

**2. Mapear gaps → AskUserQuestion**
Cobrir estes pontos. O que já veio na demanda/doc → não pergunta. O que falta → vira pergunta (máx 4 por chamada):

| Ponto | Notas |
|-------|-------|
| Objetivo / end state | Coração do goal — sem isso não há condição |
| Como provar (check) | Deve aparecer no transcript — o avaliador não roda nada |
| Escopo / paths | Limita onde o agente mexe |
| Constraints | O que não pode quebrar/mudar |
| Cap (turnos ou tempo) | Default: 120t (pipeline 6 fases). Reduzir só se task trivial |
| Qualidade além do check | Requisitos que o check sozinho não captura (anti-Goodhart) |
| Pipeline alternativo? | Perguntar SÓ se usuário mencionou pipeline diferente do padrão |
| /plan com plano existente | Validar/atualizar existente vs. recriar? Se plano já existe → validar/atualizar |

Sempre oferecer default recomendado nas opções.

**3. Decidir formato (adaptativo)**

- **Task simples** (1 end state, check óbvio, poucos requisitos) → linha `/goal` inline — mas ainda com pipeline padrão.
- **Task complexa/rica** (múltiplos critérios, qualidade subjetiva, UX/visual, multi-fase, > 4000 chars) → gerar spec + `/goal` que o referencia.
  - PRD existente apontado pelo usuário → referenciar, não duplicar.
  - Novo spec → `Write` em `docs/prd/<slug>.md` (nunca `tasks/` — rule `feedback-prd-output-location`).

**4. Montar o `/goal` com defaults de segurança (sempre)**

- ✅ Cap de turnos/tempo na condição
- ✅ Check declarado verificável no transcript
- ✅ `não fazer perguntas, decidir sozinho` (sessão autônoma não tem ninguém respondendo)
- ✅ **Pipeline sempre presente** — padrão de 6 fases ou o que o usuário especificou
- ✅ Marcadores `"FASE N OK"` + proibição de pular fases

**5. Entregar**

- Bloco de código copiável com `/goal ...`.
- Se gerou spec: caminho do arquivo + confirmar que o goal o referencia.
- Checklist "antes de rodar": auto mode ligado, `git status` limpo, spec revisado.

## Templates de saída

### A) Task simples (com pipeline padrão)

```text
/goal <end state> provado por <check verificável>; sem <constraint>.

Executar o pipeline de 6 fases na ordem exata, SEM pular nenhuma:
FASE 1 /plan — validar/atualizar plano; imprimir "FASE 1 OK".
FASE 2 /orchestrate — implementar delegando a especialistas; imprimir "FASE 2 OK".
FASE 3 /code-review — revisar; corrigir achados; imprimir "FASE 3 OK".
FASE 4 superpowers:verification-before-completion — imprimir "FASE 4 OK".
FASE 5 superpowers:finishing-a-development-branch — imprimir "FASE 5 OK".
FASE 6 /pm:code-review-pr — imprimir "FASE 6 OK".

End state provado: (1) <gate command> saindo 0; (2) os 6 marcadores "FASE N OK" impressos em ordem.
Não fazer perguntas, decidir sozinho. Parar após <N> turnos.
```

### B) Task complexa — spec + goal

`docs/prd/<slug>.md`:

```markdown
# <Título> — Spec de execução autônoma

## Objetivo
<resultado desejado em 1-2 frases>

## Critérios de aceite (cada um verificável)
- [ ] <critério 1> — prova: <comando/output>
- [ ] <critério 2> — prova: <comando/output>

## Requisitos de qualidade (anti-Goodhart)
<o que "bom" significa além do check: UX, visual, regras de negócio, edge cases>

## Escopo
- Mexer em: <paths>
- NÃO tocar: <paths/constraints>

## Definição de pronto
<estado final + todos os checks verdes + cap>
```

Linha `/goal`:

```text
/goal implementar tudo em docs/prd/<slug>.md até todos critérios de aceite baterem, cada um provado pelo comando indicado; respeitar escopo e "NÃO tocar"; rodar npm run typecheck && npm test && npm run build verdes no final; não fazer perguntas, decidir sozinho; ou parar após <N> turnos
```

### C) Task com pipeline — spec + goal com execução de fases

Usar quando o usuário forneceu um pipeline/fluxo de fases como requisito de processo.

Linha `/goal` (incluir após o end state funcional):

```text
/goal <end state funcional da task> [referência ao spec se existir].

Executar o pipeline de <N> fases na ordem exata, SEM pular nenhuma, imprimindo no transcript a conclusão de cada uma:
FASE 1 <command/skill> — <descrição do que fazer nesta fase>; imprimir "FASE 1 OK".
FASE 2 <command/skill> — <descrição>; imprimir "FASE 2 OK".
[... demais fases ...]

End state provado no transcript: (1) gate final verde — <gate command> saindo 0; (2) os <N> marcadores "FASE N OK" impressos em ordem; (3) <checks adicionais de qualidade impressos>.

Qualidade (anti-Goodhart): <requisitos que o gate não captura — regras de negócio, edge cases, padrões arquiteturais>.

Constraints: <o que não pode mudar/quebrar>.

Não fazer perguntas — decidir sozinho. Parar após <N> turnos.
```

Exemplo (pipeline de 6 fases):

```text
/goal Implementar <feature> conforme docs/prd/<slug>.md (critérios US-01..US-N + FR-1..FR-N).

Executar o pipeline de 6 fases na ordem exata, SEM pular nenhuma, imprimindo no transcript:
FASE 1 /plan — validar/atualizar plano existente (NÃO recriar); imprimir "FASE 1 OK".
FASE 2 /orchestrate — implementar delegando a especialistas conforme CLAUDE.md; imprimir "FASE 2 OK".
FASE 3 /code-review — revisar contra spec (matriz requisito→implementação); corrigir; imprimir "FASE 3 OK".
FASE 4 superpowers:verification-before-completion — imprimir "FASE 4 OK".
FASE 5 superpowers:finishing-a-development-branch — imprimir "FASE 5 OK".
FASE 6 /pm:code-review-pr — imprimir "FASE 6 OK".

End state provado no transcript: (1) gate final verde — npm run lint:fix && npm run typecheck && npm test && npm run build saindo 0; (2) os 6 marcadores "FASE N OK" impressos em ordem; (3) raio de impacto coberto — domínios afetados com vitest saindo 0; (4) git status limpo após finishing-a-development-branch.

Qualidade: <requisitos anti-Goodhart do PRD>.
Constraints: <constraints do PRD/plano>.
Não fazer perguntas — decidir sozinho. Parar após 120 turnos.
```

## Bom vs ruim

| ❌ Ruim | ✅ Bom |
|---------|--------|
| `/goal melhorar o dashboard` | `/goal dashboard renderiza sem erro de console e todos testes de src/app/dashboard passam (npm test sai 0); ou parar após 20 turnos` |
| `/goal deixar o código limpo` | `/goal nenhum arquivo em src/domains > 350 LOC (imprimir wc -l como prova); testes seguem verdes; ou parar após 30 turnos` |
| condição sem cap | sempre `ou parar após N turnos` |
| check que o avaliador não vê | check cujo output o agente imprime no transcript |

## Anti-patterns

- Condição aberta sem end state mensurável.
- Check que exige avaliador ler arquivo/rodar comando — ele não faz isso.
- Sem cap → loop queima tokens ($200/14h documentado).
- Inline raso em task rica → Goodhart. Use spec.
- Gerar PRD em `tasks/` → vai em `docs/prd/`.
- Re-perguntar o que já está no doc fornecido.
- **Pipeline omitido do goal** — pipeline é DEFAULT, sempre presente. Goal sem pipeline = goal incompleto, independente de o usuário ter mencionado ou não.
- **Cap subdimensionado com pipeline** — pipeline de 6 fases com cap 30 turnos → goal falha antes de completar. Calibrar: ~15-25 turnos por fase como mínimo.
- **Marcadores ausentes** — sem `"FASE N OK"` no transcript, o avaliador não tem como verificar se cada fase foi executada.

## Relacionado

- Docs oficiais: <https://code.claude.com/docs/en/goal>
- Skill `prd` / agente `product-owner` — spec PRD formal completo.
- Skill `plan-writing` — plano multi-fase antes do goal.
