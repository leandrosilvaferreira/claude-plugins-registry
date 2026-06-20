---
name: claude-code-worktrees
description: This skill should be used when the user asks about "worktree", "worktrees", "sessões paralelas com worktree", "--worktree flag", "EnterWorktree", "ExitWorktree", ".worktreeinclude", "WorktreeCreate hook", "WorktreeRemove hook", "worktree.baseRef", "isolate subagents", "isolation worktree", "sessões isoladas no Claude Code", "rodar Claude em paralelo com worktrees", or any question about running parallel Claude Code sessions in isolated git worktrees.
version: 0.1.0
---

# Claude Code — Git Worktrees

Skill para **tirar dúvidas** e **executar ações utilitárias** sobre worktrees no Claude Code.

> Para criar workspace isolado antes de implementar features, use `superpowers:using-git-worktrees`.
> Esta skill cobre as features nativas do Claude Code: flags CLI, ferramentas, hooks, configuração e subagentes.

---

## Conceito rápido

Um git worktree é um diretório de trabalho separado com branch própria, compartilhando o mesmo histórico e remote do repo principal. Cada sessão Claude Code em seu próprio worktree evita colisões de edição entre sessões paralelas.

---

## Iniciar Claude em um worktree

### Flag `--worktree` / `-w`

```bash
# Cria worktree em .claude/worktrees/feature-auth/ com branch worktree-feature-auth
claude --worktree feature-auth

# Segunda sessão isolada em paralelo
claude --worktree bugfix-123

# Nome gerado automaticamente (ex: bright-running-fox)
claude --worktree
```

Adicione `.claude/worktrees/` ao `.gitignore` para não aparecer como untracked no checkout principal.

### Primeira vez num diretório

Antes de usar `--worktree` num diretório novo, rodar `claude` uma vez para aceitar o workspace trust dialog. Sem isso, `--worktree` termina com erro.

### Branch base do worktree

Por padrão, o worktree parte de `origin/HEAD` (remote limpo). Para mudar:

```json
{
  "worktree": {
    "baseRef": "head"
  }
}
```

`"head"` → parte do `HEAD` local (inclui commits não pushados). Aceita só `"fresh"` ou `"head"`.

### Worktree a partir de um PR

```bash
# Pelo número do PR
claude --worktree "#1234"

# Ou pela URL completa do GitHub PR
claude --worktree "https://github.com/org/repo/pull/1234"
```

Cria worktree em `.claude/worktrees/pr-1234` fazendo fetch de `pull/1234/head`.

---

## Copiar arquivos gitignored para worktrees

Worktrees são checkouts limpos — `.env`, `.env.local`, etc. **não estão presentes**. Para copiá-los automaticamente, criar `.worktreeinclude` na raiz do projeto:

```text
.env
.env.local
config/secrets.json
```

Usa sintaxe `.gitignore`. Só copia arquivos que estejam **também** no `.gitignore` — arquivos rastreados nunca são duplicados.

Aplica-se a: `--worktree`, worktrees de subagentes, e sessões paralelas no desktop app.

---

## Ferramentas nativas (dentro de uma sessão)

Durante uma sessão Claude Code, pedir ao Claude:

- `"work in a worktree"` → Claude usa a tool `EnterWorktree` para criar e entrar num worktree
- `"exit worktree"` → Claude usa `ExitWorktree`

Subagentes criados com `Agent tool` com `isolation: "worktree"` recebem worktrees temporários automaticamente.

---

## Isolamento de subagentes

### Ad-hoc (pedindo ao Claude)

> "use worktrees for your agents"

### Permanente em subagente customizado

Frontmatter do agente:

```yaml
isolation: worktree
```

Cada subagente recebe worktree temporário removido automaticamente ao terminar **sem alterações**.

Worktrees de subagentes partem da mesma `baseRef` configurada para `--worktree`.

---

## Limpeza e ciclo de vida

| Situação ao sair | Comportamento |
|------------------|---------------|
| Sem commits, sem changes, sem untracked | Worktree e branch removidos automaticamente |
| Sessão tem nome (`--name`) + sem changes | Claude pergunta antes de remover |
| Com commits ou changes | Claude pergunta: manter ou remover |
| Run não-interativo (`--worktree` + `-p`) | **Não** limpa automaticamente — remover manualmente |

Limpar worktree não-interativo:
```bash
git worktree remove .claude/worktrees/nome-do-worktree
```

Worktrees de subagentes órfãos (crash/interrupção) são removidos no próximo startup se forem mais antigos que `cleanupPeriodDays` e não tiverem changes.

---

## Gerenciamento manual com git

```bash
# Criar worktree em nova branch
git worktree add ../project-feature-a -b feature-a

# Criar worktree de branch existente
git worktree add ../project-bugfix bugfix-123

# Iniciar Claude no worktree
cd ../project-feature-a && claude

# Listar worktrees
git worktree list

# Remover worktree
git worktree remove ../project-feature-a
```

Cada worktree novo precisa do setup do projeto (deps, env virtual, etc).

---

## Hooks para customização avançada

### `WorktreeCreate`

Substitui a lógica padrão de `git worktree add`. Útil para: VCS não-git (SVN, Perforce, Mercurial), posição personalizada, lógica de branch custom.

Recebe JSON via stdin com o campo `name`. Deve imprimir o path do diretório criado no stdout.

Exemplo SVN:
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
    ]
  }
}
```

### `WorktreeRemove`

Parceiro do `WorktreeCreate` — limpa ao final da sessão.

> Quando `WorktreeCreate` está configurado, `.worktreeinclude` **não** é processado automaticamente. Copiar configs locais dentro do hook script.

---

## Desktop App

O desktop app cria um worktree para **cada nova sessão** automaticamente — sem flag necessária. Ver [desktop parallel sessions](/en/desktop#work-in-parallel-with-sessions).

---

## Referências adicionais

- **`references/worktree-reference.md`** — tabela completa de cenários, troubleshooting, e comparação com subagents/agent teams
