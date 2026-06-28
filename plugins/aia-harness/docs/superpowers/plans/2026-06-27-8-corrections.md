# 8 Correções — aia-harness Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Apply 8 targeted bug fixes across hooks, settings generation, deps catalog, ag-kit scripts, and the commit-push-pr command.

**Architecture:** Each fix is surgical — one root cause, one change location. No abstractions are introduced. Tests are updated/added where unit coverage exists; template/markdown files have no unit tests and are validated manually.

**Tech Stack:** Node.js ≥18 ESM (.mjs), node:test + node:assert, Python 3 (ag-kit scripts), Markdown (commands).

## Global Constraints

- All source files are `.mjs` ESM — no TypeScript, no build step.
- Run `npm test` (typecheck + lint + unit tests) after every task before committing.
- `templates/` is excluded from lint and typecheck — do not run linters on files under `templates/`.
- Hook output must pass the validators in `lib/validate/hook-schema.mjs`.
- `deps-catalog-integrity.test.mjs` auto-runs as part of `npm test` and enforces: every key in `TOOL_DEPS` matches a tool id in `TOOLS`; every binary in `TOOL_DEPS` values has a 3-platform entry in `INSTALL_HINTS`.
- Commit after each task with a conventional commit message.

---

## File Map

| Task | Files Modified |
|------|---------------|
| 1 | `templates/hooks/guard-main-branch.mjs`, `tests/hook-guard-main-branch.test.mjs` |
| 2 | `lib/generate/settings.mjs`, `tests/settings-strict.test.mjs` |
| 3 | `lib/generate/misc.mjs` |
| 4 | `lib/data/tools-catalog.mjs`, `lib/data/deps-catalog.mjs` |
| 5 | `lib/data/deps-catalog.mjs` |
| 6 | `templates/ag-kit/scripts/checklist.py`, `templates/ag-kit/scripts/verify_all.py` |
| 7 | `templates/commands/pm/commit-push-pr.md` |

---

## Task 1: guard-main-branch — deny instead of ask

**Files:**
- Modify: `templates/hooks/guard-main-branch.mjs:63-76`
- Modify: `tests/hook-guard-main-branch.test.mjs:35-48`

**Interfaces:**
- Produces: hook outputs `permissionDecision: "deny"` (exit 0) when on main/master or push targets main/master. Still passes through (empty stdout, exit 0) for all other cases.

- [ ] **Step 1: Update the test helper to expect `deny`**

In `tests/hook-guard-main-branch.test.mjs`, replace the `assertAskPermission` function (lines 35–48) with `assertDenyPermission`:

```js
/** Assert output is schema-valid AND that it hard-blocks (deny). */
function assertDenyPermission(
  /** @type {import("./hook-runner.mjs").HookResult} */ { stdout, exitCode },
) {
  const r = validatePreToolUseOutput(stdout, exitCode);
  assert.equal(r.valid, true, `Schema invalid: ${r.errors.join("; ")}`);
  assert.equal(exitCode, 0);
  const parsed = JSON.parse(stdout);
  assert.equal(parsed.hookSpecificOutput?.hookEventName, "PreToolUse");
  assert.equal(parsed.hookSpecificOutput?.permissionDecision, "deny");
  assert.ok(
    typeof parsed.hookSpecificOutput?.permissionDecisionReason === "string" &&
      parsed.hookSpecificOutput.permissionDecisionReason.length > 0,
  );
  assert.ok(
    /git checkout -b/.test(parsed.hookSpecificOutput.permissionDecisionReason),
    "reason must suggest creating a branch with git checkout -b",
  );
}
```

Also update every call site: replace `assertAskPermission(r)` with `assertDenyPermission(r)` throughout the file (7 occurrences in output paths 4 and 5).

- [ ] **Step 2: Run tests to verify they fail**

```bash
node --test tests/hook-guard-main-branch.test.mjs
```

Expected: 7 failures — `permissionDecision` is `"ask"` not `"deny"`.

- [ ] **Step 3: Update the hook**

In `templates/hooks/guard-main-branch.mjs`, replace lines 63–77:

