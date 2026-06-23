# System Dependencies Checker — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Adicionar verificação cross-platform de dependências obrigatórias do sistema (node, python, go, etc.) que bloqueia `scan`, `doctor`, `init`, `add-tools` e `add-plugins` se alguma dep `required` estiver faltando, com mensagem clara de instalação por plataforma.

**Architecture:** Novo sub-comando `check` no engine (`bin/harness.mjs`) que chama `lib/detect/system-deps.mjs` (detecção pura) alimentado por `lib/data/deps-catalog.mjs` (dados). Todos os commands `.md` chamam `check --json` como primeiro passo; `status: "block"` → encerra sem continuar.

**Tech Stack:** Node ≥18, ESM `.mjs`, JSDoc types, `node:child_process.spawnSync`, `node:fs.accessSync`, `node --test`.

## Global Constraints

- Todos os arquivos `.mjs` com JSDoc — sem TypeScript, sem build step.
- `lib/` deve permanecer pura: sem IO de escrita, sem efeitos colaterais.
- `lib/detect/system-deps.mjs` pode ler o sistema (IO de leitura) — é um detector.
- `templates/` está excluído de lint e typecheck — não tocar.
- Run `npm test` (typecheck + lint + unit) antes de cada commit final.
- Testes em `node:test` + `node:assert/strict` — sem frameworks externos.
- Commits frequentes por tarefa.
- Plataformas: `win32`, `darwin`, `linux` — cobrir as três em toda lógica de paths.

---

### Task 1: Typedefs — `lib/profile.mjs`

**Files:**
- Modify: `lib/profile.mjs` (após `GitHubPMInfo` typedef, antes de `ProjectProfile`)

**Interfaces:**
- Produz: tipos `DepEntry`, `DepCheck`, `DepsReport` disponíveis via JSDoc import

- [ ] **Step 1: Adicionar typedefs ao `lib/profile.mjs`**

Abrir `lib/profile.mjs`. Após o bloco `@typedef GitHubPMInfo` (linha ~121) e antes de `@typedef ProjectProfile`, inserir:

```js
/**
 * @typedef {{ name: string, level: 'required'|'recommended' }} DepEntry
 */

/**
 * @typedef {Object} DepCheck
 * @property {string} name           Binary name, e.g. "node", "python3".
 * @property {boolean} found
 * @property {string|null} version   Parsed version string, or null if not found.
 * @property {string} resolvedPath   Absolute path to binary, or '' if not found.
 * @property {'required'|'recommended'} level
 * @property {Record<'win32'|'darwin'|'linux', string>} installHint
 */

/**
 * @typedef {Object} DepsReport
 * @property {'ok'|'warn'|'block'} status
 *   ok    = all required found.
 *   warn  = some recommended missing, no required missing.
 *   block = at least one required missing — engine exits 1.
 * @property {DepCheck[]} checks
 * @property {string[]} missing   Names of required deps not found.
 */
```

- [ ] **Step 2: Verificar typecheck passa**

```bash
npm run typecheck
```

Esperado: zero erros.

- [ ] **Step 3: Commit**

```bash
git add lib/profile.mjs
git commit -m "feat(system-deps): add DepCheck and DepsReport typedefs to profile.mjs"
```

---

### Task 2: Catálogo de deps — `lib/data/deps-catalog.mjs`

**Files:**
- Create: `lib/data/deps-catalog.mjs`

**Interfaces:**
- Produz:
  - `ENGINE_DEPS: DepEntry[]` — node, sempre obrigatório
  - `STACK_DEPS: Record<string, DepEntry[]>` — por chave de stack
  - `TOOL_DEPS: Record<string, DepEntry[]>` — por nome de tool
  - `INSTALL_HINTS: Record<string, Record<'win32'|'darwin'|'linux', string>>`
- Consumido por: `lib/detect/system-deps.mjs`

- [ ] **Step 1: Criar `lib/data/deps-catalog.mjs`**

