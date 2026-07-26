---
description: Merge the current harness into a project that already has one — apply everything that is safe mechanically, then adjudicate every conflicting file with the user, diff by diff.
argument-hint: "[path]"
allowed-tools:
  - Bash
  - Read
  - Edit
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
wrong place. Every `"${1:-$CLAUDE_PROJECT_DIR}"` in the code blocks below is shorthand for that
one resolved literal — substitute it, do not paste the expression.

## What this command does

This is a **merge**, not an overwrite. The engine applies everything it can decide on its own:
files that are missing get created, files that are already identical get skipped, and files with
an additive merge strategy (`settings.json`, `.mcp.json`, `.gitignore`-style line lists) get
merged with the existing value always winning.

Everything else is **not written**: a file that exists and differs with no mechanical strategy,
and a merged `CLAUDE.md` section that exists and differs (it replaces the whole section rather
than merging key-by-key, so a differing one is parked rather than replaced). The engine renders
the fresh version — the whole file, section replacement included — under
`.claude/.aia-harness-pending/` and reports its exact `pendingPath` in `conflicts[]`, and you and
the user resolve it together in step 7.

**Standing rule for this command: never write a file without showing its diff first.** That
applies to every write in step 7 without exception, whichever tool performs it — no silent
writes, no "this one is obviously fine".

## 1. Build the plan and collect artifact IDs

Run plan in JSON mode to see every artifact the engine would produce:

```bash
node "${CLAUDE_PLUGIN_ROOT}/bin/harness.mjs" plan "${1:-$CLAUDE_PROJECT_DIR}" --json
```

Keep this JSON for the rest of the command — step 7 reuses its `rootClaudeMd` audit, and the
`exists` flag on each artifact decides whether the `obsidian` category is offered at all.

Parse the JSON. Group artifact IDs by prefix into these logical categories
(only include a category if at least one artifact with that prefix exists):

| Category label | ID prefix(es) to match |
|---|---|
| `settings` — settings.json + settings.local.json | `settings` (exact), `settings-local` (exact) |
| `hooks` — all hook files | starts with `hook:` |
| `claude-md` — root + domain CLAUDE.md files + the memory index (carries the dynamic Superpowers bridge, plus the merged graphify section) | `claude-md-root`, `memory-index` (exact), or starts with `claude-md:` |
| `rules` — .claude/rules/ files, including the vendored ECC rule directories | starts with `rule:`, `ecc-rules:` |
| `mcp` — .mcp.json | `mcp` (exact) |
| `skills` — first-party + ECC + ag-kit skills | starts with `skill:`, `ecc-skill:`, `agkit-skill:` |
| `agents` — ECC + ag-kit + first-party project agents (installs best-practice condition-shaped routing) | starts with `ecc-agent:`, `agkit-agent:`, `agent:project:` |
| `tools` — rtk hook, graphify (caveman/ponytail are global plugins, not patched here) | starts with `tool-skill:`, `tool-hooks:`, `graphifyignore` (exact), or `graphify-orient-hook` (exact) |
| `git-hooks` — graphify git hooks (post-commit, post-checkout) | starts with `graphify-git-hook:` |
| `github-pm` — skill, commands, templates, workflows | starts with `github-pm:` |
| `obsidian` — vault-memory pillar (offered only when it is already installed — see below) | starts with `obsidian:` |
| `docs` — harness strategies doc | `strategies` (exact) |
| `lsp` — language server config | `lsp` (exact) |
| `worktree` — .worktreeinclude | `worktree` (exact) |
| `script` — install reference scripts | `install-plugins` (exact), or starts with `agkit-script:` |
| `commands` — first-party + ag-kit commands (non-github-pm) | starts with `command:`, `agkit-command:` |

> **The `obsidian` category is offered only when the pillar is already installed here.** Merging
> an obsidian artifact that already exists is safe and is exactly the upgrade path this command
> is for: the two merge-section ids (`obsidian:claude-md`, `obsidian:memory-instructions`) merge
> in place, and the rest are parked as conflicts for step 7. A **missing** obsidian artifact is a
> different case that merging does not solve — the engine creates a missing file verbatim from
> the template, and most of these artifacts still carry the literal `__OBSIDIAN_VAULT_DIR__`
> placeholder that only `/aia-harness:add-obsidian` knows how to substitute with the real vault
> folder name, while `obsidian:memory-instructions` would land as a lone `## Sanitation` section
> with no surrounding document. So: offer the category only when **every** `obsidian:` artifact
> in the plan reports `exists: true`. Otherwise omit it and report precisely what you found —
> "not installed" when none of them exist, "partially installed (N of M artifacts present)" when
> only some do, naming the missing ones. Either way the fix is the same command:
> `/aia-harness:add-obsidian` installs a missing pillar and repairs a partial one, because it is
> the only flow that substitutes the vault folder name.

## 2. Ask the user which categories to patch

Present the categories that have at least one matching artifact (with `obsidian` subject to the
condition above). Use `AskUserQuestion` with `multiSelect: true`.

