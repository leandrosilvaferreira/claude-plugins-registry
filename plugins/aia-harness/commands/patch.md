---
description: Selectively re-apply harness artifacts to a project that already has the harness configured — lets the user pick which categories to force-overwrite.
argument-hint: "[path]"
allowed-tools:
  - Bash
  - AskUserQuestion
---

# Patch an existing harness

Target directory: `$1` if provided, else `$CLAUDE_PROJECT_DIR`.

<!-- aia-harness:target-dir-resolution -->
Resolve this **once**, at the
start of this command, into a concrete literal absolute path. `$CLAUDE_PROJECT_DIR` is documented
as available "when hooks are executed" but is not guaranteed inside the general-purpose Bash tool
used to run these instructions — it can silently expand empty there, and the CLI then falls back
to the shell's *current* working directory, which is wrong if the agent has since `cd`'d elsewhere
(e.g. into the scratchpad for intermediate file work). Reuse that one resolved literal path in
every subsequent CLI invocation below — never re-expand a bare `$CLAUDE_PROJECT_DIR` in a later,
separately-issued Bash call, since each Bash tool call is a fresh shell (only cwd persists, not
exported variables) and an earlier `cd` silently redirects any later bare-env-var fallback to the
wrong place.

## 1. Build the plan and collect artifact IDs

Run plan in JSON mode to see every artifact the engine would produce:

```bash
node "${CLAUDE_PLUGIN_ROOT}/bin/harness.mjs" plan "${1:-$CLAUDE_PROJECT_DIR}" --json
```

Parse the JSON. Group artifact IDs by prefix into these logical categories
(only include a category if at least one artifact with that prefix exists):

| Category label | ID prefix(es) to match |
|---|---|
| `settings` — settings.json | `settings` (exact) |
| `hooks` — all hook files | starts with `hook:` |
| `claude-md` — root + domain CLAUDE.md files (carries the dynamic Superpowers bridge) | `claude-md-root` or starts with `claude-md:` — **but drop `claude-md:graphify-root`** (see note below; reconciled non-destructively in step 6) |
| `rules` — .claude/rules/ files | starts with `rule:` |
| `mcp` — .mcp.json | `mcp` (exact) |
| `skills` — first-party + ECC + ag-kit skills | starts with `skill:`, `ecc-skill:`, `agkit-skill:` |
| `agents` — ECC + ag-kit + first-party project agents (installs best-practice condition-shaped routing) | starts with `ecc-agent:`, `agkit-agent:`, `agent:project:` |
| `tools` — rtk hook, graphify (caveman/ponytail are global plugins, not patched here) | starts with `tool-skill:`, `tool-hooks:`, `graphifyignore` (exact), or `graphify-orient-hook` (exact) |
| `git-hooks` — graphify git hooks (post-commit, post-checkout) | starts with `graphify-git-hook:` |
| `github-pm` — skill, commands, templates, workflows | starts with `github-pm:` |
| `obsidian` — **not force-patchable here** (would corrupt CLAUDE.md and revert vault-name substitution) | starts with `obsidian:` — exclude from `--only`, see note below |
| `docs` — harness strategies doc | `strategies` (exact) |
| `lsp` — language server config | `lsp` (exact) |
| `worktree` — .worktreeinclude | `worktree` (exact) |
| `script` — install reference scripts | `install-plugins` (exact), or starts with `agkit-script:` |
| `commands` — first-party + ag-kit commands (non-github-pm) | starts with `command:`, `agkit-command:` |

