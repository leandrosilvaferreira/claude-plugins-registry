# Design: 8 Correções — aia-harness

**Date:** 2026-06-27  
**Status:** Approved

---

## Scope

Eight targeted bug fixes. No new features, no refactors beyond what is needed to fix each issue. Each fix is surgical: one root cause, one change location.

---

## Issue 1 — Windows: spawnSync não resolve `.cmd`

### Problem

`lib/generate/misc.mjs` generates `scripts/install-plugins.mjs` into target projects. That generated script calls `spawnSync("claude", ...)` three times. On Windows, Node.js does not resolve `.cmd` extensions without a shell, so `claude.cmd` is never found. The generator also uses `spawnSync("claude", ...)` internally (the check at line 105).

### Fix

Add `{ shell: true }` to every `spawnSync("claude", ...)` call in the generated template string inside `lib/generate/misc.mjs`. This delegates resolution to the OS shell (cmd.exe on Windows, /bin/sh on Unix), which handles `.cmd` automatically — no PowerShell wrapper needed, no platform branching.

**Files:** `lib/generate/misc.mjs`

### Acceptance

Generated `scripts/install-plugins.mjs` uses `{ shell: true }` on all three `spawnSync("claude", ...)` calls. `claude --version` check resolves on Windows.

---

## Issue 2 — RTK cli.js: path duplicado no Windows

### Problem

The npm package named "rtk" (a different package from the real RTK) has a bug at `cli.js:6`:

```js
const DIRNAME = p.dirname(import.meta.url).replace('file://', '');
```

On Windows, `import.meta.url` is `file:///C:/...`. Stripping `file://` leaves `/C:/...`. Path resolves as `C:\C:\...` (drive duplicated). Hook fails open; RTK savings are zero.

### Fix

This bug is in the wrong npm package. Fix is entirely via Issue 3: install the real RTK binary from GitHub (native binary, no Node.js path code, no this bug).

**No code change in this repo for Issue 2.**

---

## Issue 3 — RTK: pacote npm errado; instalar do GitHub

### Problem

The harness documentation and `commands/add-tools.md` may guide users toward `npm install rtk` which installs the wrong package. The real RTK is a native binary at `github.com/rtk-ai/rtk`.

### Fix

#### `lib/data/deps-catalog.mjs`

`INSTALL_HINTS["rtk"]` is already correct for macOS and Linux. Expand the `win32` hint to cover:
- WSL (recommended, full hook support)
- Native Windows (limited: no auto-rewrite hook, fallback to CLAUDE.md injection)

```js
rtk: {
  win32: [
    "WSL (recommended — full hook support):",
    "  curl -fsSL https://raw.githubusercontent.com/rtk-ai/rtk/refs/heads/master/install.sh | sh",
    "  rtk init -g",
    "Native Windows (no auto-rewrite hook, CLAUDE.md fallback):",
    "  Download rtk-x86_64-pc-windows-msvc.zip from https://github.com/rtk-ai/rtk/releases",
    "  Extract rtk.exe → add dir to PATH → rtk init -g",
    "  NOTE: do NOT install via npm — that is a different package.",
  ].join("\n"),
  darwin: "brew install rtk",
  linux: "curl -fsSL https://raw.githubusercontent.com/rtk-ai/rtk/refs/heads/master/install.sh | sh",
},
```

#### `commands/add-tools.md`

Ensure RTK install instructions per platform are explicit and do NOT mention npm. Add Windows WSL recommendation and note about limited native Windows support (CLAUDE.md injection mode only).

**Files:** `lib/data/deps-catalog.mjs`, `commands/add-tools.md`

### Acceptance

`deps-catalog.mjs` win32 hint for `rtk` documents WSL vs native paths and explicitly warns against npm. `add-tools.md` has no npm reference for RTK.

---

## Issue 4 — large-file-warning: wiring duplicado

### Problem

`lib/generate/settings.mjs` line 149, advisory mode:

```js
hooks.PostToolUse.push({ matcher: "Edit|Write|MultiEdit", hooks: [lfHook] });
```