```js
const permissionDecisionReason = [
  `guard-main-branch: blocked direct ${verb} to \`${target}\`.`,
  "Direct commits/pushes to the main branch bypass code review and CI gates.",
  "Create a feature branch instead:",
  "  git checkout -b feat/your-feature-name",
  "Then open a PR to merge into main.",
].join("\n");

process.stdout.write(
  JSON.stringify({
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      permissionDecision: "deny",
      permissionDecisionReason,
    },
  }),
);

process.exit(0);
```

- [ ] **Step 4: Run tests and verify they pass**

```bash
node --test tests/hook-guard-main-branch.test.mjs
```

Expected: all 14 tests pass.

- [ ] **Step 5: Full test suite**

```bash
npm test
```

Expected: no failures.

- [ ] **Step 6: Commit**

```bash
git add templates/hooks/guard-main-branch.mjs tests/hook-guard-main-branch.test.mjs
git commit -m "fix(hook): guard-main-branch hard-blocks push/commit to main (deny, not ask)"
```

---

## Task 2: large-file-warning — eliminate duplicate PostToolUse entry

**Files:**
- Modify: `lib/generate/settings.mjs:146-150`
- Modify: `tests/settings-strict.test.mjs` (add one test)

**Interfaces:**
- Consumes: `renderSettings(profile, extraHooks, opts)` from `lib/generate/settings.mjs`
- Produces: in advisory mode, generated settings.json has exactly one `PostToolUse` entry with matcher `Edit|Write|MultiEdit`, and `large-file-warning.mjs` appears exactly once in that entry.

- [ ] **Step 1: Add a regression test**

Append to `tests/settings-strict.test.mjs`:

```js
test("large-file guard: advisory mode — large-file-warning appears exactly once across all PostToolUse hooks", () => {
  const s = JSON.parse(renderSettings(profile(), {}, { largeFiles: "advisory" }));
  const allPostHooks = (s.hooks.PostToolUse ?? []).flatMap(
    (/** @type {any} */ e) => (e.hooks ?? []).map((/** @type {any} */ h) => hookTarget(h)),
  );
  const count = allPostHooks.filter((/** @type {any} */ c) =>
    /large-file-warning\.mjs/.test(c),
  ).length;
  assert.equal(count, 1, `large-file-warning must appear exactly once in PostToolUse, found ${count}`);
});

test("large-file guard: default (unset) mode — large-file-warning appears exactly once across all PostToolUse hooks", () => {
  const s = JSON.parse(renderSettings(profile(), {}, {}));
  const allPostHooks = (s.hooks.PostToolUse ?? []).flatMap(
    (/** @type {any} */ e) => (e.hooks ?? []).map((/** @type {any} */ h) => hookTarget(h)),
  );
  const count = allPostHooks.filter((/** @type {any} */ c) =>
    /large-file-warning\.mjs/.test(c),
  ).length;
  assert.equal(count, 1, `large-file-warning must appear exactly once in PostToolUse, found ${count}`);
});
```

- [ ] **Step 2: Run the new tests to verify they fail**

```bash
node --test tests/settings-strict.test.mjs
```

Expected: the 2 new tests fail with `found 2`.

- [ ] **Step 3: Fix settings.mjs**

In `lib/generate/settings.mjs`, find the block starting at `if (opts.largeFiles === "block")` and change:

```js
  // BEFORE:
  if (opts.largeFiles === "block") {
    hooks.Stop[0].hooks.push(lfHook);
  } else {
    hooks.PostToolUse.push({ matcher: "Edit|Write|MultiEdit", hooks: [lfHook] });
  }
```

```js
  // AFTER:
  if (opts.largeFiles === "block") {
    hooks.Stop[0].hooks.push(lfHook);
  } else {
    hooks.PostToolUse[0].hooks.push(lfHook);
  }
