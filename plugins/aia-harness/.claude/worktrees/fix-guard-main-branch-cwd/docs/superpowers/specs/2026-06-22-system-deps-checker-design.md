# System Dependencies Checker — Design Spec

**Data:** 2026-06-22
**Branch:** feat/cross-platform
**Status:** Aprovado — aguardando plano de implementação

---

## Problema

`scan`, `doctor`, `init`, `add-tools` e `add-plugins` falham silenciosamente (ou com erros crípticos) quando dependências do sistema estão ausentes — Node antigo, Python faltando em projeto Python, `uv` ausente quando hooks dependem dele. Não há diagnóstico claro nem instrução de instalação por plataforma.

## Objetivo

Antes de qualquer operação do harness, detectar e reportar dependências obrigatórias do sistema. Bloquear execução se alguma `required` estiver faltando, com mensagem clara de como instalar por plataforma (Windows, Mac, Linux).

---

## Decisões de design

| Questão | Decisão |
|---------|---------|
| Dep faltando | Bloquear totalmente (exit 1) |
| Escopo das deps | Inferir pelo stack detectado + deps dos hooks/tools instalados |
| Camada | Engine (`bin/harness.mjs` + `lib/detect/system-deps.mjs`) |
| Triggers | scan, doctor, init, add-tools, add-plugins + novo `/check-deps` standalone |

---

## Arquitetura

### Novos arquivos

```
lib/
  data/
    deps-catalog.mjs              ← catálogo: stack-key + tool-name → deps necessárias
  detect/
    system-deps.mjs               ← detecção pura: resolve binários, retorna DepsReport
commands/
  check-deps.md                   ← /check-deps slash command
tests/
  detect-system-deps.test.mjs
```

### Arquivos modificados

```
bin/harness.mjs                   ← novo sub-comando `check [dir] [--json] [--tools=...]`
commands/scan.md                  ← chama `check` como primeiro passo
commands/init.md                  ← chama `check` como primeiro passo
commands/doctor.md                ← chama `check` como primeiro passo
commands/add-tools.md             ← chama `check --tools=...` antes de instalar
commands/add-plugins.md           ← chama `check --tools=...` antes de instalar
lib/profile.mjs                   ← novos typedefs: DepCheck, DepsReport
```

---

## Modelo de dados (JSDoc)

```js
/**
 * @typedef {Object} DepCheck
 * @property {string}  name          // ex: "node", "python3", "uv"
 * @property {boolean} found
 * @property {string|null} version   // null se não encontrado
 * @property {string}  resolvedPath  // caminho real do binário (vazio se não encontrado)
 * @property {'required'|'recommended'} level
 * @property {Record<'win32'|'darwin'|'linux', string>} installHint
 */

/**
 * @typedef {Object} DepsReport
 * @property {'ok'|'warn'|'block'} status
 *   // ok    = todos required presentes
 *   // warn  = algum recommended ausente, nenhum required faltando
 *   // block = algum required faltando → engine retorna exit 1
 * @property {DepCheck[]} checks
 * @property {string[]}   missing   // nomes dos required não encontrados
 */
```

---

## Detecção cross-platform (`lib/detect/system-deps.mjs`)

### Resolução de binário

Ordem de busca para cada binário:

1. `process.env.PATH` (split `;` no Windows, `:` no Unix)
2. Fallbacks por plataforma:
   - **Node via fnm:** `$FNM_DIR/aliases/default/bin/node` (Unix) / `%APPDATA%\fnm\` (Win)
   - **Node via nvm:** `$NVM_DIR/versions/node/*/bin/node`
   - **Python via pyenv:** `$PYENV_ROOT/shims/python3`
   - **uv:** `$HOME/.local/bin/uv`, `$HOME/.cargo/bin/uv`
   - **Cargo/rustup:** `$HOME/.cargo/bin/`
   - **Windows Python:** `%LOCALAPPDATA%\Programs\Python\Python*/python.exe`

### Assinaturas

```js
/**
 * Checa se os binários estão disponíveis na plataforma atual.
 * Função pura: não lê arquivos, não altera estado.
 *
 * @param {Array<{name: string, level: 'required'|'recommended'}>} deps
 * @param {string} platform  // process.platform: 'win32'|'darwin'|'linux'
 * @returns {DepsReport}
 */
