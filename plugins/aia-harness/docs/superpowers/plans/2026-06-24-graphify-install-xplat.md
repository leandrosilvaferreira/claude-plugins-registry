# Graphify — Instalação e Configuração Cross-Platform

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Tornar o fluxo de instalação e configuração do graphify nos projetos de destino totalmente automático, multiplataforma (Windows/macOS/Linux) e sem intervenção manual do usuário.

**Architecture:** A pipeline `scan → plan → apply` já venda git hooks do graphify via `vendored-artifacts.mjs`. O que falta é: (1) corrigir a detecção de deps (`TOOL_DEPS.graphify` está vazio), (2) corrigir o nome do pacote PyPI (`graphifyy` com dois y), (3) automatizar a instalação do `uv` quando ausente, (4) remover comandos redundantes/incorretos do `add-tools.md`, e (5) garantir que o fluxo pós-install (`graphify install --project` + `graphify .`) rode automaticamente via Bash sem pedir que o usuário copie comandos.

**Tech Stack:** Node ≥18 ESM, JSDoc/checkJs, `node --test`, shell scripts POSIX (hooks git), `uv` (gerenciador Python cross-platform).

## Global Constraints

- Todo código-fonte em `.mjs` ESM com JSDoc — sem TypeScript, sem build step.
- `templates/` excluído de lint/typecheck — não tocar.
- Hooks git de destino ficam em `templates/tools/graphify/git-hooks/` — o plano NÃO toca esses arquivos.
- Premissa multiplataforma: win32, darwin, linux — sem bash-only.
- Premissa de zero interação manual: Claude executa tudo via Bash, não pede que o usuário copie comandos.
- PyPI package name correto: `graphifyy` (dois y). O binário instalado chama-se `graphify` (um y).
- `uv` é o instalador preferido; Python system não precisa existir previamente (`uv` gerencia seu próprio Python).
- Harness já venda os hooks git via `vendored-artifacts.mjs` — NÃO chamar `graphify hook install`.
- Skill do graphify deve ser instalada no escopo do projeto: `graphify install --project`.

---

## Bugs encontrados (contexto para implementador)

| # | Local | Bug |
|---|-------|-----|
| B1 | `lib/data/deps-catalog.mjs:TOOL_DEPS.graphify` | `[]` — vazio. `resolveDepsFromProfile` usa `TOOL_DEPS`, então `uv` nunca é checado para graphify. |
| B2 | `commands/add-tools.md` linha 85 | `uv tool install graphify` — nome errado (um y). Deve ser `graphifyy`. |
| B3 | `commands/add-tools.md` linha 97 | `graphify claude install` — comando não existe nos docs oficiais; remover. |
| B4 | `commands/add-tools.md` linha 98 | `graphify hook install` — conflita com hooks já vendados pelo harness; remover. |
| B5 | `commands/add-tools.md` | Sem instalação automática de `uv` — usuário fica bloqueado se `uv` ausente. |
| B6 | `lib/generate/misc.mjs:renderToolsInstallSection` linha 97–98 | Inclui `graphify claude install` e `graphify hook install` — ambos incorretos. |
| B7 | `lib/data/deps-catalog.mjs:INSTALL_HINTS` | Sem hint para `graphify` (o binário após install) — não crítico mas bom ter. |

---

## File Map

```
lib/data/deps-catalog.mjs          MODIFY — TOOL_DEPS.graphify += uv; adicionar INSTALL_HINTS.graphify
lib/detect/system-deps.mjs         MODIFY — extraCandidates: adicionar caminhos uv-tool para graphify
commands/add-tools.md              MODIFY — corrigir nome, remover cmds inválidos, adicionar auto-install uv
lib/generate/misc.mjs              MODIFY — renderToolsInstallSection: corrigir graphify lines
tests/tools-catalog.test.mjs       MODIFY — cobrir graphify deps check
tests/tools-plan-apply.test.mjs    MODIFY — cobrir fluxo graphify na checagem de deps
```

---

## Task 1: Corrigir `TOOL_DEPS.graphify` em `deps-catalog.mjs`

**Files:**
- Modify: [lib/data/deps-catalog.mjs](lib/data/deps-catalog.mjs)

**Interfaces:**
- Produz: `TOOL_DEPS.graphify = [{ name: 'uv', level: 'required' }]`
- Consumido por: `resolveDepsFromProfile` em `lib/detect/system-deps.mjs`

- [ ] **Step 1: Ler estado atual do arquivo**