```

- [ ] **Step 4: Run tests and verify they pass**

```bash
node --test tests/settings-strict.test.mjs
```

Expected: all tests pass including the 2 new ones.

- [ ] **Step 5: Full test suite**

```bash
npm test
```

Expected: no failures.

- [ ] **Step 6: Commit**

```bash
git add lib/generate/settings.mjs tests/settings-strict.test.mjs
git commit -m "fix(settings): merge large-file-warning into existing PostToolUse entry (was firing twice)"
```

---

## Task 3: Windows — spawnSync resolves claude.cmd with shell:true

**Files:**
- Modify: `lib/generate/misc.mjs` (three lines inside the generated template string)

**Context:** `lib/generate/misc.mjs` exports `renderPluginsInstallScript()` which returns a string — a generated Node.js script written into target projects as `scripts/install-plugins.mjs`. That string contains three `spawnSync("claude", ...)` calls that fail on Windows because Node.js does not resolve `.cmd` extensions without a shell. Adding `shell: true` makes the OS shell handle `.cmd` resolution.

**Interfaces:**
- Produces: `renderPluginsInstallScript()` returns a string where all `spawnSync("claude", ...)` calls include `shell: true` in their options object.

- [ ] **Step 1: Fix the three spawnSync calls in the template string**

In `lib/generate/misc.mjs`, locate the three occurrences inside the returned template literal and add `shell: true`:

Line ~105 (check clause):
```js
// BEFORE:
const check = spawnSync("claude", ["--version"], { stdio: "ignore" });
// AFTER:
const check = spawnSync("claude", ["--version"], { stdio: "ignore", shell: true });
```

Line ~124 (marketplace add loop):
```js
// BEFORE:
  spawnSync("claude", ["plugin", "marketplace", "add", repo], { stdio: "inherit" });
// AFTER:
  spawnSync("claude", ["plugin", "marketplace", "add", repo], { stdio: "inherit", shell: true });
```

Line ~127 (plugin install loop):
```js
// BEFORE:
  spawnSync("claude", ["plugin", "install", p.name + "@" + p.marketplace], { stdio: "inherit" });
// AFTER:
  spawnSync("claude", ["plugin", "install", p.name + "@" + p.marketplace], { stdio: "inherit", shell: true });
```

Note: these are inside a template literal (backtick string). The lines appear as-is in the generated file. Edit the string content, not the surrounding JS.

- [ ] **Step 2: Verify the generated output contains shell: true**

```bash
node -e "
import { renderPluginsInstallScript } from './lib/generate/misc.mjs';
const out = renderPluginsInstallScript([]);
const count = (out.match(/shell: true/g) || []).length;
console.log('shell: true occurrences:', count);
if (count !== 3) process.exit(1);
" --input-type=module
```

Expected output: `shell: true occurrences: 3`

- [ ] **Step 3: Full test suite**

```bash
npm test
```

Expected: no failures.

- [ ] **Step 4: Commit**

```bash
git add lib/generate/misc.mjs
git commit -m "fix(misc): add shell:true to spawnSync(claude) calls so claude.cmd resolves on Windows"
```

---

## Task 4: gh CLI — add as prerequisite in catalogs

**Files:**
- Modify: `lib/data/tools-catalog.mjs` (add ToolDef)
- Modify: `lib/data/deps-catalog.mjs` (add TOOL_DEPS entry + INSTALL_HINTS entry)

**Context:** `deps-catalog-integrity.test.mjs` enforces: (1) every key in `TOOL_DEPS` has a matching tool id in `TOOLS`, (2) every binary listed in `TOOL_DEPS` values has a 3-platform entry in `INSTALL_HINTS` with non-empty strings. Adding `gh` requires updating all three in sync.

**Interfaces:**
- Produces: `TOOLS` contains a `gh` ToolDef with `deps: ["binary:gh"]`. `TOOL_DEPS["gh"]` exists. `INSTALL_HINTS["gh"]` covers win32/darwin/linux.

- [ ] **Step 1: Add gh ToolDef to tools-catalog.mjs**

In `lib/data/tools-catalog.mjs`, append a new entry to the `TOOLS` array after the `claude-code-worktrees` entry:

```js
  {
    id: "gh",
    name: "GitHub CLI (gh)",
    category: "workflow",
    strategy: "hook-wire",
    license: "MIT",
    repo: "cli/cli",
    deps: ["binary:gh"],
    hooks: [],
    recommended: (p) => Boolean(p.vcs),
  },
```

- [ ] **Step 2: Add TOOL_DEPS entry to deps-catalog.mjs**

In `lib/data/deps-catalog.mjs`, add to the `TOOL_DEPS` object (after the `ponytail` entry):

```js
  gh: [{ name: "gh", level: "required" }],