export function checkSystemDeps(deps, platform) {}

/**
 * Resolve quais deps checar dado o ProjectProfile + tools instaladas.
 *
 * @param {import('../profile.mjs').ProjectProfile} profile
 * @param {string[]} installedTools  // ex: ['rtk', 'caveman', 'graphify']
 * @returns {Array<{name: string, level: 'required'|'recommended'}>}
 */
export function resolveDepsFromProfile(profile, installedTools) {}
```

---

## Catálogo (`lib/data/deps-catalog.mjs`)

```js
// Node é SEMPRE required — o engine precisa
const ENGINE_DEPS = [
  { name: 'node', level: 'required' },
];

// Stack key → deps necessárias
const STACK_DEPS = {
  python: [
    { name: 'python3', level: 'required' },
    { name: 'pip3',    level: 'recommended' },
    { name: 'uv',      level: 'recommended' },
  ],
  go:   [{ name: 'go',       level: 'required' }],
  php:  [{ name: 'php',      level: 'required' },
         { name: 'composer', level: 'required' }],
  ruby: [{ name: 'ruby',     level: 'required' },
         { name: 'bundle',   level: 'required' }],
  java: [{ name: 'java',     level: 'required' },
         { name: 'mvn',      level: 'recommended' }],
  rust: [{ name: 'cargo',    level: 'required' }],
};

// Tool name → deps adicionais que aquela tool precisa
const TOOL_DEPS = {
  // rtk distribui binário pré-compilado; cargo só se o usuário quiser compilar
  rtk:      [],
  graphify: [], // só Node, já coberto por ENGINE_DEPS
  caveman:  [],
  ponytail: [],
};

// Hints de instalação por plataforma para cada binário
export const INSTALL_HINTS = {
  node: {
    win32:  'winget install OpenJS.NodeJS  OU  fnm: https://github.com/Schniz/fnm',
    darwin: 'brew install fnm && fnm install --lts',
    linux:  'curl -fsSL https://fnm.vercel.app/install | bash && fnm install --lts',
  },
  python3: {
    win32:  'winget install Python.Python.3  OU  https://www.python.org/downloads/',
    darwin: 'brew install python3  OU  pyenv install 3.12',
    linux:  'sudo apt install python3  OU  pyenv install 3.12',
  },
  pip3: {
    win32:  'python -m ensurepip --upgrade',
    darwin: 'python3 -m ensurepip --upgrade',
    linux:  'python3 -m ensurepip --upgrade  OU  sudo apt install python3-pip',
  },
  uv: {
    win32:  'winget install astral-sh.uv  OU  pip install uv',
    darwin: 'brew install uv  OU  curl -LsSf https://astral.sh/uv/install.sh | sh',
    linux:  'curl -LsSf https://astral.sh/uv/install.sh | sh',
  },
  go: {
    win32:  'winget install GoLang.Go  OU  https://go.dev/dl/',
    darwin: 'brew install go',
    linux:  'sudo apt install golang-go  OU  https://go.dev/dl/',
  },
  php: {
    win32:  'https://windows.php.net/download/',
    darwin: 'brew install php',
    linux:  'sudo apt install php',
  },
  composer: {
    win32:  'https://getcomposer.org/Composer-Setup.exe',
    darwin: 'brew install composer',
    linux:  'https://getcomposer.org/download/',
  },
  cargo: {
    win32:  'https://rustup.rs  (rustup-init.exe)',
    darwin: 'curl --proto "=https" --tlsv1.2 -sSf https://sh.rustup.rs | sh',
    linux:  'curl --proto "=https" --tlsv1.2 -sSf https://sh.rustup.rs | sh',
  },
  java: {
    win32:  'winget install Microsoft.OpenJDK.21  OU  https://adoptium.net/',
    darwin: 'brew install --cask temurin',
    linux:  'sudo apt install default-jdk  OU  https://adoptium.net/',
  },
  ruby: {
    win32:  'https://rubyinstaller.org/',
    darwin: 'brew install ruby',
    linux:  'sudo apt install ruby-full',
  },
};
```

---

## Sub-comando `check` (`bin/harness.mjs`)

```
node bin/harness.mjs check [dir] [--json] [--tools=rtk,caveman,...]
```

- `[dir]` opcional — default `process.cwd()`
- `--tools=` lista de tools instaladas para incluir deps adicionais
- `--json` emite `DepsReport` como JSON bruto (para comandos `.md`)
- **Exit 0** → `status: ok` ou `warn`
- **Exit 1** → `status: block`

### Saída legível (sem `--json`)

**Status ok/warn:**
```
✓ node        v22.3.0   /Users/x/.fnm/node/22.3.0/bin/node
✓ python3     v3.12.4   /usr/bin/python3
✗ uv                    não encontrado  [recommended]
  → darwin: brew install uv  OU  curl -LsSf https://astral.sh/uv/install.sh | sh

