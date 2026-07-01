# gh Auto-Install + Cross-Platform Audit Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add `gh` CLI auto-install to `commands/add-tools.md` (agent installs on Mac/Windows/Linux with user authorization) and confirm cross-platform command execution is correct throughout the engine.

**Architecture:** Single-file edit to `commands/add-tools.md`. Cross-platform audit is read-only confirmation (no code changes needed in system-deps.mjs or verify.mjs).

**Tech Stack:** Node.js ESM, Markdown command files, `brew`/`winget`/`apt` CLI installers

## Global Constraints

- All source code must be in English
- No new files unless required
- No tests needed (command markdown files are not unit-tested)
- `npm test` must still pass after the change (773 tests baseline)
- YAGNI: only add what the spec explicitly requires

---

### Task 1: Add `gh` CLI auto-install section to `commands/add-tools.md`

**Files:**
- Modify: `commands/add-tools.md`

**Context:**
The `gh` CLI was added to `lib/data/tools-catalog.mjs` (strategy: "cli") and `lib/data/deps-catalog.mjs` (TOOL_DEPS + INSTALL_HINTS) in the previous fix wave. The `commands/add-tools.md` command already handles auto-install for `rtk` (Mac + Linux via brew/curl, Windows manual) and `graphify` (Mac + Linux + Windows via brew/curl/winget + uv). The `gh` CLI is missing from that command entirely.

**What to add:**

A new `gh` install block, placed after the `rtk` block and before the `graphify` block. Pattern follows rtk exactly: detect platform, run install if possible, warn when manual is needed.

Install commands per platform:
- Mac (`darwin`): `brew install gh`
- Windows (`win32`): `winget install --id GitHub.cli`
- Linux (`linux`): the official GitHub CLI apt sequence (see INSTALL_HINTS in deps-catalog.mjs for the exact command, or use this):

```bash
(type -p wget >/dev/null || (sudo apt update && sudo apt install wget -y)) \
  && sudo mkdir -p -m 755 /etc/apt/keyrings \
  && out=$(mktemp) && wget -nv -O$out https://cli.github.com/packages/githubcli-archive-keyring.gpg \
  && cat $out | sudo tee /etc/apt/keyrings/githubcli-archive-keyring.gpg > /dev/null \
  && sudo chmod go+r /etc/apt/keyrings/githubcli-archive-keyring.gpg \
  && sudo mkdir -p -m 755 /etc/apt/sources.list.d \
  && echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/githubcli-archive-keyring.gpg] https://cli.github.com/packages stable main" | sudo tee /etc/apt/sources.list.d/github-cli.list > /dev/null \
  && sudo apt update && sudo apt install gh -y
```

All three platforms: agent runs the command automatically via Bash without a second confirmation (same pattern as graphify's uv installer).

After install, verify `gh` is reachable:
```bash
command -v gh 2>/dev/null || echo "not-in-path"
```

If `not-in-path`, inform user to add the install directory to PATH.

**Note on AskUserQuestion:** The command uses a single `AskUserQuestion` in Step 3 for ALL machine dep approvals together (caveman, ponytail, rtk, gh, graphify). The `gh` installer should be added to that same confirmation question — not a new separate question.

**Placement:** After the `rtk` block, before the `graphify` block.

**Note on rtk platform capabilities (document in place — no code change):**
- rtk Mac: `brew install rtk` or curl installer → agent auto-installs ✓ (already correct)
- rtk Linux: `curl -fsSL .../install.sh | sh` → agent auto-installs ✓ (already correct)  
- rtk Windows: manual (download zip from GitHub releases, WSL recommended) → stays manual ✓

**Cross-platform audit findings (read-only, no code changes):**
- `lib/detect/system-deps.mjs` `getVersion()`: uses `spawnSync(binPath, args)` where `binPath` is the full resolved absolute path — NOT a command name. `shell: true` would be harmful here (would pass a path as a shell command string). Correct as-is.
- `lib/generate/verify.mjs` `execSync(entry.cmd)`: Node.js `execSync` with a string argument already uses the OS shell (`/bin/sh -c` on Unix, `cmd.exe /d /s /c` on Windows). `shell: true` is redundant. Correct as-is.
- `lib/generate/misc.mjs`: already has `shell: true` on all three `spawnSync("claude", ...)` calls from the previous fix wave. ✓

- [ ] **Step 1: Read the current `commands/add-tools.md`** to understand structure and find the exact insertion point (after rtk block, before graphify block).

- [ ] **Step 2: Add `gh` CLI install block**

Insert after the rtk section (after the PATH export reminder), before the graphify section. The block should:

1. Detect platform via `node -e "console.log(process.platform)"`
2. Mac (`darwin`): `brew install gh` — run via Bash automatically
3. Windows (`win32`): `winget install --id GitHub.cli` — run via Bash automatically
4. Linux: the full apt keyring sequence — run via Bash automatically
5. After install (Mac/Linux/Windows): verify with `command -v gh 2>/dev/null || echo "not-in-path"`; if not-in-path, inform user

- [ ] **Step 3: Ensure `gh` is included in the Step 3 AskUserQuestion**

In Step 3 of the command, the existing `AskUserQuestion` asks the user which machine installs to run. `gh` CLI should be listed alongside caveman, ponytail, rtk, graphify as an option.

- [ ] **Step 4: Run `npm test` to confirm 773 tests still pass**

```bash
npm test
```
Expected: all 773 tests pass, no regressions.

- [ ] **Step 5: Commit**

```bash
git add commands/add-tools.md
git commit -m "feat(command): add gh CLI auto-install to add-tools — agent runs brew/winget/apt on auth"
```
