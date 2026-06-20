# Referência Completa — Claude Code Worktrees

## Tabela de cenários e ações

| Objetivo | Ação |
|----------|------|
| Sessão isolada nova | `claude --worktree nome-da-feature` |
| Nome automático | `claude --worktree` |
| Partir de PR específico | `claude --worktree "#1234"` |
| Copiar `.env` para worktrees | Criar `.worktreeinclude` na raiz |
| Partir do HEAD local | `worktree.baseRef: "head"` em settings |
| Subagente isolado one-off | Pedir: "use worktrees for your agents" |
| Subagente isolado permanente | `isolation: worktree` no frontmatter |
| Entrar em worktree mid-session | Pedir: "work in a worktree" (usa `EnterWorktree`) |
| Sair de worktree mid-session | Pedir: "exit worktree" (usa `ExitWorktree`) |
| Limpar worktree não-interativo | `git worktree remove .claude/worktrees/nome` |
| Listar worktrees ativos | `git worktree list` |
| VCS não-git | Configurar `WorktreeCreate` + `WorktreeRemove` hooks |
| Sessões paralelas sem configuração | Desktop app (cria worktree por sessão automaticamente) |

---

## Comparação: Worktrees vs Subagentes vs Agent Teams

| Aspecto | Worktrees | Subagents | Agent Teams |
|---------|-----------|-----------|-------------|
| O que isolam | Edições de arquivo | Trabalho delegado | Coordenação de sessões |
| Quando usar | Sessões paralelas com conflito de arquivo | Delegar tarefa dentro de sessão | Múltiplos Claudes coordenados |
| Criação | `--worktree` flag ou `EnterWorktree` | `Agent tool` com `isolation: worktree` | Configuração de team |
| Cleanup | Automático (com changes = pergunta) | Automático ao terminar sem changes | Manual |

---

## Estrutura de diretórios criada

```
projeto/
├── .claude/
│   └── worktrees/
│       ├── feature-auth/     # claude --worktree feature-auth
│       ├── bugfix-123/       # claude --worktree bugfix-123
│       └── pr-1234/          # claude --worktree "#1234"
├── .worktreeinclude          # arquivos gitignored a copiar
└── .gitignore                # deve incluir .claude/worktrees/
```

---

## `.worktreeinclude` — Sintaxe e comportamento

```text
# Comentário
.env
.env.local
config/secrets.json
*.local
```

**Regras:**
- Usa sintaxe `.gitignore`
- Só copia se o arquivo **também** está no `.gitignore`
- Arquivos rastreados (tracked) nunca são duplicados
- Aplica-se a: `--worktree`, subagent worktrees, desktop app

---

## `worktree.baseRef` — Detalhes

Configuração em `settings.json` (project ou user):

```json
{
  "worktree": {
    "baseRef": "fresh"
  }
}
```

| Valor | Comportamento |
|-------|---------------|
| `"fresh"` (padrão) | Parte de `origin/HEAD` — checkout limpo do remote |
| `"head"` | Parte do `HEAD` local — inclui commits não pushados e estado de feature branch |

**Fallback:** Se não há remote configurado ou o fetch falha, cai para `HEAD` local independente da config.

---

## Lifecycle completo de um worktree `--worktree`

```
claude --worktree nome
  ↓
Verifica workspace trust (já aceito?)
  ↓
Fetch origin/HEAD (ou usa HEAD local se baseRef=head)
  ↓
git worktree add .claude/worktrees/nome -b worktree-nome
  ↓
Copia arquivos do .worktreeinclude
  ↓
Inicia sessão Claude no diretório do worktree
  ↓
[trabalho acontece]
  ↓
Usuário sai (Ctrl+C / /exit)
  ↓
Tem changes/commits?
  ├── Não + sem nome de sessão → remove automaticamente
  ├── Não + tem nome de sessão → pergunta
  └── Sim → pergunta (manter ou remover)
```

---

## Lifecycle de worktree de subagente