```

- [ ] **Step 3: Add INSTALL_HINTS entry to deps-catalog.mjs**

In `lib/data/deps-catalog.mjs`, add to `INSTALL_HINTS` (after the `graphify` entry):

```js
  gh: {
    win32: "winget install --id GitHub.cli",
    darwin: "brew install gh",
    linux: [
      "(type -p wget >/dev/null || (sudo apt update && sudo apt install wget -y))",
      "&& sudo mkdir -p -m 755 /etc/apt/keyrings",
      "&& out=$(mktemp) && wget -nv -O$out https://cli.github.com/packages/githubcli-archive-keyring.gpg",
      "&& cat $out | sudo tee /etc/apt/keyrings/githubcli-archive-keyring.gpg > /dev/null",
      "&& sudo chmod go+r /etc/apt/keyrings/githubcli-archive-keyring.gpg",
      "&& echo \"deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/githubcli-archive-keyring.gpg] https://cli.github.com/packages stable main\"",
      "| sudo tee /etc/apt/sources.list.d/github-cli.list > /dev/null",
      "&& sudo apt update && sudo apt install gh -y",
    ].join(" \\\n  "),
  },
```

- [ ] **Step 4: Run integrity test to verify it passes**

```bash
node --test tests/deps-catalog-integrity.test.mjs
```

Expected: all tests pass.

- [ ] **Step 5: Full test suite**

```bash
npm test
```

Expected: no failures.

- [ ] **Step 6: Commit**

```bash
git add lib/data/tools-catalog.mjs lib/data/deps-catalog.mjs
git commit -m "feat(deps): add gh CLI as prerequisite with install hints for all platforms"
```

---

## Task 5: RTK — expand Windows install hint (WSL vs native)

**Files:**
- Modify: `lib/data/deps-catalog.mjs` (`INSTALL_HINTS["rtk"]["win32"]`)

**Context:** The current `win32` hint for `rtk` says only "Download zip from releases". This does not communicate the WSL recommendation or the CLAUDE.md injection fallback, and does not warn against `npm install rtk` (wrong package). The `commands/add-tools.md` already has correct instructions — no changes needed there.

**Interfaces:**
- Produces: `INSTALL_HINTS["rtk"]["win32"]` is a multi-line string covering WSL (recommended, full hook support) and native Windows (limited, CLAUDE.md fallback), and explicitly warns against npm.

- [ ] **Step 1: Replace the win32 rtk hint**

In `lib/data/deps-catalog.mjs`, find `INSTALL_HINTS["rtk"]` and replace the `win32` value:

```js
  rtk: {
    win32: [
      "WSL (recommended — full hook + auto-rewrite support):",
      "  curl -fsSL https://raw.githubusercontent.com/rtk-ai/rtk/refs/heads/master/install.sh | sh",
      "  rtk init -g",
      "Native Windows (limited — no auto-rewrite hook, CLAUDE.md injection fallback only):",
      "  1. Download rtk-x86_64-pc-windows-msvc.zip from https://github.com/rtk-ai/rtk/releases",
      "  2. Extract rtk.exe and add its directory to PATH",
      "  3. rtk init -g",
      "  NOTE: do NOT install via npm — that installs an unrelated package with the same name.",
    ].join("\n"),
    darwin: "brew install rtk",
    linux:
      "curl -fsSL https://raw.githubusercontent.com/rtk-ai/rtk/refs/heads/master/install.sh | sh",
  },
```

- [ ] **Step 2: Run integrity test**

```bash
node --test tests/deps-catalog-integrity.test.mjs
```

Expected: all tests pass (non-empty string check passes for win32).

- [ ] **Step 3: Full test suite**

```bash
npm test
```

Expected: no failures.

- [ ] **Step 4: Commit**

```bash
git add lib/data/deps-catalog.mjs
git commit -m "fix(deps): expand rtk Windows hint — WSL recommended, warn against npm install"
```

---

## Task 6: ag-kit scripts — fix hardcoded .agents/ path

**Files:**
- Modify: `templates/ag-kit/scripts/checklist.py`
- Modify: `templates/ag-kit/scripts/verify_all.py`

**Context:** Both scripts hardcode `.agents/skills/` as the base path for finding other ag-kit skill scripts. After harness installation, the scripts live at `<project>/.claude/agents/scripts/` and the skills live at `<project>/.claude/agents/skills/`. The fix computes the skills base path dynamically relative to the script's own location using `__file__`.

**No unit tests exist for these template Python files.** Manual verification: run the script from the expected installed location and confirm the paths resolve.

- [ ] **Step 1: Fix checklist.py**

In `templates/ag-kit/scripts/checklist.py`, add after the existing imports (after `from typing import ...`):

```python
import os