```bash
grep -n "graphify" lib/data/deps-catalog.mjs
```

Saída esperada: linha com `graphify: []`.

- [ ] **Step 2: Corrigir `TOOL_DEPS.graphify`**

Arquivo: [lib/data/deps-catalog.mjs](lib/data/deps-catalog.mjs)

Trocar:
```js
  graphify: [],
```

Por:
```js
  graphify: [{ name: 'uv', level: 'required' }],
```

- [ ] **Step 3: Adicionar `INSTALL_HINTS.graphify` (o binário pós-install)**

Após o bloco de hints para `dotnet`, adicionar:
```js
  graphify: {
    win32:  'uv tool install graphifyy  OU  pip install graphifyy',
    darwin: 'uv tool install graphifyy  OU  pip install graphifyy',
    linux:  'uv tool install graphifyy  OU  pip install graphifyy',
  },
```

- [ ] **Step 4: Rodar typecheck e lint**

```bash
npm run typecheck && npm run lint
```

Esperado: zero erros.

- [ ] **Step 5: Commit**

```bash
git add lib/data/deps-catalog.mjs
git commit -m "fix(deps-catalog): add uv as required dep for graphify; add graphify install hint"
```

---

## Task 2: Corrigir `extraCandidates` para `graphify` em `system-deps.mjs`

**Files:**
- Modify: [lib/detect/system-deps.mjs](lib/detect/system-deps.mjs)

**Interfaces:**
- Produz: `findBinary('graphify', platform, env)` encontra o binário instalado via `uv tool install graphifyy` mesmo quando não está no PATH padrão.
- Consumido por: `checkSystemDeps` ao checar se `graphify` está disponível.

**Contexto:** `uv tool install graphifyy` instala o binário `graphify` em `$(uv tool bin-dir)`, que pode não estar no `PATH` do usuário. Ex: `~/.local/bin` (Linux), `~/.cargo/bin` (macOS com uv via cargo), ou `C:\Users\<user>\.local\bin` (Windows). O `uv tool bin-dir` é o canonical path.

- [ ] **Step 1: Adicionar extraCandidates para `graphify`**

Em [lib/detect/system-deps.mjs](lib/detect/system-deps.mjs), após o bloco `if (name === 'pip3' || name === 'pip')`, adicionar:

```js
  if (name === 'graphify') {
    const c = [];
    // uv tool bin-dir: ~/.local/bin (Linux/macOS) or %APPDATA%\uv\bin (Windows)
    if (home) {
      c.push(path.join(home, '.local', 'bin', 'graphify'));
      c.push(path.join(home, '.local', 'bin', 'graphify.exe'));
    }
    const ap = env.APPDATA ?? '';
    if (ap) c.push(path.join(ap, 'uv', 'bin', 'graphify.exe'));
    const la = env.LOCALAPPDATA ?? '';
    if (la) c.push(path.join(la, 'uv', 'bin', 'graphify.exe'));
    return c;
  }
```

- [ ] **Step 2: Rodar typecheck e lint**

```bash
npm run typecheck && npm run lint
```

Esperado: zero erros.

- [ ] **Step 3: Commit**

```bash
git add lib/detect/system-deps.mjs
git commit -m "fix(system-deps): add extraCandidates for graphify binary from uv tool bin-dir"
```

---

## Task 3: Corrigir `renderToolsInstallSection` em `generate/misc.mjs`

**Files:**
- Modify: [lib/generate/misc.mjs](lib/generate/misc.mjs)

**Interfaces:**
- Produz: comentários corretos no `scripts/install.sh` gerado para projetos de destino.

**Contexto:** As linhas atuais (94–99) têm `graphify claude install` e `graphify hook install` — ambos inválidos. Os hooks já são vendados pelo harness. O nome do pacote deve ser `graphifyy`.

- [ ] **Step 1: Corrigir o bloco graphify**

Em [lib/generate/misc.mjs](lib/generate/misc.mjs), substituir:

```js
  if (ids.has("graphify")) {
    lines.push("#   graphify (code graph) — project-level:");
    lines.push("#     uv tool install graphifyy");
    lines.push("#     graphify install --project && graphify claude install && graphify hook install");
    lines.push("#     graphify .   # build the graph, then: git add graphify-out/");
  }
```

Por:

```js
  if (ids.has("graphify")) {
    lines.push("#   graphify (code graph) — project-level:");
    lines.push("#     uv tool install graphifyy        # instala o binário graphify");
    lines.push("#     graphify install --project       # registra a skill no .claude/skills/graphify/");
    lines.push("#     graphify .                       # constrói o grafo inicial");
    lines.push("#     git add graphify-out/ && git commit -m 'chore: add graphify code graph'");
  }
```

