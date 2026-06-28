---
paths:
  - "hooks/**"
  - ".claude/hooks/**"
  - "templates/hooks/**"
---

# Hooks — cross-platform `.mjs` standard

## Objective

Every hook must run identically on macOS, Linux, and Windows (native and WSL)
with zero platform-specific wrappers. **Every hook is authored as `.mjs` and
invoked through Node's exec form. No exceptions, no conditional fallbacks.**
Node.js is the only runtime guaranteed reachable across all platforms, so it is
the single allowed hook runtime in this project.

## Runtime decision

`.mjs` + `node` is the **only** accepted hook runtime here. The rows below are
**why every alternative is rejected**, not when they may be used — never read a
condition (`only if`, `ok with`) as permission to ship a non-`.mjs` hook.

```
.mjs + node  →  cross-platform standard. ALWAYS use. Only allowed runtime.
.sh          →  rejected. Breaks on native Windows (needs WSL/Git Bash).
python       →  rejected. python3 path traps on Windows; needs UV; extra dep.
PowerShell   →  rejected. Windows-only.
Go/Rust bin  →  not for hooks. Use only for distributed CLIs (e.g. rtk).
```

| Runtime | macOS | Linux | Windows native | WSL |
| --- | --- | --- | --- | --- |
| `node` + exec form `.mjs` | ✅ | ✅ | ✅ (if node installed) | ✅ |
| `bash` / `.sh` | ✅ | ✅ | ❌ (Git Bash required) | ✅ |
| `python3` | ✅ | ✅ | ⚠️ App Execution Alias trap | ✅ |
| `python` | ✅ | ⚠️ may not exist | ❌ | ⚠️ |
| PowerShell | ❌ | ❌ | ✅ | ⚠️ |
| npm/npx shim in exec form | ✅ | ✅ | ❌ (`.cmd` is not a real `.exe`) | ✅ |

## Mandatory rules

- Write **every** hook as `.mjs` (Node ESM). No exceptions — never `.js`, `.ts`, `.sh`, `.bat`, or `.ps1`, regardless of stack, platform, or perceived convenience.
- If you are tempted to author a hook in any other runtime, stop and rewrite it as `.mjs` before continuing.
- Wire hooks in `settings.json` using **exec form** (`command: "node"` + `args`), never shell form.
- Reference the hook script through the `$CLAUDE_PROJECT_DIR` env var so it resolves from any working directory.
- Read JSON from stdin, write JSON to stdout, exit with `0` or `2` only — every other exit code is a bug.
- Validate every output path against the matching validator in [lib/validate/hook-schema.mjs](lib/validate/hook-schema.mjs) for the hook's event type; cover **all branches**, not just the happy path.
- Add `tests/hook-<name>.test.mjs` importing the validator and asserting every output branch.
- Keep `npm run lint` and `npm run typecheck` clean (JSDoc + `checkJs`). Pre-existing errors are not an excuse to add more.
- Use `os.homedir()`, `os.tmpdir()`, and `path.join()` for every path, home, and temp reference.
- **MANDATORY** — every `spawn` / `exec` / `execFile` / `fork` call inside a hook **must** pass `windowsHide: true` in its options. Issue [#19012](https://github.com/anthropics/claude-code/issues/19012): without it, spawning Node.js (or any console app) flashes a console window on Windows. The option is a no-op on macOS/Linux, so always set it — no condition.
- To run an npm-installed tool (eslint, prettier, tsc) from a hook on Windows, invoke its JS entrypoint directly via `node`, never the `node_modules/.bin` shim.

## Forbidden

- Don't author a hook in anything but `.mjs` — no `.sh`, `.bat`, `.ps1`, `.py`, or any platform-specific shell, under any condition.
- Don't use shell form (`command: "node \"...\""`) — quoting and shell availability break on Windows.
- Don't hardcode `$HOME` / `%USERPROFILE%`, `/tmp` / `$env:TEMP`, or `/` / `\\` path separators.
- Don't ship a Python hook at all — App Execution Alias stubs shadow `python.exe`/`python3.exe` on stock Windows and redirect to the Microsoft Store. (Python's `python` vs `python3` split and UV dependency are extra reasons; the rule is simply: rewrite it as `.mjs`.)
- Don't reference `npm`, `npx`, `eslint`, or any `.cmd`/`.bat` shim as the exec-form `command` — those are not real executables and can't be spawned without a shell.
- Don't assume `jq`. Parse JSON in Node, not with an external binary.
- Don't return more than one decision field or emit malformed `hookSpecificOutput` — a bad schema fails silently in production.