# Compute skills base path relative to this script's installed location.
# After harness install: scripts/ and skills/ are siblings under .claude/agents/
_SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
_AGENTS_BASE = os.path.normpath(os.path.join(_SCRIPT_DIR, ".."))
```

Replace the `CORE_CHECKS` list — strip the `.agents/` prefix from all paths:

```python
CORE_CHECKS = [
    ("Security Scan", "skills/vulnerability-scanner/scripts/security_scan.py", True),
    ("Lint Check", "skills/lint-and-validate/scripts/lint_runner.py", True),
    ("Schema Validation", "skills/database-design/scripts/schema_validator.py", False),
    ("Test Runner", "skills/testing-patterns/scripts/test_runner.py", False),
    ("UX Audit", "skills/frontend-design/scripts/ux_audit.py", False),
    ("SEO Check", "skills/seo-fundamentals/scripts/seo_checker.py", False),
]

PERFORMANCE_CHECKS = [
    ("Lighthouse Audit", "skills/performance-profiling/scripts/lighthouse_audit.py", True),
    ("Playwright E2E", "skills/webapp-testing/scripts/playwright_runner.py", False),
]
```

In the `main()` function, replace the two lines that build `actual_script_path` and `script`:

```python
# BEFORE (inside core checks loop):
        actual_script_path = Path(script_path.replace(".agents", agent_dir_name))
        script = project_path / actual_script_path

# AFTER:
        script = Path(_AGENTS_BASE) / script_path
```

Apply the same replacement in the performance checks loop.

Also remove the `agent_dir_name` variable that is no longer needed:

```python
# Remove this line from main():
    agent_dir_name = ".agents" if (project_path / ".agents").exists() else ".agents"
```

- [ ] **Step 2: Fix verify_all.py**

Apply the same pattern to `templates/ag-kit/scripts/verify_all.py`:

Add after imports:

```python
import os

_SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
_AGENTS_BASE = os.path.normpath(os.path.join(_SCRIPT_DIR, ".."))
```

Find every hardcoded `.agents/skills/` path in `ALL_CHECKS` (or equivalent list) and strip the `.agents/` prefix.

Find every line that builds a `script` path like `project_path / Path(path.replace(".agents", ...))` and replace with `Path(_AGENTS_BASE) / script_path`.

Remove any `agent_dir_name` variable.

- [ ] **Step 3: Verify no `.agents/` string remains**

```bash
grep -n "\.agents/" templates/ag-kit/scripts/checklist.py templates/ag-kit/scripts/verify_all.py
```

Expected: no output.

- [ ] **Step 4: Syntax check**

```bash
python3 -m py_compile templates/ag-kit/scripts/checklist.py && echo "OK"
python3 -m py_compile templates/ag-kit/scripts/verify_all.py && echo "OK"
```

Expected: `OK` for both.

- [ ] **Step 5: Full test suite**

```bash
npm test
```

Expected: no failures (Python files are excluded from Node.js tests).

- [ ] **Step 6: Commit**

```bash
git add templates/ag-kit/scripts/checklist.py templates/ag-kit/scripts/verify_all.py
git commit -m "fix(ag-kit): resolve skills path dynamically from __file__ instead of hardcoded .agents/"
```

---

## Task 7: commit-push-pr.md — detect base branch + auto-commit

**Files:**
- Modify: `templates/commands/pm/commit-push-pr.md`

**Context:** The command currently uses `--base main` hardcoded in `gh pr create` and asks the user to confirm the commit message before committing. The fix: (1) detect the branch the current branch was cut from using `git rev-parse --abbrev-ref HEAD@{upstream}`, (2) remove the confirmation step — commit automatically.

**No unit tests.** This is a command markdown file executed by Claude at runtime.

- [ ] **Step 1: Rewrite commit-push-pr.md**

Replace the entire file content with:

```markdown
---
description: Commit, push, and open PR linked to the issue
allowed-tools: Bash(git *), Bash(gh *), AskUserQuestion
---