- [ ] **Step 2: Rodar typecheck e lint**

```bash
npm run typecheck && npm run lint
```

- [ ] **Step 3: Commit**

```bash
git add lib/generate/misc.mjs
git commit -m "fix(misc): correct graphify install commands in renderToolsInstallSection"
```

---

## Task 4: Reescrever o bloco graphify em `commands/add-tools.md`

**Files:**
- Modify: [commands/add-tools.md](commands/add-tools.md)

**Interfaces:**
- Este é o comando Claude Code que executa o fluxo de instalação do graphify no projeto de destino.
- Consumido por: o agente Claude quando o usuário roda `/aia-harness:add-tools`.

**Contexto — o que o comando deve fazer para graphify:**

1. Verificar se `uv` está disponível via `check-deps`.
2. Se `uv` ausente: instalar `uv` automaticamente de acordo com a plataforma (`winget` / `brew` / `curl`). Executar via Bash, sem pedir que o usuário copie nada.
3. Instalar graphify: `uv tool install graphifyy`.
4. Registrar a skill no projeto: `graphify install --project` (escopo de projeto, não global).
5. Construir o grafo inicial: `graphify .` (executado via Bash, pode demorar).
6. Commitar o grafo: `git add graphify-out/ && git commit -m 'chore: add graphify code graph'`.

**NÃO fazer:**
- `graphify hook install` — hooks já são vendados pelo harness em `.git/hooks/`.
- `graphify claude install` — comando não existe nos docs oficiais.
- Pedir ao usuário que abra terminal ou copie comando.

- [ ] **Step 1: Substituir o bloco graphify no add-tools.md**

Localizar e substituir a seção graphify dentro da Step 3. O bloco atual começa em `**graphify** (project-level)` e vai até a seção "Do NOT add...". Substituir por:

```markdown
**graphify** (code-graph, project-level):

Detectar plataforma e instalar `uv` se ausente (auto, sem prompt):

macOS (Homebrew disponível):
```bash
brew install uv
```

macOS / Linux (sem Homebrew):
```bash
curl -LsSf https://astral.sh/uv/install.sh | sh
```

Windows (PowerShell / winget):
```bash
winget install astral-sh.uv
```

Após garantir `uv` disponível, instalar graphify e configurar:

```bash
uv tool install graphifyy
```

```bash
graphify install --project
```

```bash
graphify .
```

Commitar o grafo produzido:

```bash
git add graphify-out/
git commit -m "chore: add graphify code graph"
```

**IMPORTANT — what to commit vs ignore:**

- `graphify-out/graph.json` ✅ commit — full graph, team sharing
- `graphify-out/graph.html` ✅ commit — browser visualization
- `graphify-out/GRAPH_REPORT.md` ✅ commit — architecture insights
- `graphify-out/manifest.json` ✅ commit — portable (relative paths), enables incremental updates
- `graphify-out/cost.json` ❌ already gitignored — local API cost tracker
- `graphify-out/cache/` ❌ already gitignored — regenerable, keeps repo smaller

Do NOT add a `graphify-out/` entry to `.gitignore` — only the specific files above are ignored.

**NOTE:** Os hooks git (post-commit, post-checkout) já foram copiados pelo harness para `.git/hooks/` — NÃO rodar `graphify hook install`.
```

- [ ] **Step 2: Verificar que a detecção de plataforma está documentada para o agente**

O agente Claude que executa este comando deve detectar a plataforma via:
```bash
node -e "console.log(process.platform)"
```
E escolher o comando `uv` correto (win32 → winget, darwin → brew ou curl, linux → curl).

Adicionar instrução ao comando logo antes do bloco graphify:

```markdown
Para instalar `uv` automaticamente: detectar plataforma com `node -e "console.log(process.platform)"`,
então executar o instalador correspondente via Bash sem pedir confirmação ao usuário.
```

- [ ] **Step 3: Verificar que o arquivo resultante está correto**

```bash
cat commands/add-tools.md
```

Checar manualmente:
- Sem `graphify claude install`
- Sem `graphify hook install`
- `graphifyy` com dois y no install
- `--project` na skill install
- Detecção de plataforma para uv

- [ ] **Step 4: Commit**

```bash
git add commands/add-tools.md
git commit -m "fix(add-tools): correct graphify install flow — graphifyy, --project, auto uv, remove invalid cmds"
```