```js
/**
 * System dependency catalog — maps stack keys and tool names to required
 * system binaries, with cross-platform install hints.
 *
 * Pure data module: no functions, no IO.
 * @module data/deps-catalog
 */

/** @typedef {import('../profile.mjs').DepEntry} DepEntry */

/** Always required — the engine itself needs Node. @type {DepEntry[]} */
export const ENGINE_DEPS = [
  { name: 'node', level: 'required' },
];

/**
 * Stack key → additional binary deps.
 * Node-only stacks need nothing extra (ENGINE_DEPS already covers node).
 * @type {Record<string, DepEntry[]>}
 */
export const STACK_DEPS = {
  python: [
    { name: 'python3', level: 'required' },
    { name: 'pip3',    level: 'recommended' },
    { name: 'uv',      level: 'recommended' },
  ],
  go:     [{ name: 'go',       level: 'required' }],
  php:    [{ name: 'php',      level: 'required' },
           { name: 'composer', level: 'required' }],
  ruby:   [{ name: 'ruby',     level: 'required' },
           { name: 'bundle',   level: 'required' }],
  java:   [{ name: 'java',     level: 'required' },
           { name: 'mvn',      level: 'recommended' }],
  rust:   [{ name: 'cargo',    level: 'required' }],
  dotnet: [{ name: 'dotnet',   level: 'required' }],
};

/**
 * Tool name → extra binary deps beyond what the stack already requires.
 * Most vendored tools (caveman, ponytail) need only node — already covered.
 * @type {Record<string, DepEntry[]>}
 */
export const TOOL_DEPS = {
  rtk:      [],
  graphify: [],
  caveman:  [],
  ponytail: [],
};

/**
 * Install hints per binary per platform.
 * @type {Record<string, Record<'win32'|'darwin'|'linux', string>>}
 */
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
  ruby: {
    win32:  'https://rubyinstaller.org/',
    darwin: 'brew install ruby',
    linux:  'sudo apt install ruby-full',
  },
  bundle: {
    win32:  'gem install bundler',
    darwin: 'gem install bundler',
    linux:  'gem install bundler',
  },
  cargo: {
    win32:  'winget install Rustlang.Rustup  OU  https://rustup.rs',
    darwin: 'curl --proto "=https" --tlsv1.2 -sSf https://sh.rustup.rs | sh',
    linux:  'curl --proto "=https" --tlsv1.2 -sSf https://sh.rustup.rs | sh',
  },
  java: {
    win32:  'winget install Microsoft.OpenJDK.21  OU  https://adoptium.net/',
    darwin: 'brew install --cask temurin',
    linux:  'sudo apt install default-jdk  OU  https://adoptium.net/',
  },
  mvn: {
    win32:  'winget install Apache.Maven  OU  https://maven.apache.org/download.cgi',
    darwin: 'brew install maven',
    linux:  'sudo apt install maven',
  },
  dotnet: {
    win32:  'winget install Microsoft.DotNet.SDK.8  OU  https://dotnet.microsoft.com/download',
    darwin: 'brew install --cask dotnet-sdk  OU  https://dotnet.microsoft.com/download',
    linux:  'https://dotnet.microsoft.com/download',
  },
};
```

- [ ] **Step 2: Verificar typecheck e lint**

```bash
npm run typecheck && npm run lint
```

Esperado: zero erros.

- [ ] **Step 3: Commit**

```bash
git add lib/data/deps-catalog.mjs
git commit -m "feat(system-deps): add deps-catalog with STACK_DEPS, TOOL_DEPS, INSTALL_HINTS"
```

---

### Task 3: Detector + resolução de perfil — `lib/detect/system-deps.mjs`

**Files:**
- Create: `lib/detect/system-deps.mjs`
- Create: `tests/detect-system-deps.test.mjs`

**Interfaces:**
- Consome: `ENGINE_DEPS`, `STACK_DEPS`, `TOOL_DEPS`, `INSTALL_HINTS` de `lib/data/deps-catalog.mjs`
- Consome: `ProjectProfile` de `lib/profile.mjs` (somente tipos)
- Produz:
  - `findBinary(name, platform, env): string|null` — exportada para testes
  - `checkSystemDeps(deps, platform): DepsReport`
  - `resolveDepsFromProfile(profile, installedTools): DepEntry[]`

- [ ] **Step 1: Escrever os testes que devem FALHAR**

Criar `tests/detect-system-deps.test.mjs`:

```js
/**
 * Tests for lib/detect/system-deps.mjs
 * Run: node --test tests/detect-system-deps.test.mjs
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { findBinary, checkSystemDeps, resolveDepsFromProfile } from '../lib/detect/system-deps.mjs';

// ─── helpers ────────────────────────────────────────────────────────────────

function withDir(fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aia-sysdeps-'));
  try { fn(dir); } finally { fs.rmSync(dir, { recursive: true, force: true }); }
}

/** Minimal ProjectProfile for tests. */
function profile(overrides = {}) {
  return {
    primaryLanguage: null,
    packageManagers: [],
    ...overrides,
  };
}

// ─── findBinary ─────────────────────────────────────────────────────────────

test('findBinary: binary in custom PATH is found', () => {
  withDir((dir) => {
    const bin = path.join(dir, process.platform === 'win32' ? 'fake-tool.cmd' : 'fake-tool');
    fs.writeFileSync(bin, process.platform === 'win32' ? '@echo off\necho 1.0.0\n' : '#!/bin/sh\necho "1.0.0"\n');
    if (process.platform !== 'win32') fs.chmodSync(bin, 0o755);

    const found = findBinary('fake-tool', process.platform, { PATH: dir });
    assert.equal(found, bin);
  });
});

test('findBinary: nonexistent binary returns null', () => {
  const found = findBinary('aia-definitely-not-installed-xyz', process.platform, { PATH: '' });
  assert.equal(found, null);
});

test('findBinary: node found via real PATH', () => {
  const found = findBinary('node', process.platform, process.env);
  assert.ok(found !== null, 'node must be findable in real PATH');
  assert.ok(fs.existsSync(found), `resolved path must exist: ${found}`);
});

test('findBinary: node found via FNM_DIR fallback when PATH is empty', () => {
  if (!process.env.FNM_DIR) return; // skip if fnm not in use
  const found = findBinary('node', process.platform, {
    PATH: '',
    FNM_DIR: process.env.FNM_DIR,
  });
  assert.ok(found !== null, 'node must be found via FNM_DIR fallback');
});

// ─── checkSystemDeps ────────────────────────────────────────────────────────

test('checkSystemDeps: node always found → status ok', () => {
  const report = checkSystemDeps([{ name: 'node', level: 'required' }], process.platform);
  assert.equal(report.status, 'ok');
  assert.deepEqual(report.missing, []);
  assert.equal(report.checks.length, 1);
  assert.equal(report.checks[0].name, 'node');
  assert.equal(report.checks[0].found, true);
  assert.ok(report.checks[0].version !== null, 'version should be parsed');
  assert.ok(report.checks[0].resolvedPath.length > 0);
});

test('checkSystemDeps: missing required binary → status block, name in missing[]', () => {
  const report = checkSystemDeps(
    [{ name: 'aia-nonexistent-required-abc', level: 'required' }],
    process.platform,
  );
  assert.equal(report.status, 'block');
  assert.ok(report.missing.includes('aia-nonexistent-required-abc'));
  assert.equal(report.checks[0].found, false);
  assert.equal(report.checks[0].version, null);
  assert.equal(report.checks[0].resolvedPath, '');
});

test('checkSystemDeps: missing recommended binary → status warn, missing[] stays empty', () => {
  const report = checkSystemDeps(
    [{ name: 'aia-nonexistent-recommended-abc', level: 'recommended' }],
    process.platform,
  );
  assert.equal(report.status, 'warn');
  assert.deepEqual(report.missing, []);
  assert.equal(report.checks[0].found, false);
});

test('checkSystemDeps: mix of found required + missing recommended → status ok', () => {
  const report = checkSystemDeps(
    [
      { name: 'node', level: 'required' },
      { name: 'aia-nonexistent-rec-xyz', level: 'recommended' },
    ],
    process.platform,
  );
  assert.equal(report.status, 'ok');
  assert.deepEqual(report.missing, []);
});

test('checkSystemDeps: installHint is populated for known binary', () => {
  const report = checkSystemDeps([{ name: 'node', level: 'required' }], 'darwin');
  assert.ok(report.checks[0].installHint.darwin.length > 0);
  assert.ok(report.checks[0].installHint.win32.length > 0);
  assert.ok(report.checks[0].installHint.linux.length > 0);
});

test('checkSystemDeps: empty deps list → status ok', () => {
  const report = checkSystemDeps([], process.platform);
  assert.equal(report.status, 'ok');
  assert.deepEqual(report.missing, []);
  assert.deepEqual(report.checks, []);
});

// ─── resolveDepsFromProfile ──────────────────────────────────────────────────

test('resolveDepsFromProfile: any project → node always included', () => {
  const deps = resolveDepsFromProfile(profile(), []);
  assert.ok(deps.some(d => d.name === 'node'));
});

test('resolveDepsFromProfile: node-only project → no python3', () => {
  const deps = resolveDepsFromProfile(
    profile({ primaryLanguage: 'TypeScript', packageManagers: [{ ecosystem: 'js' }] }),
    [],
  );
  assert.ok(!deps.some(d => d.name === 'python3'));
});

test('resolveDepsFromProfile: python project via primaryLanguage → includes python3, pip3, uv', () => {
  const deps = resolveDepsFromProfile(
    profile({ primaryLanguage: 'Python', packageManagers: [] }),
    [],
  );
  const names = deps.map(d => d.name);
  assert.ok(names.includes('python3'));
  assert.ok(names.includes('pip3'));
  assert.ok(names.includes('uv'));
});

test('resolveDepsFromProfile: python project via ecosystem → includes python3', () => {
  const deps = resolveDepsFromProfile(
    profile({ primaryLanguage: null, packageManagers: [{ ecosystem: 'python' }] }),
    [],
  );
  assert.ok(deps.some(d => d.name === 'python3'));
});

test('resolveDepsFromProfile: go project → includes go, excludes python3', () => {
  const deps = resolveDepsFromProfile(
    profile({ primaryLanguage: 'Go', packageManagers: [{ ecosystem: 'go' }] }),
    [],
  );
  const names = deps.map(d => d.name);
  assert.ok(names.includes('go'));
  assert.ok(!names.includes('python3'));
});

test('resolveDepsFromProfile: rust project → includes cargo', () => {
  const deps = resolveDepsFromProfile(
    profile({ primaryLanguage: 'Rust', packageManagers: [{ ecosystem: 'rust' }] }),
    [],
  );
  assert.ok(deps.some(d => d.name === 'cargo'));
});

test('resolveDepsFromProfile: java project via ecosystem → includes java', () => {
  const deps = resolveDepsFromProfile(
    profile({ primaryLanguage: 'Java', packageManagers: [{ ecosystem: 'jvm' }] }),
    [],
  );
  assert.ok(deps.some(d => d.name === 'java'));
});

test('resolveDepsFromProfile: no duplicate names even with overlapping lang+ecosystem', () => {
  const deps = resolveDepsFromProfile(
    profile({ primaryLanguage: 'Python', packageManagers: [{ ecosystem: 'python' }] }),
    [],
  );
  const names = deps.map(d => d.name);
  assert.equal(names.length, new Set(names).size, 'no duplicate dep names');
});

test('resolveDepsFromProfile: tool deps merged without duplicates', () => {
  const deps = resolveDepsFromProfile(
    profile({ primaryLanguage: 'TypeScript', packageManagers: [{ ecosystem: 'js' }] }),
    ['rtk', 'caveman', 'ponytail'],
  );
  const names = deps.map(d => d.name);
  // rtk/caveman/ponytail add nothing extra (only node, already present)
  assert.equal(names.length, new Set(names).size);
  assert.ok(names.includes('node'));
});
```