**`AskUserQuestion` accepts at most 4 options per question.** If there are more than 4
categories, split them across multiple sequential `AskUserQuestion` calls (e.g. "group 1/2",
"group 2/2"). Collect all answers before proceeding.

Example prompt text for each group: "Which categories do you want to merge in? (group N/T)"

For each selected category, collect all artifact IDs whose prefix matches, then join them into a
single comma-separated string for `--only`.

## 3. Show what will be patched

Before running, print a summary:

```text
Merging [N] artifacts in categories: <selected labels>
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

## 5. Merge the selected categories

```bash
node "${CLAUDE_PLUGIN_ROOT}/bin/harness.mjs" apply "${1:-$CLAUDE_PROJECT_DIR}" \
  --yes --merge --only=<comma-joined IDs> --large-files=<mode> --json
```

Merging never overwrites a file the user has changed. Files outside the selected ids are
untouched. Keep the parsed JSON — step 7 iterates its `conflicts[]`.

## 6. Report the engine result

From the JSON, report to the user:

- **created** — files that were missing and are now installed.
- **updated** — files an additive merge strategy changed (the existing value won every time the
  two sides disagreed, only what was missing got added), plus any merged `CLAUDE.md` section
  that was missing and got appended.
- **skipped** — already identical, plus every conflict (each appears as
  `<relPath> (conflict — pending review)`).
- **conflicts** — the count, then hand each one to step 7. The engine has already written the
  fresh version to `pendingPath`; the real file is still exactly as the user left it.
- **errors** — report each verbatim. A source/target type mismatch shows up here (the target is
  a file where the catalog now ships a directory, or the reverse); the engine keeps applying the
  rest of the plan, but that entry needs the user to remove or rename the target by hand.

If `conflicts` is empty, say so and skip to the end — there is nothing to adjudicate and no
pending directory to clean up.

## 7. Adjudicate each conflict

> This is the plugin's canonical conflict-adjudication procedure. Other commands reference this
> section rather than restating it — keep it self-contained. Its own 7.x sub-steps may reference
> each other by number; nothing in it may reference a step *outside* it by number, since a
> referencing command numbers its own steps differently.

**Preconditions.** Any command entering here must already have:

1. a completed writing `apply` run (`--yes`) with `--json`, whose `conflicts[]` array is what this
   section iterates, and whose pending files are still on disk;
2. a completed `plan … --json` run, whose `rootClaudeMd` audit is the ownership map used below;
3. the target directory resolved to a literal absolute path.

**This section writes files, so its own rule applies throughout: never write a file without
showing its diff first.** No silent writes, no "this one is obviously fine".

Work through `conflicts[]` **one entry at a time**, finishing each before starting the next.
Never batch-approve. Each entry is `{ id, relPath, category, pendingPath }`; for a file inside a
vendored directory artifact, `relPath` is that individual file while `id` stays the directory's
id, so group by `id` when you report progress ("file 2 of 5 in `skill:foo`").

**Always use the entry's own `pendingPath` verbatim — never rebuild it from `relPath`.** It is
`.claude/.aia-harness-pending/<artifact-id-slug>/<relPath>`, keyed by artifact id because more
than one artifact can target the same file: the root `CLAUDE.md` is produced by `claude-md-root`
*and* refreshed by the `claude-md:graphify-root` / `obsidian:claude-md` sections, and
`.claude/memory/INSTRUCTIONS.md` by `claude-md:memory-instructions` *and*
`obsidian:memory-instructions`. So **the same `relPath` can legitimately appear in more than one
conflict entry**, each with a different `id`, a different `pendingPath`, and a different proposed
change. When that happens: adjudicate them in the order they appear, and after applying a
decision to that file, rebuild the next entry's proposal in 7.4 from the file **as it now stands**
rather than from its own `pendingPath` — that pending file was rendered against the pre-decision
version, so copying it over would silently revert what you just wrote.

Before the first conflict, determine once whether the target is a git repository:

```bash
git -C "${1:-$CLAUDE_PROJECT_DIR}" rev-parse --is-inside-work-tree
```

If that fails, say so plainly — history is unavailable, so every conflict below is adjudicated
from the generated-vs-current diff alone, and skip the two history commands in step 7.2.

### 7.1 Show the diff

```bash
git -C "${1:-$CLAUDE_PROJECT_DIR}" diff --no-index -- "<relPath>" "<pendingPath>"
```

Left side is what the project has now; right side is what this plugin version generates.
**This command exits non-zero whenever there is a difference — that is the expected result, not
an error.** Do not retry it or report it as a failure. It also works outside a git repository,
which is why it is the one command that always runs.

### 7.2 Tell user edits apart from plugin evolution

The whole judgement rests on one question per hunk: *did the user change this, or did the
plugin?* History answers it:

```bash
git -C "${1:-$CLAUDE_PROJECT_DIR}" log --oneline -- "<relPath>"
git -C "${1:-$CLAUDE_PROJECT_DIR}" diff HEAD -- "<relPath>"
```

The `log` shows whether the file has been touched since it was scaffolded — commits after the
initial harness commit are user intent. The `diff HEAD` catches uncommitted local edits, which
are the most likely to be lost and the least likely to be recoverable. Run it whenever the log
is ambiguous or the file has uncommitted changes.

### 7.3 Classify every hunk

`Read` both files in full — the current one and `pendingPath` — and put each hunk into exactly
one bucket:

- **User customization → preserve.** Present in the current file, absent or different in the
  generated one, and traceable to the user (a later commit, an uncommitted edit, project-specific
  content the generator has no way to produce). Enrichment written by `/aia-harness:init` step 5.5
  into `## Conventions` / `## Architecture map` is user content for this purpose.