---

## Task 5: Adicionar testes de regressão para os bugs corrigidos

**Files:**
- Modify: [tests/tools-catalog.test.mjs](tests/tools-catalog.test.mjs)
- Modify: [tests/tools-plan-apply.test.mjs](tests/tools-plan-apply.test.mjs)

**Interfaces:**
- Consumido por: `npm test`

- [ ] **Step 1: Adicionar teste em `tools-catalog.test.mjs` — TOOL_DEPS.graphify tem uv**

Abrir [tests/tools-catalog.test.mjs](tests/tools-catalog.test.mjs) e ler o padrão de teste existente.

Adicionar ao final do arquivo (antes do último `});` se houver, ou como novo `it`/`test`):

```js
test('TOOL_DEPS.graphify includes uv as required', async () => {
  const { TOOL_DEPS } = await import('../lib/data/deps-catalog.mjs');
  const uvDep = TOOL_DEPS.graphify?.find((d) => d.name === 'uv');
  assert.ok(uvDep, 'TOOL_DEPS.graphify should have uv entry');
  assert.strictEqual(uvDep.level, 'required');
});

test('getTool graphify deps array has uv', async () => {
  const { getTool } = await import('../lib/data/tools-catalog.mjs');
  const tool = getTool('graphify');
  assert.ok(tool, 'graphify tool should exist');
  assert.ok(tool.deps.includes('uv'), 'graphify.deps should include uv');
});
```

- [ ] **Step 2: Rodar apenas esse arquivo de teste**

```bash
node --test tests/tools-catalog.test.mjs
```

Esperado: todos os testes passam, incluindo os novos.

- [ ] **Step 3: Adicionar teste em `tools-plan-apply.test.mjs` — resolveDepsFromProfile inclui uv para graphify**

Abrir [tests/tools-plan-apply.test.mjs](tests/tools-plan-apply.test.mjs) e ler o padrão existente.

Adicionar:

```js
test('resolveDepsFromProfile includes uv when graphify is an installed tool', async () => {
  const { resolveDepsFromProfile } = await import('../lib/detect/system-deps.mjs');
  const profile = { primaryLanguage: 'TypeScript', packageManagers: [] };
  const deps = resolveDepsFromProfile(profile, ['graphify']);
  const uvDep = deps.find((d) => d.name === 'uv');
  assert.ok(uvDep, 'uv should appear in deps when graphify is installed');
  assert.strictEqual(uvDep.level, 'required');
});
```

- [ ] **Step 4: Rodar apenas esse arquivo de teste**

```bash
node --test tests/tools-plan-apply.test.mjs
```

Esperado: todos os testes passam.

- [ ] **Step 5: Rodar suite completa**

```bash
npm test
```

Esperado: zero falhas.

- [ ] **Step 6: Commit**

```bash
git add tests/tools-catalog.test.mjs tests/tools-plan-apply.test.mjs
git commit -m "test: add regression tests for graphify deps (uv required, resolveDepsFromProfile)"
```

---

## Self-Review

### Spec coverage

| Requisito | Task que cobre |
|-----------|---------------|
| Multiplataforma: win/mac/linux | Task 4 (comandos uv por plataforma) |
| Zero interação manual do usuário | Task 4 (agente executa via Bash) |
| Checar Python/uv antes de instalar | Task 1 (TOOL_DEPS) + Task 4 (auto-install uv) |
| Nome correto do pacote: `graphifyy` | Task 3, Task 4 |
| Remover `graphify hook install` (conflito com harness) | Task 4 |
| Remover `graphify claude install` (não existe) | Task 3, Task 4 |
| Skill instalada via `--project` | Task 4 |
| Grafo construído automaticamente | Task 4 (`graphify .`) |
| Grafo commitado | Task 4 |

### Gaps

Nenhum requisito sem task correspondente.

### Placeholder scan

Nenhum "TBD", "TODO", ou passo sem código.

### Type consistency

- `TOOL_DEPS.graphify` retorna `DepEntry[]` — tipo correto (mesmo shape dos outros entries).
- `resolveDepsFromProfile` recebe `installedTools: string[]` — interface inalterada.

---

## Execution Handoff

**Plano completo e salvo em `docs/superpowers/plans/2026-06-24-graphify-install-xplat.md`.**

Duas opções de execução:

**1. Subagent-Driven (recomendado)** — subagente por task, revisão entre tasks, iteração rápida.

**2. Inline Execution** — executar tasks nesta sessão com checkpoints.

Qual abordagem?