> **`obsidian` is excluded from this command's force-apply mechanism.** Two of its
> artifacts (`obsidian:claude-md` and `obsidian:memory-instructions`) carry
> `mergeStrategy: "merge-section"`, and `--force` (`lib/apply.mjs`) skips
> merge-strategy handling entirely, falling through to a raw whole-file overwrite —
> forcing `obsidian:claude-md` would replace the target's entire root `CLAUDE.md`
> with just the obsidian section, destroying every other section (graphify, other
> pillars, hand-written notes); forcing `obsidian:memory-instructions` would replace
> the target's entire `.claude/memory/INSTRUCTIONS.md` with just its "Sanitation"
> subsection, destroying "When to save", "How to save", and "Reading memories". The
> other 9 obsidian ids carry no merge strategy either, but their vendored content
> still has the literal `__OBSIDIAN_VAULT_DIR__` placeholder — only
> `/aia-harness:add-obsidian`'s own flow knows how to substitute the real vault
> folder name, so force-applying them here would silently revert a working
> installation back to broken placeholder-bearing files. Never select `obsidian` in
> step 2 below — direct the user to re-run `/aia-harness:add-obsidian` (its
> reconfigure path) instead, which handles both the merge and the substitution
> correctly.
>
> **`claude-md:graphify-root` is excluded from the `claude-md` force set** for the
> same reason. It carries `mergeStrategy: "merge-section"` and targets the root
> `CLAUDE.md`; `--force` (`lib/apply.mjs`) skips merge handling and raw-overwrites,
> so forcing it would replace the entire root `CLAUDE.md` with just the `## graphify`
> section — destroying every other section. Worse, force-patching the `claude-md`
> category regenerates `claude-md-root`, which drops the merged `## graphify` block
> entirely. So drop `claude-md:graphify-root` from the `--only` list in step 2, and
> let **step 6** re-merge it non-destructively afterward. (The sibling
> `claude-md:graphify-skill` targets the graphify-only `.claude/CLAUDE.md` — graphify
> is its sole writer, so force there is harmless and it stays in the set.)

## 2. Ask the user which categories to patch

Present only the categories that have at least one matching artifact, **excluding
`obsidian`** (see note above — it is never offered as an option here).
Use `AskUserQuestion` with `multiSelect: true`.

**`AskUserQuestion` accepts at most 4 options per question.** If there are more than 4
categories, split them across multiple sequential `AskUserQuestion` calls (e.g. "grupo 1/2",
"grupo 2/2"). Collect all answers before proceeding.

Example prompt text for each group: "Which categories do you want to force-update? (group N/T)"

For each selected category, collect all artifact IDs whose prefix matches.
**Always drop `claude-md:graphify-root` from the collected IDs** even when the
`claude-md` category is selected (force would overwrite the whole root `CLAUDE.md`
with just its section — step 6 re-merges it safely).
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
   configured** — use `AskUserQuestion` (single-select) to let the user choose:
   *"Files >350 lines — **block and refactor now** (new project, start clean)
   or **suggest and confirm only** (legacy project, no auto-block)?"* → `block` / `advisory`. The hook
   is mandatory; this only sets its mode.

Always pass the resolved value as `--large-files=<mode>` (it only takes effect when
`settings` is among the patched categories; harmless otherwise).

## 5. Apply with force

```bash
node "${CLAUDE_PLUGIN_ROOT}/bin/harness.mjs" apply "${1:-$CLAUDE_PROJECT_DIR}" \
  --yes --force --only=<comma-joined IDs> --large-files=<mode>
```

Report the apply output to the user verbatim.

> **Note:** `--force` overwrites existing files that differ from what the engine
> generates. Files not in the selected categories are untouched.

## 6. Reconcile the graphify knowledge-graph section in the root CLAUDE.md

The root `CLAUDE.md` should carry a `## graphify` section (knowledge-graph usage +
query/update workflow) **whenever graphify is installed in this project**. It is
merged, never force-written (a force pass would wipe the whole file), so it needs a
dedicated non-destructive step here — and step 5's force-regeneration of
`claude-md-root`, if `claude-md` was patched, drops it, so this must run **after**
step 5 unconditionally.

1. **Is graphify installed?** From the step-1 plan JSON, check whether the
   `graphify-orient-hook` artifact (or `tool-skill:graphify`) reports `exists: true`
   — i.e. the graphify harness is actually wired into this project, not merely
   recommended. If graphify is **not** installed, skip this step silently.
2. **Is the section present?** Read the resolved target's root `CLAUDE.md` and look
   for a line matching `^## graphify$`.
   - **Present** → report "graphify section already present" and do nothing.
   - **Missing** → report "graphify section missing — including it" and merge it in
     (no `--force`, so `apply` runs the section-merge and leaves every other section
     of the root `CLAUDE.md` untouched):

     ```bash
     node "${CLAUDE_PLUGIN_ROOT}/bin/harness.mjs" apply "${1:-$CLAUDE_PROJECT_DIR}" \
       --yes --only=claude-md:graphify-root
     ```

Report the engine's output verbatim. Because the merge is idempotent, running this
step when the section is already current is a harmless no-op (`skipped … identical`).