- [ ] **Step 2: Rodar testes — verificar que FALHAM**

```bash
node --test tests/detect-system-deps.test.mjs
```

Esperado: erro de import (`Cannot find module '../lib/detect/system-deps.mjs'`).

- [ ] **Step 3: Criar `lib/detect/system-deps.mjs`**

```js
/**
 * Cross-platform system dependency detection.
 *
 * findBinary   — resolves a binary name to an absolute path (PATH + fallbacks).
 * checkSystemDeps — checks a list of deps and returns a DepsReport.
 * resolveDepsFromProfile — infers which deps to check from a ProjectProfile.
 *
 * @module detect/system-deps
 */
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import {
  ENGINE_DEPS,
  STACK_DEPS,
  TOOL_DEPS,
  INSTALL_HINTS,
} from '../data/deps-catalog.mjs';

/** @typedef {import('../profile.mjs').DepEntry} DepEntry */
/** @typedef {import('../profile.mjs').DepCheck} DepCheck */
/** @typedef {import('../profile.mjs').DepsReport} DepsReport */

/**
 * Extra candidate paths to check beyond PATH, per binary name.
 * @param {string} name
 * @param {string} platform
 * @param {Record<string,string|undefined>} env
 * @returns {string[]}
 */
function extraCandidates(name, platform, env) {
  const home = env.HOME ?? env.USERPROFILE ?? '';
  if (name === 'node') {
    const c = [];
    if (env.FNM_DIR) c.push(
      path.join(env.FNM_DIR, 'aliases', 'default', 'bin', 'node'),
    );
    if (env.NVM_DIR) c.push(
      path.join(env.NVM_DIR, 'alias', 'default'),
    );
    if (platform === 'win32') {
      const ap = env.APPDATA ?? '';
      c.push(path.join(ap, 'fnm', 'aliases', 'default', 'node.exe'));
    }
    return c;
  }
  if (name === 'python3' || name === 'python') {
    const c = [];
    if (env.PYENV_ROOT) c.push(path.join(env.PYENV_ROOT, 'shims', 'python3'));
    if (platform === 'win32') {
      const la = env.LOCALAPPDATA ?? '';
      c.push(path.join(la, 'Programs', 'Python', 'Python312', 'python.exe'));
      c.push(path.join(la, 'Programs', 'Python', 'Python311', 'python.exe'));
    }
    return c;
  }
  if (name === 'uv' || name === 'cargo' || name === 'rustup') {
    const cargoHome = env.CARGO_HOME ?? path.join(home, '.cargo');
    return [path.join(cargoHome, 'bin', name)];
  }
  if (name === 'pip3' || name === 'pip') {
    const c = [];
    if (env.PYENV_ROOT) c.push(path.join(env.PYENV_ROOT, 'shims', name));
    if (home) c.push(path.join(home, '.local', 'bin', name));
    return c;
  }
  return [];
}

/**
 * Resolve a binary name to its absolute path, or null if not found.
 * Searches PATH first, then platform-specific fallback locations.
 *
 * @param {string} name
 * @param {string} platform  process.platform value
 * @param {Record<string,string|undefined>} env  pass process.env for real use; custom env for tests
 * @returns {string|null}
 */
export function findBinary(name, platform, env) {
  const sep = platform === 'win32' ? ';' : ':';
  const exts = platform === 'win32' ? ['.exe', '.cmd', '.bat', ''] : [''];
  const pathDirs = (env.PATH ?? '').split(sep).filter(Boolean);

  for (const dir of [...pathDirs, ...extraCandidates(name, platform, env)]) {
    for (const ext of exts) {
      const candidate = dir.endsWith(name) || dir.endsWith(name + ext)
        ? dir  // extraCandidates returns full paths
        : path.join(dir, name + ext);
      try {
        fs.accessSync(candidate, fs.constants.F_OK);
        return candidate;
      } catch { /* not found here */ }
    }
  }
  return null;
}

/**
 * Get a version string for a resolved binary using spawnSync.
 * Tries '--version' then 'version' (as subcommand) to cover most CLIs.
 * @param {string} name     Binary name (used to pick the right flag).
 * @param {string} binPath  Resolved absolute path.
 * @returns {string|null}
 */
function getVersion(name, binPath) {
  const flagSets = {
    go:   [['version']],
    php:  [['-v']],
    mvn:  [['--version']],
  };
  const attempts = flagSets[name] ?? [['--version'], ['version']];
  for (const args of attempts) {
    const r = spawnSync(binPath, args, { timeout: 5000, encoding: 'utf8' });
    const combined = (r.stdout ?? '') + (r.stderr ?? '');
    const m = combined.match(/\d+\.\d+[\d.]*/);
    if (m) return m[0];
  }
  return null;
}

/**
 * Check whether each dep is available on this platform.
 *
 * @param {DepEntry[]} deps      List produced by resolveDepsFromProfile.
 * @param {string}     platform  process.platform: 'win32'|'darwin'|'linux'
 * @returns {DepsReport}
 */
export function checkSystemDeps(deps, platform) {
  /** @type {DepCheck[]} */
  const checks = [];
  /** @type {string[]} */
  const missing = [];

  const plat = /** @type {'win32'|'darwin'|'linux'} */ (
    platform === 'win32' ? 'win32' : platform === 'darwin' ? 'darwin' : 'linux'
  );

  for (const dep of deps) {
    const resolvedPath = findBinary(dep.name, platform, process.env) ?? '';
    const found = resolvedPath.length > 0;
    const version = found ? getVersion(dep.name, resolvedPath) : null;
    const hints = INSTALL_HINTS[dep.name] ?? { win32: '', darwin: '', linux: '' };

    checks.push({
      name: dep.name,
      found,
      version,
      resolvedPath,
      level: dep.level,
      installHint: hints,
    });

    if (!found && dep.level === 'required') missing.push(dep.name);
  }

  const status = missing.length > 0
    ? 'block'
    : checks.some(c => !c.found)
      ? 'warn'
      : 'ok';

  return { status, checks, missing };
}

/**
 * Derive which system deps to check from a project profile + installed tools.
 * Engine deps (node) are always included.
 *
 * @param {Pick<import('../profile.mjs').ProjectProfile, 'primaryLanguage'|'packageManagers'>} profile
 * @param {string[]} installedTools  Tool names, e.g. ['rtk', 'graphify'].
 * @returns {DepEntry[]}
 */
export function resolveDepsFromProfile(profile, installedTools = []) {
  /** @type {Map<string, DepEntry>} */
  const seen = new Map();

  function add(/** @type {DepEntry[]} */ deps) {
    for (const d of deps) {
      if (!seen.has(d.name)) seen.set(d.name, d);
    }
  }

  add(ENGINE_DEPS);

  const ecosystems = new Set((profile.packageManagers ?? []).map(pm => pm.ecosystem));
  const lang = (profile.primaryLanguage ?? '').toLowerCase();

  if (lang === 'python' || ecosystems.has('python')) add(STACK_DEPS.python ?? []);
  if (lang === 'go'     || ecosystems.has('go'))     add(STACK_DEPS.go     ?? []);
  if (lang === 'php'    || ecosystems.has('php'))    add(STACK_DEPS.php    ?? []);
  if (lang === 'ruby'   || ecosystems.has('ruby'))   add(STACK_DEPS.ruby   ?? []);
  if (['java', 'kotlin', 'scala', 'groovy'].includes(lang) || ecosystems.has('jvm'))
    add(STACK_DEPS.java ?? []);
  if (lang === 'rust'   || ecosystems.has('rust'))   add(STACK_DEPS.rust   ?? []);
  if (lang === 'c#'     || ecosystems.has('dotnet')) add(STACK_DEPS.dotnet ?? []);

  for (const tool of installedTools) {
    add(TOOL_DEPS[tool] ?? []);
  }

  return [...seen.values()];
}
```