STATUS: ok  (1 recommended ausente, nenhum required faltando)
```

**Status block:**
```
✓ node        v22.3.0   /Users/x/.local/bin/node
✗ python3               não encontrado  [required — projeto Python detectado]
  → darwin: brew install python3  OU  pyenv install 3.12

BLOQUEADO: instale as dependências acima antes de continuar.
```

---

## Integração nos commands `.md`

**Padrão scan/doctor/init** — primeiro passo do command:

```bash
"${CLAUDE_PLUGIN_ROOT}/bin/aia-harness" check "${1:-$CLAUDE_PROJECT_DIR}" --json
```

Claude lê o JSON: se `report.status === 'block'` → para, exibe `report.missing[]` com `installHint[platform]`, não executa próximos passos.

**Padrão add-tools/add-plugins:**

```bash
"${CLAUDE_PLUGIN_ROOT}/bin/aia-harness" check "${1:-$CLAUDE_PROJECT_DIR}" \
  --tools=rtk,caveman,ponytail,graphify --json
```

### `commands/check-deps.md` (novo)

- Roda `check [dir] --json`
- Apresenta relatório completo em português
- Indica plataforma detectada (`process.platform`)
- Se `status: block`, lista cada dep faltante com hint de instalação
- Se `status: ok`, confirma que o ambiente está pronto

---

## Testes (`tests/detect-system-deps.test.mjs`)

| Cenário | Assertion |
|---------|-----------|
| Binário encontrado via PATH | `found: true`, `version` preenchida, `resolvedPath` válido |
| Binário encontrado via fallback fnm | `found: true`, path contém `.fnm` |
| Binário não encontrado | `found: false`, `version: null`, `resolvedPath: ''` |
| `resolveDepsFromProfile` stack Python | resultado inclui `python3`, `pip3`, `uv` |
| `resolveDepsFromProfile` stack Node puro | resultado **não** inclui `python3` |
| `checkSystemDeps` com required ausente | `status: 'block'`, `missing` contém o nome |
| `checkSystemDeps` só recommended ausente | `status: 'warn'`, `missing` vazio |
| `checkSystemDeps` todos presentes | `status: 'ok'` |
| Sub-comando `check` com block | exit code 1 |
| Sub-comando `check` com ok | exit code 0 |

Testes usam stubs de `execFileSync`/`existsSync` para não depender do ambiente real.

---

## Fora de escopo (não implementar agora)

- Auto-instalação de deps (só diagnosticar, não instalar)
- Verificação de versão mínima além de Node 18+ (engine já garante via `engines` no package.json)
- Checar deps de plugins de terceiros (marketplace) — escopo futuro
