# Best Practices — Skills (`.claude/skills/<name>/SKILL.md`)

> Reference for compressing skill files. Skills usam `allowed-tools` (NÃO `tools`). A `description` governa descoberta automática — preservar todos os triggers.

## Frontmatter fields

| Field | Required | Compressão: regra |
|-------|----------|-------------------|
| `name` | recomendado | Preservar exato — nome de invocação `/name`; max 64 chars, lowercase+hyphens |
| `description` | recomendado | Comprimir prosa MAS preservar TODOS os triggers de descoberta (ver abaixo) |
| `allowed-tools` | não | Preservar exato — allowlist de tools; `Bash(pattern)` para bash restrito |
| `disable-model-invocation` | não | Preservar exato — `true` bloqueia invocação automática (só usuário) |
| `argument-hint` | não | Preservar exato — hint de autocomplete, ex: `<branch-or-path>` |
| `paths` | não | Preservar exato — glob patterns para ativação automática por arquivo |
| `model` | não | Preservar exato — override de modelo para essa skill |

**Atenção:** Skills usam `allowed-tools`, não `tools`. Se encontrar `tools` numa skill, é erro de frontmatter (o validador corrige, não o compressor).

## Comprimindo `description`

A `description` governa tanto o autocomplete quanto a descoberta automática por Claude. Condensar prosa mas **preservar obrigatoriamente**:

- Padrões "Use when..." — são os gatilhos de ativação automática
- Keywords específicos que Claude usa para matching (nomes de ferramentas, formatos, extensões)
- Contextos/cenários concretos de uso
- Verbos de ação específicos ("analyzes", "generates", "extracts")

**Comprimir:** artigos, frases de apresentação genéricas, hedging, repetições do nome da skill

```yaml
# RUIM (verbose, triggers implícitos):
description: This skill helps you work with PDF files. It can extract text from PDFs, fill out forms, and merge multiple PDF documents together. You can use it whenever you need to do anything with PDF files.

# BOM (terceira pessoa, triggers explícitos):
description: Extracts text/tables from PDFs, fills forms, merges documents. Use when working with PDF files or user mentions PDFs, forms, document extraction.
```

**Regra crítica:** Description é injetada no system prompt de descoberta. Nunca usar primeira/segunda pessoa ("I can", "you can") — sempre terceira pessoa.

## Comprimindo o body (SKILL.md body)

O body carrega só quando a skill é invocada (não no startup) — mas uma vez carregado, concorre com todo o contexto.

**Meta para condensação:** body sob 500 linhas para performance ótima.

**Comprimir agressivamente:**
- Prosa introdutória/contextual que Claude já sabe
- Explicações óbvias de conceitos conhecidos
- Repetições entre seções
- Hedging e fillers

**Preservar obrigatoriamente:**
- Todo passo numerado de workflow
- Code blocks (byte a byte)
- Comandos bash com flags exatas
- Paths e nomes de arquivos referenciados
- Thresholds numéricos e condições ("máx 1-2 voltas", ">350 linhas")
- Links para arquivos de referência (`[FORMS.md](FORMS.md)`) — são o mecanismo de progressive disclosure
- Proibições explícitas e regras duras
- Exemplos concretos input/output

## Padrão de estrutura ótima

```markdown
# Skill Name

## Quick start / Workflow OBRIGATÓRIO
[passos numerados imperatives]

## Edge cases / Variantes
[links para arquivos externos quando detalhado]

## Notas
[regras duras, invariantes]
```

**Progressive disclosure:** Ao condensar, verificar se há conteúdo que poderia ser movido para arquivos externos referenciados (um nível de profundidade apenas). Referências de segundo nível (arquivo que aponta para outro arquivo) devem ser identificadas e reportadas ao usuário como oportunidade.

## Invariantes — nunca violar ao comprimir

- `name`: max 64 chars, lowercase+números+hyphens, sem XML tags, sem "anthropic"/"claude"
- `description`: max 1024 chars, não-vazia, sem XML tags
- `allowed-tools` com `Bash(pattern)` — o padrão é a restrição; não simplificar para `Bash`
- `paths` com globs — os patterns são o escopo de ativação; não remover
- `disable-model-invocation: true` — remove controle de invocação se deletado
- Links para arquivos de referência (`[file.md](file.md)`) — são o mecanismo de lazy loading; preservar exatos
- Wikilinks `[[...]]` — preservar exatos

## Sinal de qualidade após compressão

Após comprimir, verificar: o compressor consegue descobrir quando invocar esta skill lendo só `description`? Se sim, descrição está correta. Se não, os triggers foram perdidos.