- [ ] **Step 4: Rodar testes — verificar que PASSAM**

```bash
node --test tests/detect-system-deps.test.mjs
```

Esperado: todos os testes passam. O teste `findBinary: node found via FNM_DIR fallback` é pulado automaticamente se `FNM_DIR` não estiver no env.

- [ ] **Step 5: Verificar typecheck e lint**

```bash
npm run typecheck && npm run lint
```

Esperado: zero erros.

- [ ] **Step 6: Rodar suite completa**

```bash
npm test
```

Esperado: zero falhas.

- [ ] **Step 7: Commit**

```bash
git add lib/detect/system-deps.mjs tests/detect-system-deps.test.mjs
git commit -m "feat(system-deps): add system-deps detector with cross-platform binary resolution"
```

---

### Task 4: Sub-comando `check` — `bin/harness.mjs`

**Files:**
- Modify: `bin/harness.mjs`

**Interfaces:**
- Consome: `checkSystemDeps`, `resolveDepsFromProfile` de `lib/detect/system-deps.mjs`
- Produz: `bin/aia-harness check [dir] [--json] [--tools=...]` → exit 0 (ok/warn) ou exit 1 (block)

- [ ] **Step 1: Adicionar import no topo de `bin/harness.mjs`**

Na linha 14 (após `import { applyPlan } ...`), adicionar:

```js
import { checkSystemDeps, resolveDepsFromProfile } from '../lib/detect/system-deps.mjs';
```

- [ ] **Step 2: Adicionar `formatDepsReport` como função privada**

Adicionar após `printApply()` e antes de `main()`:

```js
/**
 * Render a DepsReport as human-readable text for CLI output.
 * @param {import('../lib/profile.mjs').DepsReport} report
 * @param {string} platform
 * @returns {string}
 */
function formatDepsReport(report, platform) {
  const plat = /** @type {'win32'|'darwin'|'linux'} */ (
    platform === 'win32' ? 'win32' : platform === 'darwin' ? 'darwin' : 'linux'
  );
  const lines = [];
  for (const c of report.checks) {
    if (c.found) {
      lines.push(`✓ ${c.name.padEnd(12)} v${c.version ?? '?'}   ${c.resolvedPath}`);
    } else {
      lines.push(`✗ ${c.name.padEnd(12)} não encontrado  [${c.level}]`);
      const hint = c.installHint[plat];
      if (hint) lines.push(`  → ${plat}: ${hint}`);
    }
  }
  lines.push('');
  if (report.status === 'block') {
    lines.push('BLOQUEADO: instale as dependências acima antes de continuar.');
  } else if (report.status === 'warn') {
    const n = report.checks.filter(c => !c.found).length;
    lines.push(`STATUS: ok  (${n} recommended ausente${n !== 1 ? 's' : ''}, nenhum required faltando)`);
  } else {
    lines.push('STATUS: ok  todas as dependências encontradas.');
  }
  return lines.join('\n');
}
```

- [ ] **Step 3: Adicionar o sub-comando `check` em `main()`**

Em `main()`, após o bloco `if (cmd === 'scan')` (linha ~97), inserir:

```js
  if (cmd === 'check') {
    const toolList = opts.tools
      ? opts.tools.split(',').map((s) => s.trim()).filter(Boolean)
      : [];
    const profile = scanProject(dir);
    const deps = resolveDepsFromProfile(profile, toolList);
    const report = checkSystemDeps(deps, process.platform);
    if (flags.has('json')) {
      console.log(JSON.stringify(report, null, 2));
    } else {
      console.log(formatDepsReport(report, process.platform));
    }
    return report.status === 'block' ? 1 : 0;
  }
```

