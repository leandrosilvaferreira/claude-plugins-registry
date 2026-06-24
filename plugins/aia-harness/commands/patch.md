---
description: Selectively re-apply harness artifacts to a project that already has the harness configured — lets the user pick which categories to force-overwrite.
argument-hint: "[path]"
allowed-tools:
  - Bash
  - AskUserQuestion
---

# Patch an existing harness

Target directory: `$1` if provided, else `$CLAUDE_PROJECT_DIR`.

## 1. Build the plan and collect artifact IDs

Run plan in JSON mode to see every artifact the engine would produce:

```bash
"${CLAUDE_PLUGIN_ROOT}/bin/aia-harness" plan "${1:-$CLAUDE_PROJECT_DIR}" --json
```

Parse the JSON. Group artifact IDs by prefix into these logical categories
(only include a category if at least one artifact with that prefix exists):

| Category label | ID prefix(es) to match |
|---|---|
| `settings` — settings.json | `settings` (exact) |
| `hooks` — all hook files | starts with `hook:` |
| `claude-md` — root + domain CLAUDE.md files | `claude-md-root` or starts with `claude-md:` |
| `rules` — .claude/rules/ files | starts with `rule:` |
| `mcp` — .mcp.json | `mcp` (exact) |
| `skills` — first-party + ECC + ag-kit skills | starts with `skill:`, `ecc-skill:`, `agkit-skill:` |
| `agents` — ECC + ag-kit agents | starts with `ecc-agent:`, `agkit-agent:` |
| `tools` — rtk hook, graphify (caveman/ponytail are global plugins, not patched here) | starts with `tool-skill:`, `tool-hooks:`, `graphifyignore` (exact) |
| `git-hooks` — graphify git hooks (post-commit, post-checkout) | starts with `graphify-git-hook:` |
| `github-pm` — skill, commands, templates, workflows | starts with `github-pm:` |
| `docs` — harness strategies doc | `strategies` (exact) |
| `lsp` — language server config | `lsp` (exact) |
| `worktree` — .worktreeinclude | `worktree` (exact) |
| `script` — install reference scripts | `install-script` (exact), `install-plugins` (exact), or starts with `agkit-script:` |
| `commands` — first-party + ag-kit commands (non-github-pm) | starts with `command:`, `agkit-command:` |

## 2. Ask the user which categories to patch

Present only the categories that have at least one matching artifact.
Use `AskUserQuestion` with `multiSelect: true`.

**`AskUserQuestion` accepts at most 4 options per question.** If there are more than 4
categories, split them across multiple sequential `AskUserQuestion` calls (e.g. "grupo 1/2",
"grupo 2/2"). Collect all answers before proceeding.

Example prompt text for each group: "Quais categorias deseja forçar a atualização? (grupo N/T)"

For each selected category, collect all artifact IDs whose prefix matches.
Join all selected IDs into a single comma-separated string for `--only`.

## 3. Show what will be patched

Before running, print a summary:

```
Patching [N] artifacts in categories: <selected labels>
IDs: <comma list>
```

## 4. Determine the large-file guard mode (preserve, or ask if unset)

`settings.json` carries the large-file guard wiring, so re-applying it must **not**
silently flip the mode. Before applying, decide which `--large-files` value to pass:

1. Read the project's existing `.claude/settings.json` and look for
   `large-file-warning.mjs`:
   - wired under **`Stop`** → current mode is `block`.
   - wired under **`PostToolUse`** → current mode is `advisory`.
   Preserve whichever is found.
2. **If it isn't wired anywhere (or `settings.json` is absent) the mode is not yet
   configured** — use `AskUserQuestion` (single-select) to let the user choose, in
   Portuguese: _"Arquivos >350 linhas — **bloquear e refatorar já** (projeto novo)
   ou **só sugerir e confirmar** (projeto legado)?"_ → `block` / `advisory`. The hook
   is mandatory; this only sets its mode.

Always pass the resolved value as `--large-files=<mode>` (it only takes effect when
`settings` is among the patched categories; harmless otherwise).

## 5. Apply with force

```bash
"${CLAUDE_PLUGIN_ROOT}/bin/aia-harness" apply "${1:-$CLAUDE_PROJECT_DIR}" \
  --yes --force --only=<comma-joined IDs> --large-files=<mode>
```

Report the apply output to the user verbatim.

> **Note:** `--force` overwrites existing files that differ from what the engine
> generates. Files not in the selected categories are untouched.
