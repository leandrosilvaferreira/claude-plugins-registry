---
name: goal-builder
description: Use when asked to generate, build, prepare, optimize or assemble a /goal command for autonomous or overnight execution — triggers: "montar goal", "gerar goal autônomo", "preparar task overnight", "goal para sessão autônoma", "otimizar goal", "goal builder".
allowed-tools: Read, Glob, Grep, AskUserQuestion, Write
model: opus
---

# Goal Builder

Gera um `/goal` otimizado para execução autônoma, com pipeline superpowers de 5 fases, checks verificáveis no transcript e cap de segurança obrigatório.

## Invariantes — nunca violar

- Avaliador (Haiku) lê **só o transcript**. Check só prova se o agente **escreve o output na conversa**.
- Toda condição precisa de **check cujo resultado apareça no transcript** (`npm test exit 0`, `git status limpo`, contagem impressa).
- Máx **4000 chars** na condição.
- **Pipeline superpowers sempre presente** — 5 fases. Ausência de instrução do usuário = usar pipeline padrão.
- **Efeito Goodhart:** agente otimiza exato o que mede. Task rica → referenciar spec externo com requisitos de qualidade.

## Anatomia do `/goal` (3 + 1)

| # | Componente | Exemplo |
|---|-----------|---------|
| 1 | End state mensurável | "todos testes em `test/auth` passam" |
| 2 | Check verificável no transcript | "`npm test` sai 0" |
| 3 | Constraints | "sem alterar arquivos de teste existentes" |
| + | Cap obrigatório | "ou parar após 80 turnos" |

## Pipeline padrão superpowers (5 fases)

```
FASE 1  superpowers:brainstorming               — design + spec (revisar se spec já existe)
FASE 2  superpowers:writing-plans               — plano de implementação detalhado
FASE 3  superpowers:executing-plans             — executar plano task-by-task com checkpoints
FASE 4  superpowers:verification-before-completion — verificar tudo antes de finalizar
FASE 5  superpowers:finishing-a-development-branch — integrar: merge, PR ou cleanup
```

**Cap padrão: 80 turnos.** Calibrar: task trivial → 40t; task ampla → 120t+. Mínimo ~15t por fase.

**Quando substituir:** usuário lista fases alternativas com commands/skills explícitos → substituir pipeline inteiramente.

## Workflow OBRIGATÓRIO

### 1. Coletar demanda

- Doc/spec fornecido → `Read` extrair objetivos, critérios, constraints, paths. Não re-perguntar o que já está claro.
- Registrar qual pipeline aplicar antes de avançar.
- Spec existente → FASE 1 = "revisar/validar" (não recriar).
- Plano existente → FASE 2 = "validar/atualizar" (não recriar).

### 2. Mapear gaps → AskUserQuestion (máx 4 por chamada)

| Ponto | Notas |
|-------|-------|
| Objetivo / end state | Coração do goal — sem isso não há condição |
| Como provar (check) | Output que aparece no transcript |
| Escopo / paths | Limita onde o agente mexe |
| Constraints | O que não pode quebrar/mudar |
| Cap (turnos) | Default 80t. Reduzir se trivial |
| Qualidade além do check | Requisitos que o check não captura (anti-Goodhart) |
| FASE 1 skip ou revisar? | Spec já existe → brainstorming em modo revisão |
| FASE 2 atualizar? | Plano existe → validar existente vs. recriar? |

Sempre oferecer default recomendado nas opções.

### 3. Decidir formato

- **Task simples** (1 end state, check óbvio, poucos requisitos) → `/goal` inline com pipeline padrão.
- **Task complexa** (múltiplos critérios, qualidade subjetiva, multi-domínio, > 4000 chars) → spec + `/goal` que o referencia.
  - Spec existente apontado → referenciar, não duplicar.
  - Novo spec → `Write` em `docs/specs/<slug>.md`.

### 4. Montar o `/goal`

Checklist obrigatório:

- ✅ End state mensurável
- ✅ Check verificável no transcript
- ✅ Constraints explícitos
- ✅ Cap calibrado ao escopo
- ✅ Pipeline 5 fases em ordem exata com marcadores `"FASE N OK"`
- ✅ Proibição de pular fases
- ✅ `não fazer perguntas, decidir sozinho`

### 5. Entregar

- Bloco copiável com `/goal ...`.
- Se gerou spec: caminho do arquivo confirmado.
- Checklist "antes de rodar": auto mode ligado, `git status` limpo, spec revisado se existir.

---

## Templates

### A) Task simples — goal inline

```text
/goal <end state> provado por <check no transcript>; sem <constraint>.

Executar pipeline superpowers de 5 fases na ordem exata, SEM pular nenhuma:
FASE 1 superpowers:brainstorming — entender requisitos, design e spec; imprimir "FASE 1 OK".
FASE 2 superpowers:writing-plans — criar plano de implementação detalhado; imprimir "FASE 2 OK".
FASE 3 superpowers:executing-plans — executar plano task-by-task com checkpoints; imprimir "FASE 3 OK".
FASE 4 superpowers:verification-before-completion — verificar tudo antes de finalizar; imprimir "FASE 4 OK".
FASE 5 superpowers:finishing-a-development-branch — integrar (merge/PR/cleanup); imprimir "FASE 5 OK".

End state provado: (1) <gate command> saindo 0; (2) os 5 marcadores "FASE N OK" impressos em ordem.
Não fazer perguntas, decidir sozinho. Parar após <N> turnos.
```

### B) Task complexa — spec + goal

`docs/specs/<slug>.md`:

```markdown
# <Título> — Spec de execução autônoma

## Objetivo
<resultado desejado em 1-2 frases>

## Critérios de aceite (cada um verificável)
- [ ] <critério 1> — prova: <comando/output>
- [ ] <critério 2> — prova: <comando/output>

## Requisitos de qualidade (anti-Goodhart)
<o que "bom" significa além do check: UX, regras de negócio, edge cases>

## Escopo
- Mexer em: <paths>
- NÃO tocar: <paths/constraints>

## Definição de pronto
<estado final + todos os checks verdes + cap>
```

Linha `/goal`:

```text
/goal implementar tudo em docs/specs/<slug>.md até todos critérios de aceite baterem, cada um provado pelo comando indicado.

Executar pipeline superpowers de 5 fases na ordem exata, SEM pular nenhuma:
FASE 1 superpowers:brainstorming — revisar spec em docs/specs/<slug>.md (NÃO recriar); imprimir "FASE 1 OK".
FASE 2 superpowers:writing-plans — criar/validar plano baseado no spec; imprimir "FASE 2 OK".
FASE 3 superpowers:executing-plans — executar plano task-by-task; imprimir "FASE 3 OK".
FASE 4 superpowers:verification-before-completion — rodar <gate command>; verificar cobertura; imprimir "FASE 4 OK".
FASE 5 superpowers:finishing-a-development-branch — integrar; imprimir "FASE 5 OK".

End state provado: (1) <gate command> saindo 0; (2) os 5 marcadores "FASE N OK" impressos em ordem; (3) git status limpo.

Qualidade (anti-Goodhart): <requisitos que o gate não captura>.
Constraints: <o que não pode mudar>.
Não fazer perguntas — decidir sozinho. Parar após <N> turnos.
```

---

## Anti-patterns

| ❌ Ruim | ✅ Bom |
|---------|--------|
| Goal sem pipeline | Pipeline superpowers 5 fases sempre presente |
| Sem cap | `ou parar após N turnos` sempre |
| Check que o avaliador não vê | Output do check impresso no transcript |
| Marcadores FASE N OK ausentes | Um marcador por fase — avaliador prova execução |
| Re-perguntar o que está no doc | Ler doc, extrair, perguntar só o que falta |
| Cap subdimensionado | 5 fases × ~15t mínimo = 80t default |
| Pipeline omitido por ser "task simples" | Pipeline é DEFAULT — sempre presente, sempre |
| Spec novo em `tasks/` | Novo spec vai em `docs/specs/<slug>.md` |
