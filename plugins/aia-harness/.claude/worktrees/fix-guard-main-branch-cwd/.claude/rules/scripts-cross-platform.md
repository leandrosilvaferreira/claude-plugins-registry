---
paths:
  - "scripts/**"
  - "bin/**"
  - "lib/**"
  - "templates/tools/**"
  - "templates/skills/**"
---

# Scripts & plugin assets — cross-platform `.mjs` standard

> **Scope:** `scripts/`, `bin/`, `lib/`, `templates/tools/`, `templates/skills/`.
> Hook paths (`hooks/`, `.claude/hooks/`, `templates/hooks/`) are covered separately by
> [hooks-cross-platform.md](hooks-cross-platform.md) — the rules there take precedence for hooks.

## Objective

Every script, CLI entrypoint, vendoring utility, install helper, and
skill-referenced code file must run identically on macOS, Linux, and
Windows (native and WSL) with zero platform-specific wrappers.
**All executable scripts are authored as `.mjs` and run with `node`.
No shell scripts, no `.bat`, no `.ps1`, no `.py`. No exceptions.**

## Runtime decision

```
.mjs + node  →  cross-platform standard. ALWAYS use. Only allowed runtime.
.sh          →  rejected. Breaks on native Windows (needs WSL/Git Bash).
.bat / .ps1  →  rejected. Windows-only.
python       →  rejected. python3 path traps on Windows; App Execution Alias stubs.
Go/Rust bin  →  not for scripts. Use only for distributed CLIs (e.g. rtk).
```

| Runtime | macOS | Linux | Windows native | WSL |
| --- | --- | --- | --- | --- |
| `node` + `.mjs` | ✅ | ✅ | ✅ (if node installed) | ✅ |
| `bash` / `.sh` | ✅ | ✅ | ❌ (Git Bash required) | ✅ |
| `python3` | ✅ | ✅ | ⚠️ App Execution Alias trap | ✅ |
| PowerShell | ❌ | ❌ | ✅ | ⚠️ |

## Mandatory rules

- Write **every** script as `.mjs` (Node ESM). No exceptions — not `.js`, `.ts`,
  `.sh`, `.bat`, `.ps1`, or `.py`, regardless of perceived convenience.
- Use `node scripts/foo.mjs` (or `node bin/foo.mjs`) to invoke — never wrap in a shell command.
- In `package.json` scripts, invoke via `node`, not via shell form:

  ```json
  "sync:ecc": "node scripts/sync-ecc.mjs"
  ```

- Declare the node shebang at the top of every standalone script:

  ```js
  #!/usr/bin/env node
  ```

- Use `node:os`, `node:path`, and `node:url` for every system path — never
  hardcode separators, home dirs, or temp dirs.
- When spawning a child process from a script, pass `windowsHide: true` to
  suppress the Windows console flash (issue [#19012](https://github.com/anthropics/claude-code/issues/19012));
  the option is a no-op on macOS/Linux — always set it unconditionally.
- Never call `npm`, `npx`, or any `.cmd`/`.bat` shim as `spawn`/`exec` command —
  invoke the JS entrypoint directly via `node` instead.
- Don't assume `jq` or any external binary parser. Parse JSON in Node.

## Portability patterns

```js
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

// ✅ Resolve __dirname in ESM
const __dirname = path.dirname(fileURLToPath(import.meta.url))

// ✅ Cross-platform paths
const home = os.homedir()             // instead of $HOME / %USERPROFILE%
const tmp  = os.tmpdir()              // instead of /tmp / $env:TEMP
const cfg  = path.join(home, '.config', 'my-tool')  // instead of hardcoded / or \\

// ✅ Spawning a child process — windowsHide is mandatory
import { spawn } from 'node:child_process'
const child = spawn('node', [path.join(__dirname, 'helper.mjs')], {
  windowsHide: true,   // prevents Windows console flash; no-op on macOS/Linux
  stdio: 'inherit',
})
```

## Skills that reference scripts

Skills under `templates/skills/` or `skills/` may instruct the agent to run
scripts. Every such instruction must:

- Reference the script as a `.mjs` file run with `node`.
- Use `$CLAUDE_PROJECT_DIR` or relative paths resolvable from the repo root —
  never absolute machine paths.
- Never embed a shell one-liner that relies on `bash`, `sh`, `python`, or `jq`.

## Forbidden

- Don't create `.sh`, `.bat`, `.ps1`, or `.py` scripts — rewrite as `.mjs`.
- Don't hardcode `$HOME`, `%USERPROFILE%`, `/tmp`, `$env:TEMP`, or path separators.
- Don't call `npm`, `npx`, or `.cmd` shims as spawn targets.
- Don't parse JSON with `jq` — use `JSON.parse` in Node.
- Don't use shell form in `package.json` scripts to wrap node invocations.
- Don't call `python` or `python3` — even with UV, the path trap on Windows applies.

## Acceptance criteria

- All scripts are `.mjs` invoked via `node`.
- No `.sh`, `.bat`, `.ps1`, or `.py` in scope paths.
- All path, home, and temp references use `path.join` / `os.homedir` / `os.tmpdir`.
- Every `spawn`/`exec`/`execFile`/`fork` passes `windowsHide: true`.
- `package.json` script entries invoke `node <file>.mjs`, never a shell wrapper.
- No assumptions about `jq`, `bash`, `python`, or any external binary.