Current branch: !`git branch --show-current`
Status: !`git status --short`
Diff: !`git diff HEAD --stat`
Config PM: !`cat .claude/pm-config.json 2>/dev/null || echo "NOT_FOUND"`
Issues linked (via branch name): !`git branch --show-current | grep -oE '[0-9]+' | head -1 | xargs -I{} gh issue view {} --json number,title 2>/dev/null || echo "none"`
Base branch: !`BASE=$(git rev-parse --abbrev-ref HEAD@{upstream} 2>/dev/null | sed 's|.*/||'); [ -z "$BASE" ] && BASE=$(git symbolic-ref refs/remotes/origin/HEAD 2>/dev/null | sed 's|refs/remotes/origin/||'); [ -z "$BASE" ] && BASE=main; echo "$BASE"`

Use the `github-pm` skill to execute this workflow:

1. MANDATORY GATE: if current branch = `main` or `master` → STOP.
   Instruct the user to create a branch first (`/pm:worktree-new` or `git checkout -b`).

2. Analyze `git diff HEAD` to generate a commit message (conventional commits):
   - feat: new feature
   - fix: bug fix
   - chore: maintenance/infra
   - docs: documentation
   - refactor: refactoring without behavior change
   - test: tests

3. Commit immediately — do not ask for confirmation:

   ```bash
   git add -A && git commit -m "<generated message>"
   ```

4. Push (create upstream if needed):

   ```bash
   git push -u origin <BRANCH> 2>/dev/null || git push origin <BRANCH>
   ```

5. Detect the issue from the branch name (e.g.: `feat/42-*` → issue #42).
   Use the `Base branch` value from the dynamic context above for `--base`.
   Create PR with "Closes #N" in the body if an issue is detected:

   ```bash
   gh pr create \
     --title "<title based on commit>" \
     --body "## Summary\n\n<description>\n\nCloses #<N>" \
     --base <Base branch>
   ```

6. Report the PR URL. Suggest: "Run `/pm:code-review-pr <PR>` to start the review."
```

- [ ] **Step 2: Verify the file has no `--base main` hardcode**

```bash
grep "base main" templates/commands/pm/commit-push-pr.md
```

Expected: no output.

- [ ] **Step 3: Verify the confirmation step is gone**

```bash
grep -i "wait for confirmation\|show it to the user\|Propose the commit" templates/commands/pm/commit-push-pr.md
```

Expected: no output.

- [ ] **Step 4: Full test suite**

```bash
npm test
```

Expected: no failures.

- [ ] **Step 5: Commit**

```bash
git add templates/commands/pm/commit-push-pr.md
git commit -m "fix(command): commit-push-pr detects base branch dynamically and commits without confirmation"
```

---

## Self-Review

### Spec coverage

| Spec section | Task |
|---|---|
| Issue 1 — Windows spawnSync | Task 3 |
| Issue 2 — RTK cli.js path bug | Covered by Task 5 (correct RTK install) |
| Issue 3 — RTK wrong package/hints | Task 5 |
| Issue 4 — large-file duplicate wiring | Task 2 |
| Issue 5 — ag-kit scripts path | Task 6 |
| Issue 6 — guard-main-branch deny | Task 1 |
| Issue 7 — gh CLI prerequisite | Task 4 |
| Issue 8 — base branch + auto-commit | Task 7 |

All 8 spec requirements covered. ✓

### Placeholder scan

No TBD, TODO, or vague steps. Every step contains actual code. ✓

### Type consistency

- `renderSettings` signature consistent across Task 2 steps.
- `TOOL_DEPS["gh"]` key matches `TOOLS` id `"gh"` added in Task 4. ✓
- `INSTALL_HINTS["gh"]` matches `TOOL_DEPS["gh"][0].name === "gh"`. ✓
- `hookTarget()` helper referenced in Task 2 tests — already defined in `settings-strict.test.mjs:28`. ✓