This pushes a **second** `PostToolUse` entry with the same `matcher: "Edit|Write|MultiEdit"`. `PostToolUse[0]` already exists with `format-on-edit`, `set-files-changed`, `sql-idempotent-review` under the same matcher. Result: `large-file-warning.mjs` fires twice per edit.

### Fix

Instead of pushing a new entry, append `lfHook` into `PostToolUse[0].hooks`:

```js
if (opts.largeFiles === "block") {
  hooks.Stop[0].hooks.push(lfHook);
} else {
  hooks.PostToolUse[0].hooks.push(lfHook);  // merged into existing entry
}
```

One `PostToolUse` entry for `Edit|Write|MultiEdit`, one firing per edit.

**Files:** `lib/generate/settings.mjs`

### Acceptance

Generated `settings.json` has exactly one `PostToolUse` entry with matcher `Edit|Write|MultiEdit` (in advisory mode). `large-file-warning.mjs` appears once in that entry.

---

## Issue 5 — ag-kit scripts: path quebrado pós-instalação

### Problem

`templates/ag-kit/scripts/checklist.py` and `verify_all.py` reference skills at:

```python
".agents/skills/vulnerability-scanner/scripts/security_scan.py"
```

After harness installation, ag-kit skills land at `.claude/agents/skills/...`, not `.agents/skills/...`. Scripts always skip every check (path not found → `skipped: True`).

### Fix

Compute the skills base path relative to the script's own location. After installation, the scripts are at `<project>/.claude/agents/scripts/checklist.py`. Skills are at `<project>/.claude/agents/skills/`. Relative path from scripts to skills: `../skills/`.

Replace hardcoded `.agents/skills/` prefix with a dynamic computation at the top of each script:

```python
import os
_SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
_SKILLS_BASE = os.path.normpath(os.path.join(_SCRIPT_DIR, "..", "skills"))
```

Update `CORE_CHECKS` and `PERFORMANCE_CHECKS` to use paths relative to `_SKILLS_BASE`:

```python
CORE_CHECKS = [
    ("Security Scan", "vulnerability-scanner/scripts/security_scan.py", True),
    ...
]
```

And in `run_script`, resolve: `script = Path(_SKILLS_BASE) / script_path`.

Same pattern in `verify_all.py`.

**Files:** `templates/ag-kit/scripts/checklist.py`, `templates/ag-kit/scripts/verify_all.py`

### Acceptance

Paths resolve correctly when scripts run from `<project>/.claude/agents/scripts/`. No `.agents/` hardcoded reference remains.

---

## Issue 6 — guard-main-branch: deve bloquear sem pedir permissão

### Problem

`templates/hooks/guard-main-branch.mjs` outputs `permissionDecision: "ask"` — Claude surfaces a permission dialog and waits for user input. The desired behavior is a hard block with a helpful message.

### Fix

Change `permissionDecision: "ask"` → `permissionDecision: "deny"`.

Update `permissionDecisionReason` to suggest creating a new branch:

```js
const permissionDecisionReason = [
  `guard-main-branch: blocked direct ${verb} to \`${target}\`.`,
  "Direct commits/pushes to the main branch bypass code review and CI gates.",
  "Create a feature branch instead:",
  `  git checkout -b feat/your-feature-name`,
  "Then open a PR to merge into main.",
].join("\n");
```

**Files:** `templates/hooks/guard-main-branch.mjs`

### Acceptance

Hook outputs `permissionDecision: "deny"`. Claude cannot proceed with the commit/push. Message includes `git checkout -b` suggestion.

---

## Issue 7 — `gh` CLI como pré-requisito

### Problem

GitHub CLI (`gh`) is used by multiple commands and skills but is not registered in `deps-catalog.mjs` or `tools-catalog.mjs`. `check-deps-on-start.mjs` never warns when `gh` is missing.

### Fix

#### `lib/data/tools-catalog.mjs`

Add a new `ToolDef` for `gh`:

```js
{
  id: "gh",
  name: "GitHub CLI (gh)",
  category: "workflow",
  strategy: "hook-wire",  // machine dep only, no vendored files, no settings hooks
  license: "MIT",
  repo: "cli/cli",
  deps: ["binary:gh"],
  hooks: [],
  recommended: (p) => p.vcs === "git",
},
```

#### `lib/data/deps-catalog.mjs`

Add to `TOOL_DEPS`:

```js
gh: [{ name: "gh", level: "required" }],
```

Add to `INSTALL_HINTS`:

```js
gh: {
  win32: "winget install --id GitHub.cli",
  darwin: "brew install gh",
  linux: [
    "(type -p wget >/dev/null || (sudo apt update && sudo apt install wget -y))",
    "&& sudo mkdir -p -m 755 /etc/apt/keyrings",
    "&& wget -qO- https://cli.github.com/packages/githubcli-archive-keyring.gpg | sudo tee /etc/apt/keyrings/githubcli-archive-keyring.gpg > /dev/null",
    "&& sudo chmod go+r /etc/apt/keyrings/githubcli-archive-keyring.gpg",
    "&& echo \"deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/githubcli-archive-keyring.gpg] https://cli.github.com/packages stable main\" | sudo tee /etc/apt/sources.list.d/github-cli.list > /dev/null",
    "&& sudo apt update && sudo apt install gh -y",
  ].join(" \\\n  "),
},
```

**Files:** `lib/data/tools-catalog.mjs`, `lib/data/deps-catalog.mjs`

### Acceptance

`npm test` passes (deps-catalog-integrity test validates TOOL_DEPS ↔ INSTALL_HINTS sync). `check-deps-on-start.mjs` warns when `gh` is absent on git repos.

---

## Issue 8 — commit-push-pr.md: base branch dinâmico + commit automático

### Problem

1. `gh pr create --base main` is hardcoded. If the current branch was cut from `develop`, the PR should target `develop`, not `main`.
2. Step 3 proposes the commit message and waits for user confirmation before committing. Should be automatic.

### Fix

#### Base branch detection

Use `git rev-parse --abbrev-ref HEAD@{upstream}` to get the configured upstream (e.g. `origin/develop`) and strip the remote prefix:

```bash
git rev-parse --abbrev-ref HEAD@{upstream} 2>/dev/null | sed 's|origin/||'
```

Fallback chain if no upstream is set:
1. `git log --oneline --decorate --simplify-by-decoration HEAD | grep -oE 'origin/(main|master|develop|dev|staging)' | head -1 | sed 's|origin/||'`
2. `main`

Wire this detection at the top of the command as a dynamic context variable:

```
Base branch: !`git rev-parse --abbrev-ref HEAD@{upstream} 2>/dev/null | sed 's|.*/||' || git symbolic-ref refs/remotes/origin/HEAD 2>/dev/null | sed 's|refs/remotes/origin/||' || echo main`
```

Use this variable in `gh pr create --base <detected-base>`.

#### Remove confirmation step

Remove step 3 ("Propose the commit message and show it to the user. Wait for confirmation."). Generate the conventional commit message automatically from `git diff HEAD` analysis and commit immediately.

Updated flow:
1. Gate: stop if on main/master.
2. Analyze diff → generate conventional commit message (no confirmation).
3. `git add -A && git commit -m "<generated message>"`
4. `git push -u origin <BRANCH>`
5. Detect issue from branch name → `gh pr create --base <detected-base> --title ... --body ...`
6. Report PR URL.

**Files:** `templates/commands/pm/commit-push-pr.md`

### Acceptance

PR created with `--base develop` when branch originated from `develop`. Commit happens without user confirmation step. Fallback to `main` when upstream cannot be detected.

---

## Test impact

| Issue | Tests to update/add |
|-------|-------------------|
| 1 | `tests/unit.test.mjs` — verify generated install-plugins.mjs contains `shell: true` |
| 4 | `tests/unit.test.mjs` — verify settings advisory mode has single PostToolUse entry |
| 6 | `tests/hook-guard-main-branch.test.mjs` — update expected `permissionDecision: "deny"` |
| 7 | `tests/deps-catalog-integrity.test.mjs` — passes automatically after TOOL_DEPS+INSTALL_HINTS added |

Issues 2, 3, 5, 8 have no unit tests in this repo (template content / command markdown / install docs).