- **Plugin evolution → take.** Present in the generated file, absent or stale in the current one,
  and attributable to a newer plugin version (a new rule, a rewritten agent routing description,
  a new hook branch). Nothing in the file's history explains it.
- **Genuine conflict → ask.** The same region changed on both sides. Do not guess a winner.
  Describe both versions concretely and let the user decide in step 7.5.

For a markdown artifact, the ownership map for the root `CLAUDE.md` is the `rootClaudeMd` audit
from the `plan --json` output already fetched earlier in this flow. The sections it accounts for —
the union of `present` and `missing` — are the plugin's; every other section in the file is the
user's and **must survive verbatim**.

**Both arrays identify sections by `id`, not by heading text**, and several ids do not map
mechanically to the heading you have to match (`behavioral` → `## Behavioral guidelines`,
`workflow-agents` → `## Workflow & Agents`, `agent-routing` →
`### Superpowers → Project Specialists (mandatory bridging)`, `obsidian` → `## obsidian-vault`,
`memory-imports` → the `@.claude/memory/MEMORY.md` import line rather than a heading). `missing`
entries also carry a `label`, but `present` entries are bare id strings — and `present` is the
common case when re-patching a configured project. So resolve ids to headings from the source of
truth instead of guessing: `Read` the plugin's own
`${CLAUDE_PLUGIN_ROOT}/lib/generate/root-sections.mjs` and use the `id` → `heading` pairs of its
`ROOT_CLAUDE_MD_SECTIONS` array. Every audited id appears there exactly once.

**Two of those sections are never in the generated root file.** `graphify` and `obsidian-vault`
are merged in as separate section artifacts, so the `claude-md-root` content parked at
`pendingPath` does not contain them. Taking that generated file wholesale would silently delete
both from a project that has them. Whenever the root `CLAUDE.md` is the conflict, check the
current file for those sections first and carry them across explicitly.

### 7.4 Build the merged proposal and diff it

The merged result is the one thing neither 7.1 nor the current file already shows, so it needs a
real file and a real diff — not a prose description of what you intend to write. Build it beside
the generated file, leaving both the current file and `pendingPath` untouched:

```bash
cp "<pendingPath>" "<pendingPath>.merged"
```

`Edit` `<pendingPath>.merged` into the merged result you decided on in 7.3, then show it with the
same mechanism 7.1 used:

```bash
git -C "${1:-$CLAUDE_PROJECT_DIR}" diff --no-index -- "<relPath>" "<pendingPath>.merged"
```

That diff is current-versus-proposal, produced by git rather than narrated by you, and it is the
diff the user approves. Non-zero exit is again the expected result. Alongside it, state:

- what the merge **keeps** from the current file (the user customizations, by section or hunk),
- what it **changes** to the generated version (the plugin evolution, by section or hunk),
- anything you could not classify, and what you propose for it.

`.merged` files live inside the pending directory, so the cleanup step removes them too.

### 7.5 Ask, then apply

`AskUserQuestion` (single-select) with these three options:

- **Apply the merge** — the proposal just diffed in 7.4.
- **Keep the current file** — write nothing; the plugin's version is discarded for this file.
- **Take the generated version** — replace the current file with `pendingPath` as generated,
  which is the diff already shown in 7.1. Warn first when this drops user content you identified
  in 7.3, and always warn for the root `CLAUDE.md` (see the merged-sections note above).

Every option's diff has therefore been shown before anything is written. Apply the user's choice
by copying the approved file over the target, so the bytes written are exactly the bytes reviewed:

```bash
cp "<pendingPath>.merged" "${1:-$CLAUDE_PROJECT_DIR}/<relPath>"   # apply the merge
cp "<pendingPath>" "${1:-$CLAUDE_PROJECT_DIR}/<relPath>"          # take the generated version
```

Re-running `apply` is never the fix here: for any artifact with a merge strategy it is
additive-only, so it can add what is missing but can never correct a wrong existing value. `cp`
of an approved file, or a targeted `Edit`, are the only correct writes at this point.

Then move to the next conflict.

## 8. Clean up the pending directory

Once every conflict has an answer, delete the staging directory:

```bash
rm -rf "${1:-$CLAUDE_PROJECT_DIR}/.claude/.aia-harness-pending"
```

If the user wants to review something later, leave the directory in place and say so — it is
already gitignored by the plan, so it will not be committed either way. Report which conflicts
were merged, which kept the current file, and which took the generated version.