- [ ] **Step 4: Atualizar `printHelp()` para incluir `check`**

Substituir a linha `aia-harness help | version` no help string por:

```
  aia-harness check [dir] [--json]      Check required system dependencies.
                    [--tools=a,b]       Also check deps for specific tools.
  aia-harness help | version
```

(A string completa fica após o bloco `apply` na função `printHelp()`.)

- [ ] **Step 5: Verificar manualmente**

```bash
node bin/harness.mjs check . 
```

Esperado: relatório legível com `✓ node` e `STATUS: ok ...`.

```bash
node bin/harness.mjs check . --json | node -e "const r=JSON.parse(require('fs').readFileSync('/dev/stdin','utf8')); console.log(r.status)"
```

Esperado: `ok` (ou `warn` se algum recommended ausente).

- [ ] **Step 6: Verificar typecheck e lint**

```bash
npm run typecheck && npm run lint
```

Esperado: zero erros.

- [ ] **Step 7: Commit**

```bash
git add bin/harness.mjs
git commit -m "feat(system-deps): add 'check' sub-command to harness CLI"
```

---

### Task 5: Novo comando `/check-deps` — `commands/check-deps.md`

**Files:**
- Create: `commands/check-deps.md`

**Interfaces:**
- Chama: `bin/aia-harness check [dir] --json`
- Apresenta relatório em português ao usuário

- [ ] **Step 1: Criar `commands/check-deps.md`**

```markdown
---
description: Verifica dependências obrigatórias do sistema (Node, Python, Go, etc.) antes de operações do harness.
argument-hint: "[path]"
allowed-tools:
  - Bash
---

# Verificar dependências do sistema

Target directory: `$1` if provided, else `$CLAUDE_PROJECT_DIR`.

1. Rodar o checker:

   ```bash
   "${CLAUDE_PLUGIN_ROOT}/bin/aia-harness" check "${1:-$CLAUDE_PROJECT_DIR}" --json
   ```

2. Detectar a plataforma do usuário a partir do campo `process.platform` no JSON
   (ou via `node -e "console.log(process.platform)"`).

3. Apresentar o relatório em português:
   - **Plataforma detectada:** darwin / linux / win32
   - Para cada dep em `checks[]`:
     - `✓ <name>  v<version>   <resolvedPath>` se `found: true`
     - `✗ <name>  não encontrado  [<level>]` + hint de instalação para a plataforma se `found: false`
   - **Status geral:** ok / warn / block

4. Se `status === "block"`:
   - Destacar as deps em `missing[]` e seus `installHint[platform]`
   - Informar que **nenhuma operação do harness pode continuar** até que sejam instaladas
   - Não executar nenhum próximo passo

5. Se `status === "ok"` ou `"warn"`:
   - Confirmar que o ambiente está pronto
   - Se `warn`: mencionar as deps recommended ausentes com seus hints, mas sem bloquear
```

- [ ] **Step 2: Verificar que o comando é invocável**

```bash
"${CLAUDE_PLUGIN_ROOT}/bin/aia-harness" check . --json
```

Esperado: JSON com `status`, `checks`, `missing`.

- [ ] **Step 3: Commit**

```bash
git add commands/check-deps.md
git commit -m "feat(system-deps): add /check-deps command"
```

---

### Task 6: Integrar `check` nos commands existentes

**Files:**
- Modify: `commands/scan.md`
- Modify: `commands/init.md`
- Modify: `commands/doctor.md`
- Modify: `commands/add-tools.md`
- Modify: `commands/add-plugins.md`

**Interfaces:**
- Consome: `bin/aia-harness check [dir] [--tools=...] --json`
- Padrão: se `status === "block"` → apresentar `missing[]` com hints e encerrar; não executar próximos passos

#### `commands/scan.md`

- [ ] **Step 1: Adicionar step 0 em `commands/scan.md`**

Inserir **antes** do passo "Run:" existente (que chama `scan`), como novo passo numerado:

```markdown
## 0. Verificar dependências do sistema

```bash
"${CLAUDE_PLUGIN_ROOT}/bin/aia-harness" check "${1:-$CLAUDE_PROJECT_DIR}" --json
```

Ler o JSON retornado. Se `status === "block"`: apresentar em português a lista de `missing[]`
com `installHint` para a plataforma do usuário e encerrar — não executar os passos seguintes.
```

#### `commands/init.md`

- [ ] **Step 2: Adicionar step 0 em `commands/init.md`**

Inserir como primeiro item do `## Flow`, antes do **"1. Diagnose."** existente:

```markdown
## 0. Verificar dependências do sistema

```bash
"${CLAUDE_PLUGIN_ROOT}/bin/aia-harness" check "${1:-$CLAUDE_PROJECT_DIR}" --json
```

Se `status === "block"`: apresentar em português a lista de `missing[]` com `installHint`
para a plataforma do usuário e encerrar — não executar os passos seguintes.
```

#### `commands/doctor.md`

- [ ] **Step 3: Adicionar step 0 em `commands/doctor.md`**

Inserir antes do passo "1. Re-scan to see what exists:" existente:

```markdown
## 0. Verificar dependências do sistema

```bash
"${CLAUDE_PLUGIN_ROOT}/bin/aia-harness" check "${1:-$CLAUDE_PROJECT_DIR}" --json
```

Se `status === "block"`: apresentar em português a lista de `missing[]` com `installHint`
para a plataforma do usuário e encerrar — não executar os passos seguintes.
```

#### `commands/add-tools.md`

- [ ] **Step 4: Substituir a seção "2. Detect machine dependencies" em `commands/add-tools.md`**

Substituir toda a seção `## 2. Detect machine dependencies` (bloco com `command -v node; command -v rtk...`) por:

```markdown
## 2. Verificar dependências do sistema

```bash
"${CLAUDE_PLUGIN_ROOT}/bin/aia-harness" check "${1:-$CLAUDE_PROJECT_DIR}" \
  --tools=rtk,caveman,ponytail,graphify --json
```

Ler o JSON. Se `status === "block"`: apresentar em português a lista de `missing[]` com
`installHint` para a plataforma e encerrar sem instalar nada.

Se `status !== "block"`: prosseguir. Para cada dep em `checks[]` com `found: false`:
informar ao usuário o que está ausente (apenas recommended neste caso) e perguntar se deseja
instalar no passo 3.
```

#### `commands/add-plugins.md`

- [ ] **Step 5: Adicionar step 0 em `commands/add-plugins.md`**

Inserir antes do passo "1." existente (que gera `install-plugins.mjs`):

```markdown
## 0. Verificar dependências do sistema

```bash
"${CLAUDE_PLUGIN_ROOT}/bin/aia-harness" check "${1:-$CLAUDE_PROJECT_DIR}" --json
```

Se `status === "block"`: apresentar em português a lista de `missing[]` com `installHint`
para a plataforma do usuário e encerrar — não executar os passos seguintes.
```

- [ ] **Step 6: Verificar typecheck e suite completa**

```bash
npm test
```

Esperado: zero falhas.

- [ ] **Step 7: Commit final**

```bash
git add commands/scan.md commands/init.md commands/doctor.md commands/add-tools.md commands/add-plugins.md
git commit -m "feat(system-deps): integrate check step into all harness commands"
```

---

## Self-review checklist

### Spec coverage

| Requisito | Task |
|-----------|------|
| Block on required missing | Task 3 (`checkSystemDeps` status=block), Task 4 (exit 1) |
| Stack-inferred deps | Task 3 (`resolveDepsFromProfile`) |
| Hook/tool deps | Task 2 (`TOOL_DEPS`), Task 3 (`resolveDepsFromProfile`) |
| Engine layer `bin/harness.mjs` | Task 4 |
| Cross-platform: Win/Mac/Linux | Task 3 (`extraCandidates`, `INSTALL_HINTS`) |
| New `lib/data/deps-catalog.mjs` | Task 2 |
| New `lib/detect/system-deps.mjs` | Task 3 |
| New `commands/check-deps.md` | Task 5 |
| `bin/harness.mjs` check sub-command | Task 4 |
| `scan.md`, `doctor.md`, `init.md` updated | Task 6 |
| `add-tools.md`, `add-plugins.md` updated | Task 6 |
| Tests em `node:test` | Task 3 |
| `lib/profile.mjs` typedefs | Task 1 |

### Consistência de tipos

- `DepEntry = {name: string, level: 'required'|'recommended'}` — definido em profile.mjs (Task 1), usado em Tasks 2, 3.
- `DepsReport = {status, checks, missing}` — definido em profile.mjs (Task 1), retornado por `checkSystemDeps` (Task 3), lido em `main()` (Task 4).
- `findBinary(name, platform, env)` — exportada em Task 3, usada internamente em `checkSystemDeps` (Task 3) e testada diretamente (Task 3 testes).
- `formatDepsReport(report, platform)` — privada em Task 4, não exportada.

### Sem placeholders

Verificado: todas as funções têm implementação completa. Todos os testes têm asserts concretos. Todos os comandos `.md` têm o exato bloco bash a inserir.