```
Agent tool chamado com isolation: "worktree"
  ↓
Worktree temporário criado (mesma baseRef do --worktree)
  ↓
Subagente executa
  ↓
Terminou sem changes? → remove automaticamente
Terminou com changes? → retorna path + branch no resultado
  ↓
Subagentes órfãos (crash) → removidos no startup
  se: mais antigos que cleanupPeriodDays
     E sem uncommitted changes
     E sem untracked files
     E sem unpushed commits
```

---

## Hooks `WorktreeCreate` / `WorktreeRemove`

### Schema de entrada (`WorktreeCreate`)

JSON via stdin:
```json
{
  "name": "nome-do-worktree"
}
```

### Output esperado (`WorktreeCreate`)

Path absoluto do diretório criado, impresso no stdout:
```
/home/user/.claude/worktrees/nome-do-worktree
```

### `WorktreeRemove` — Schema de entrada

```json
{
  "name": "nome-do-worktree",
  "path": "/home/user/.claude/worktrees/nome-do-worktree"
}
```

### Exemplo completo SVN

```json
{
  "hooks": {
    "WorktreeCreate": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "bash -c 'NAME=$(jq -r .name); DIR=\"$HOME/.claude/worktrees/$NAME\"; svn checkout https://svn.example.com/repo/trunk \"$DIR\" >&2 && echo \"$DIR\"'"
          }
        ]
      }
    ],
    "WorktreeRemove": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "bash -c 'PATH=$(jq -r .path); rm -rf \"$PATH\"'"
          }
        ]
      }
    ]
  }
}
```

> Quando `WorktreeCreate` está ativo: `.worktreeinclude` **não** é processado. Copiar configs dentro do hook.

---

## Troubleshooting

### `--worktree` falha com erro de trust

```
Error: Workspace trust not accepted
```

Solução: Rodar `claude` (sem flags) no diretório uma vez e aceitar o dialog.

### Worktree aparece como untracked no checkout principal

Adicionar ao `.gitignore`:
```
.claude/worktrees/
```

### Worktree não-interativo não limpa

`--worktree` com `-p` (non-interactive) não faz cleanup automático. Remover manualmente:
```bash
git worktree remove .claude/worktrees/nome
# ou
git worktree prune  # remove entradas de worktrees já deletados
```

### Subagente com `isolation: worktree` falhou mid-run

O worktree órfão fica em `.claude/worktrees/`. Será removido no próximo startup do Claude se não tiver changes e for mais antigo que `cleanupPeriodDays`. Para remover agora:
```bash
git worktree list  # localizar
git worktree remove .claude/worktrees/nome-gerado
```

### `.worktreeinclude` não está copiando o arquivo

Verificar:
1. Arquivo está no `.gitignore`?
2. Arquivo não está rastreado (tracked) pelo git?
3. `.worktreeinclude` está na **raiz** do repo?
4. Sintaxe do `.worktreeinclude` está correta (testar com `git check-ignore -v arquivo`)?

### Mudar branch base de um worktree já criado

Worktrees existentes não mudam retroativamente. `baseRef` afeta apenas novos worktrees. Para recriar:
```bash
git worktree remove .claude/worktrees/nome
claude --worktree nome  # recria com baseRef atual
```

---

## Configurações relevantes em `settings.json`

```json
{
  "worktree": {
    "baseRef": "fresh"
  },
  "cleanupPeriodDays": 7
}
```

| Campo | Padrão | Descrição |
|-------|--------|-----------|
| `worktree.baseRef` | `"fresh"` | Branch base: `"fresh"` = origin/HEAD, `"head"` = HEAD local |
| `cleanupPeriodDays` | 7 | Dias para limpar worktrees órfãos de subagentes no startup |

---

## Checklist: Setup de projeto para worktrees

```bash
# 1. Adicionar ao .gitignore
echo ".claude/worktrees/" >> .gitignore

# 2. Criar .worktreeinclude (se necessário)
cat > .worktreeinclude << 'EOF'
.env
.env.local
config/secrets.json
EOF

# 3. Verificar que .worktreeinclude funciona
git check-ignore -v .env  # deve mostrar .gitignore

# 4. Testar primeiro worktree
claude --worktree test-setup

# 5. Verificar que .env foi copiado
ls .claude/worktrees/test-setup/.env
```