## Portability patterns inside the `.mjs`

```js
import os from 'node:os'
import path from 'node:path'

// ✅ Cross-platform
const home = os.homedir()             // instead of $HOME / %USERPROFILE%
const tmp = os.tmpdir()               // instead of /tmp / $env:TEMP
const p = path.join(home, '.config') // instead of hardcoded / or \\
```

Spawning a child process — `windowsHide: true` is **mandatory**, always:

```js
import { spawn } from 'node:child_process'

// ✅ windowsHide prevents the Windows console flash (issue #19012); no-op on macOS/Linux
const child = spawn('node', [scriptPath], { windowsHide: true })
```

## Wiring in settings.json

Exec form — **use this** (cross-platform safe, no shell):

```json
{ "command": "node", "args": ["${CLAUDE_PROJECT_DIR}/.claude/hooks/hook.mjs"] }
```

Shell form — **do not use** (Windows breaks on quoting / missing shell):

```json
{ "command": "node \"$CLAUDE_PROJECT_DIR/.claude/hooks/hook.mjs\"" }
```

Running an npm tool from a hook on Windows — invoke the JS entrypoint, not the shim:

```json
{ "command": "node", "args": ["${CLAUDE_PLUGIN_ROOT}/node_modules/eslint/bin/eslint.js", "--fix", "."] }
```

## What Anthropic officially says

The hook API is **language-agnostic** — anything that reads JSON from stdin,
writes JSON to stdout, and exits with the correct code (`0`, `2`) works. Official
examples default to bash, and the docs ship **no cross-platform guidance** (the
only alternative-runtime mention is a one-line jq-fallback tip). Treat the
`.mjs` exec-form standard above as the project's portability layer over that gap.

Default shell per platform when shell form is used (`"command": "bash script.sh"`):

| Platform | Default shell |
| --- | --- |
| macOS/Linux | `sh -c` |
| Windows | Git Bash (or PowerShell if Git Bash is absent) |

A `"shell"` field can force PowerShell on Windows — Windows-only, avoid in this project:

```json
{ "type": "command", "command": "script.ps1", "shell": "powershell" }
```

## Caveats

- **Node is not bundled on every platform.** The 2025 native Windows installer dropped the bundled Node.js runtime, so `node` in a hook depends on the user having Node installed. It remains the most reliable target, but it is not unconditionally guaranteed.
- **Windows console flash.** Issue [#19012](https://github.com/anthropics/claude-code/issues/19012) — hooks flash a console window when spawning Node.js on Windows. Closed as not planned. The fix (`windowsHide: true` on every internal spawn) is **mandatory** in this project, not optional — see the Mandatory rules. The flash is cosmetic and does not affect behavior, but the option is required on every spawn regardless.

## Acceptance criteria

- The hook is `.mjs` and wired via exec form (`node` + `args`) with `$CLAUDE_PROJECT_DIR`.
- No `.sh`/`.bat`/`.ps1`, no shell form, no hardcoded paths, home, or temp.
- All path/home/temp access goes through `path.join` / `os.homedir` / `os.tmpdir`.
- Every output branch passes the matching `hook-schema.mjs` validator.
- `tests/hook-<name>.test.mjs` asserts every branch; `npm test` is green.
- No dependency on `jq`, `python`, npm shims, or any platform-specific binary.
- Every `spawn`/`exec`/`execFile`/`fork` call passes `windowsHide: true`.
