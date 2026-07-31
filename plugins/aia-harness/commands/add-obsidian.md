---
description: Install and configure the Obsidian vault-as-memory pillar (vault skeleton, MCP server, hooks, rule) into this project
argument-hint: "[path]"
allowed-tools:
  - Bash
  - Read
  - Edit
  - AskUserQuestion
---

# Add Obsidian vault memory

Target directory: `$1` if provided, else `$CLAUDE_PROJECT_DIR`. Installs a
versioned PARA vault, the `obsidian` MCP server, 6 hooks that keep it in sync
automatically, a usage rule, and the required permission grant.

<!-- aia-harness:target-dir-resolution -->
Resolve the target directory **once**, at the start of this command, into a concrete literal
absolute path. `$CLAUDE_PROJECT_DIR` is documented as available "when hooks are executed" but is
not guaranteed inside the general-purpose Bash tool used to run these instructions — it can
silently expand empty there, and the CLI then falls back to the shell's *current* working
directory, which is wrong if the agent has since `cd`'d elsewhere (e.g. into the scratchpad for
intermediate file work). Reuse that one resolved literal path in every subsequent CLI invocation
below — never re-expand a bare `$CLAUDE_PROJECT_DIR` in a later, separately-issued Bash call,
since each Bash tool call is a fresh shell (only cwd persists, not exported variables) and an
earlier `cd` silently redirects any later bare-env-var fallback to the wrong place.

<!-- aia-harness:version-check -->
## Before anything else — plugin version check

```bash
node "${CLAUDE_PLUGIN_ROOT}/bin/harness.mjs" version-check --json
```

Read `status` from the JSON:

- `"stale"` — report `running` → `latest`, then `AskUserQuestion`: **Update now** (run the
  returned `updateCommand`, then stop and tell the user to run `/reload-plugins` or start a new
  session and re-issue this command — a running plugin copy cannot hot-swap itself) or
  **Continue on the current version** (go straight to the next step).
- `"current"` or `"unknown"` — say nothing, continue.

This check never blocks: it exits 0 even when it cannot reach the registry, and `"unknown"`
means the answer is unavailable, not that something is wrong.
<!-- /aia-harness:version-check -->

## Step 0: Confirm the harness is already set up

Check that `${1:-$CLAUDE_PROJECT_DIR}/.claude/settings.json` exists. If it does not,
this project hasn't run `/aia-harness:init` yet — installing the Obsidian pillar
on top of a bare project would write a `.claude/settings.json` that references
hooks (`guard-main-branch.mjs`, `secret-scan.mjs`, and others) that were never
actually created, breaking every future session with repeated "cannot find
module" errors. Tell the user to run `/aia-harness:init` first, then re-run
`/aia-harness:add-obsidian`. Stop here — do not proceed to Step 1.

## Step 1: Check for an existing setup

Read `${1:-$CLAUDE_PROJECT_DIR}/.mcp.json` if it exists. If it already has a
top-level `mcpServers.obsidian` key, tell the user this project already has
Obsidian configured and ask via AskUserQuestion:

- "Reconfigure (refresh hooks/rule/CLAUDE.md to latest, keep existing vault + MCP entry)"
- "Cancel"

If they cancel, stop here without changes.

If they choose to **reconfigure**: read `mcpServers.obsidian.env.OBSIDIAN_VAULT_PATH`
from the `.mcp.json` just parsed above, strip the leading `./`, and set
`VAULT_DIR` to the result — this is the project's real, existing vault folder
name. "Keep existing vault" means the name doesn't change, so do **not** run
Step 3 (there is nothing to ask). Also skip Step 2 (the MCP entry already
runs via `uvx`; its dependency was already satisfied when it was first set
up), Step 4 (vault skeleton — already exists), and Step 4b (`.mcp.json`
write — already exists, kept as-is). Go straight to Step 4c, then both Step 5
apply calls, then Step 6 (substituting the `VAULT_DIR` value just read), then
Step 7 (isolated SDK install — idempotent, safe to re-run), then Step 8
(idempotent — re-checks and re-refreshes the memory sanitation policy on
every reconfigure too), then Step 9.

If this is a **fresh install** (no existing `mcpServers.obsidian` key),
proceed through every step in order: Step 2 → Step 3 (asks for and sets
`VAULT_DIR`) → Step 4 → Step 4b → Step 4c → both Step 5 apply calls →
Step 6 → Step 7 → Step 8 → Step 9.

## Step 2: Check the `uv` dependency

**Fresh-install branch only.** The reconfigure branch skips this step entirely
(see Step 1) — the MCP entry already runs via `uvx`, so its dependency was
already satisfied when it was first configured.

Run:

```bash
node "${CLAUDE_PLUGIN_ROOT}/bin/harness.mjs" check "${1:-$CLAUDE_PROJECT_DIR}" --tools=obsidian-mcp --json
```

Parse the JSON `status` field:

- `"ok"` or `"warn"`: continue to Step 3.
- `"block"` (missing `uv`): tell the user `uv` (which provides `uvx`) is
  required to run the Obsidian MCP server, then ask via AskUserQuestion:
  "Install `uv` now?" (Yes / No). If No, stop here.

If Yes, detect the platform:

```bash
node -e "console.log(process.platform)"
```

macOS (Homebrew available — `command -v brew >/dev/null 2>&1`):

```bash
brew install uv
```

macOS / Linux (no Homebrew):

```bash
curl -LsSf https://astral.sh/uv/install.sh | sh
```

Windows (`win32`):

```bash
winget install astral-sh.uv
```

Run the matching installer via Bash automatically — no additional confirmation needed (the user already confirmed via the AskUserQuestion above). This is the exact same `uv`-install block `add-tools.md` uses for `graphify`'s dependency — `uv` only ever needs installing once regardless of which feature required it.

After installing, re-run the `check ... --tools=obsidian-mcp --json` command above and confirm `status` is no longer `"block"` before continuing. If it's still blocked, tell the user to add `uv` to PATH manually and re-run this command, then stop.

## Step 3: Ask for the vault folder name

**Fresh-install branch only.** The reconfigure branch skips this step entirely
(see Step 1) — it already set `VAULT_DIR` by reading the existing `.mcp.json`
instead of asking.

Use AskUserQuestion:

- Question: "What folder name should the Obsidian vault use? It will be
  created at the project root and committed to git."
- Header: "Vault folder"
- Options:
  - "`vault-obsidian` (recommended)" — a plain, visible folder committed with
    the project as its long-term memory (no leading dot, so it isn't hidden).
  - Let the user type a custom name via the free-text "Other" option.

Validate whatever name is chosen against `^[A-Za-z0-9._-]{1,64}$` and reject
`.` or `..` exactly. If it fails validation, explain why (only letters,
digits, `.`, `_`, `-`; 1-64 characters; not `.` or `..`) and ask again via
AskUserQuestion with the same two options. Once valid, store it as
`VAULT_DIR` (a literal string) for every remaining step.

## Step 4: Create the vault skeleton

**Fresh-install branch only** — the reconfigure branch skips this entirely
(see Step 1); the vault already exists.

Set two shell variables from the resolved target directory (Step "target-dir
resolution" above) and the folder name chosen in Step 3, then create the
folders:

```bash
TARGET="${1:-$CLAUDE_PROJECT_DIR}"   # use the already-resolved literal path, not this expansion, if one was captured earlier
VAULT_DIR="<the name chosen in Step 3>"
mkdir -p "$TARGET/$VAULT_DIR/01-projects" "$TARGET/$VAULT_DIR/02-areas" "$TARGET/$VAULT_DIR/03-knowledge" "$TARGET/$VAULT_DIR/04-resources" "$TARGET/$VAULT_DIR/daily" "$TARGET/$VAULT_DIR/templates"
```

Then copy the 5 PARA templates and the 5 `.gitkeep` files from this plugin's
`templates/tools/obsidian/vault-skeleton/` into the new folders, preserving
the exact relative layout (`01-projects/.gitkeep` → `$TARGET/$VAULT_DIR/01-projects/.gitkeep`,
`templates/project.md` → `$TARGET/$VAULT_DIR/templates/project.md`, and so
on for `02-areas`, `03-knowledge`, `04-resources`, `daily`, and the other 4
template files). Do not overwrite any file that already exists at the
destination (skip-if-exists, same safety default as the rest of this
harness).

## Step 4b: Configure `.mcp.json`

**Fresh-install branch only** — the reconfigure branch skips this entirely
(see Step 1); the entry already exists and is kept as-is.

Read `$TARGET/.mcp.json`. If it doesn't exist, start from `{}`. Merge in
this server entry (creating `mcpServers` if absent):

```json
{
  "mcpServers": {
    "obsidian": {
      "type": "stdio",
      "command": "uvx",
      "args": [
        "--refresh",
        "--from",
        "git+https://github.com/Swapo-Finance/obsidian-mcp",
        "obsidian-mcp"
      ],
      "env": {
        "OBSIDIAN_VAULT_PATH": "./__VAULT_DIR_PLACEHOLDER__",
        "OBSIDIAN_FOLDER_TEMPLATES": "[{\"folder\":\"01-projects\",\"template\":\"templates/project.md\"},{\"folder\":\"02-areas\",\"template\":\"templates/area.md\"},{\"folder\":\"03-knowledge\",\"template\":\"templates/knowledge.md\"},{\"folder\":\"04-resources\",\"template\":\"templates/resource.md\"},{\"folder\":\"daily\",\"template\":\"templates/daily.md\"}]",
        "OBSIDIAN_SLUG_STYLE": "kebab",
        "OBSIDIAN_TAG_STYLE": "kebab",
        "OBSIDIAN_WIKILINK_POLICY": "strict",
        "OBSIDIAN_DAILY_DIR": "daily",
        "OBSIDIAN_REQUIRE_FRONTMATTER": "true",
        "OBSIDIAN_SEARCH_RESULT_MODE": "auto"
      }
    }
  }
}
```

Replace the literal `./__VAULT_DIR_PLACEHOLDER__` above with `./` followed by
the actual chosen folder name from Step 3 (i.e. `./$VAULT_DIR`). Preserve every other existing top-level key
and every other existing entry under `mcpServers` — this is a merge, not a
replace of the whole file (same rule `add-mcp.md` already follows).

## Step 4c: Grant the MCP server permission

**Both branches** — idempotent, always safe to (re-)run regardless of which
branch of Step 1 you came from.

Read `$TARGET/.claude/settings.json` (create `{}` if absent). Ensure a
`permissions.allow` array exists (create `permissions: { allow: [] }` if
either is missing) and contains the string `"mcp__obsidian"`. If it's already
present, do nothing (idempotent). Otherwise append it and write the file
back with the same 2-space JSON formatting as the rest of the file.

## Step 5: Apply the hooks, rule, CLAUDE.md section, and settings.json wiring

**Both branches** — run these same two calls whether this is a fresh install
or a reconfigure; nothing here branches on Step 1's choice.

Run:

```bash
node "${CLAUDE_PLUGIN_ROOT}/bin/harness.mjs" plan "$TARGET" --tools=obsidian-mcp --json
```

From the JSON output, confirm every artifact `id` whose `category` is
`"obsidian"` is present (11 ids: `obsidian:rule`, `obsidian:hook:vault-orient`,
`obsidian:hook:vault-guard`, `obsidian:hook:compile`,
`obsidian:hook:session-log`, `obsidian:hook:vault-note-merge`,
`obsidian:hook:vault-pipeline-shared`, `obsidian:script:compile-runner`,
`obsidian:script:session-log-runner`, `obsidian:claude-md`,
`obsidian:memory-instructions`), plus the fixed id `settings`. The last one
(`obsidian:memory-instructions`) is applied separately, in Step 8, once its
own precondition — an existing `.claude/memory/INSTRUCTIONS.md` — has been
checked; it is not part of either apply call below. Then run **two** separate
apply calls, in this order, both passing `--tools=obsidian-mcp` so `buildPlan`
computes the obsidian hook fragment into the `settings` artifact's content:

**5a. The 9 plain-content artifacts:**

```bash
node "${CLAUDE_PLUGIN_ROOT}/bin/harness.mjs" apply "$TARGET" --yes --tools=obsidian-mcp --only=obsidian:rule,obsidian:hook:vault-orient,obsidian:hook:vault-guard,obsidian:hook:compile,obsidian:hook:session-log,obsidian:hook:vault-note-merge,obsidian:hook:vault-pipeline-shared,obsidian:script:compile-runner,obsidian:script:session-log-runner --merge --json
```

These 9 (the rule, the 6 hooks, and the 2 runner scripts) carry no
`mergeStrategy` in `lib/data/obsidian-catalog.mjs`, so a plain `apply` treats
any one of them that already exists and differs as
`skipped: ... (exists, differs — left unchanged)`, full stop — which is what
made the old single-call, no-flag version of this step a near no-op on
reconfigure. Merging is what fixes that without the blast radius of a
`--force` overwrite. On a fresh install nothing exists yet, so all 9 are
simply created and this call behaves exactly as it always did; on a
reconfigure, each one that already exists and differs is **left on disk
untouched**, rendered instead to `.claude/.aia-harness-pending/<artifact-id-slug>/<relPath>` and
reported in `conflicts[]`. One call still covers both branches — no branching
needed here.

Adjudicate every `conflicts[]` entry with **`patch.md` section 7 ("Adjudicate
each conflict")** — `Read` `${CLAUDE_PLUGIN_ROOT}/commands/patch.md` and follow
that section as written rather than improvising a diff review here. Its three
preconditions are satisfied by this call, the `plan … --json` above, and the
already-resolved `$TARGET`. Remove the staging directory as that command's
step 8 describes once every conflict has an answer.

**One obsidian-specific caveat while adjudicating.** The pending copies come
straight from the vendored templates, so they still carry the literal
`__OBSIDIAN_VAULT_DIR__` token that Step 6 substitutes afterwards. A hunk that
differs *only* by that token versus the real folder name is not a change at
all — never classify it as plugin evolution, and never put it to the user as
something to resolve. Step 6 runs over whatever ends up on disk either way,
and its closing `grep` is the check that nothing was left unsubstituted.

**5b. `obsidian:claude-md` and `settings` — merged, never `--force`:**

**First resolve the large-file guard mode.** The `settings` artifact carries that
wiring, so re-applying it must not silently flip or duplicate it. Read
`$TARGET/.claude/settings.json` and look for `large-file-warning.mjs`: wired under
**`Stop`** → the mode is `block`; under **`PostToolUse`** → `advisory`. Preserve
whichever you find. If it is wired nowhere (or the file is absent) the mode is not yet
configured — ask with `AskUserQuestion` (single-select): *"Files >350 lines — **block
and refactor now** (new project, start clean), or **suggest and confirm only** (legacy
project, no auto-block)?"* → `block` / `advisory`. The hook is mandatory; this only
picks its mode.

```bash
node "${CLAUDE_PLUGIN_ROOT}/bin/harness.mjs" apply "$TARGET" --yes --tools=obsidian-mcp --only=obsidian:claude-md,settings --large-files=<mode> --merge --json
```

Passing `--large-files=<mode>` is not optional here. `renderSettings` wires the guard
under `Stop` **or** `PostToolUse` depending on the mode, and `mergeSettingsJson` only
ever adds what is missing — so generating the mode the target does not use would leave
it wired under both events, firing the guard twice on every session.

Merging is what keeps this safe. A `# obsidian-vault` section that already exists
**and differs** — because the user annotated it with their own vault conventions —
is parked in `conflicts[]` for adjudication instead of being replaced in place; a
missing section is still appended mechanically, so a fresh install behaves exactly
as before.

**Adjudicate every `conflicts[]` entry this call returns with `patch.md`
section 7**, the same way step 5a does — `Read`
`${CLAUDE_PLUGIN_ROOT}/commands/patch.md` and follow that section as written.
Its three preconditions are satisfied by this call, the `plan … --json` above,
and the already-resolved `$TARGET`. `settings` merges additively and will not
appear there; `obsidian:claude-md` appears only when its section already exists
and differs.

**Do not add `--force` to this call — two distinct reasons, one per id:**

- `obsidian:claude-md` targets the root, always-loaded `CLAUDE.md` (the same
  file the main harness writes) and carries `mergeStrategy: "merge-section"`
  (`mergeMarkdownSection` in `lib/apply.mjs`): it appends the `# obsidian-vault`
  block when absent and parks it as a conflict when it exists
  and differs — touching no sibling section either way.
  `--force` bypasses merge strategies entirely and falls straight through to a
  raw overwrite of the whole target file; on this id that would replace the
  target project's entire `CLAUDE.md` with nothing but the obsidian section,
  destroying every other section it has (graphify, other pillars, hand-written
  notes, etc.). Never force this id.
- `settings` almost always already exists in a harnessed target project —
  without `--force`, a differing `settings` artifact is merged via
  `mergeStrategy: "merge-settings"` (`mergeSettingsJson` in `lib/apply.mjs`):
  it **adds the missing obsidian hook entries** plus any missing
  `permissions.allow`/`env`/`enabledPlugins`/`extraKnownMarketplaces` entries
  this plan introduces, while leaving every key the target already has —
  custom permissions, other pillars' hooks, an existing `enabledPlugins`
  entry, etc. — untouched. `--force` here would instead fully overwrite the
  whole file with this plan's freshly generated content, silently discarding
  any customization the target project already made — never do that for
  `settings` either.

Together, these two calls install the 6 hooks and the 2 runner scripts, refresh
the rule (5a), install the CLAUDE.md section, and merge in the 4 hook events in
`.claude/settings.json` (5b) — genuinely current on both a fresh install and a
reconfigure, and neither call can clobber user customization any more. They stay
two calls because 5b's ids need the `--large-files` mode resolved first; merging
is the default for both, so anything the user changed comes back as a conflict to
adjudicate rather than being overwritten, whichever call produced it.

## Step 6: Substitute the real vault folder name into the copied files

**Both branches** — but which files actually need it now depends on what Step 5a
wrote. Anything it **created** (every file on a fresh install; a missing artifact
on reconfigure) comes straight from the vendored templates and still carries the
placeholder. Anything that came back as a **conflict** was left untouched and
keeps the real vault name it already had — unless the user resolved it by taking
the generated version, which reintroduces the placeholder. So work through the
whole list below either way rather than tracking which is which: an `Edit` whose
token is not present simply fails without writing anything, and the closing
`grep` is what actually proves nothing was left behind.

The files that came from the templates contain the literal placeholder token
`__OBSIDIAN_VAULT_DIR__`. Replace it with the real folder name resolved
earlier and stored in `$VAULT_DIR` — read from the existing `.mcp.json` in
Step 1 on the reconfigure branch, or chosen in Step 3 on the fresh-install
branch — in **8 destination files**, using the Edit tool on each
(verify occurrence counts against the live template source under
`templates/hooks/`, `templates/rules/`, and `templates/tools/obsidian/` if
this ever looks stale):

- `$TARGET/.claude/hooks/vault-orient.mjs` — 3 occurrences, plain string
  replace.
- `$TARGET/.claude/hooks/vault-guard.mjs` — **3 occurrences**. The first is
  inside a regex literal (`const VAULT_SEGMENT_RE = /(^|\/)__OBSIDIAN_VAULT_DIR__(\/|$)/;`)
  — if the chosen folder name contains any regex-special character (any of
  `. * + ? ^ $ { } ( ) | [ ] \`), escape each one with a backslash before
  substituting into this line only. The second
  (`command.includes("__OBSIDIAN_VAULT_DIR__/")`) and third (inside the
  `REASON` message array, the user-facing deny explanation starting
  `"__OBSIDIAN_VAULT_DIR__/ is served by the obsidian MCP server..."`) are
  both plain strings — use the raw (unescaped) chosen name for those two.
- `$TARGET/.claude/hooks/compile.mjs` and `$TARGET/.claude/hooks/session-log.mjs`:
  1 occurrence each, plain string replace with the chosen name.
- `$TARGET/.claude/rules/obsidian.md`: replace every occurrence with the
  chosen name (5 occurrences; plain string replace — it's prose, not a
  regex).
- `$TARGET/CLAUDE.md`: 1 occurrence, inside the merged obsidian-vault
  section (`` this project's long-term memory at `__OBSIDIAN_VAULT_DIR__/` ``)
  — plain string replace.
- `$TARGET/.claude/scripts/compile-runner.mjs`: 1 occurrence
  (`path.join(projectDir, "__OBSIDIAN_VAULT_DIR__")`) — plain string replace.
  This is the detached worker `compile.mjs` spawns to promote yesterday's
  daily note; an unsubstituted placeholder here silently breaks that whole
  pipeline (it would resolve a vault root that never exists).
- `$TARGET/.claude/scripts/session-log-runner.mjs`: 1 occurrence
  (`path.join(projectDir, "__OBSIDIAN_VAULT_DIR__", "daily")`) — plain string
  replace. Same failure mode: the session-end daily-note writer would target
  a directory that never exists.

Verify with:

```bash
grep -rl "__OBSIDIAN_VAULT_DIR__" "$TARGET/.claude/hooks" "$TARGET/.claude/scripts" "$TARGET/.claude/rules/obsidian.md" "$TARGET/CLAUDE.md"
```

Expected: no output (every occurrence substituted). If anything is still
listed, fix it before proceeding — a leftover placeholder in a hook or
script would make it read from or write to a directory that will never
exist; a leftover in the rule or CLAUDE.md is at minimum a confusing literal
string shown to every future session.

## Step 7: Gitignore local vault paths, then install the writers' SDK (optional)

First, keep the vault's local-only paths out of git — the Obsidian desktop
app's own per-machine config folder (`$VAULT_DIR/.obsidian/`, created only if
the user actually opens the vault in the real Obsidian app: workspace
layout, plugin cache, local settings — the MCP server itself never creates
it), the hooks' cross-session state/logs under `.claude/hooks/log/` (written
by session-log/compile), and the writers' isolated SDK deps installed below.
Append idempotently (only if the header is not already there):

```bash
if ! grep -qF "# aia-harness — obsidian vault: local, not committed" "$TARGET/.gitignore" 2>/dev/null; then
  printf '\n# aia-harness — obsidian vault: local, not committed\n%s/.obsidian/\n.claude/hooks/log/\n.claude/scripts/node_modules/\n.claude/scripts/package.json\n.claude/scripts/package-lock.json\n' "$VAULT_DIR" >> "$TARGET/.gitignore"
fi
```

Then install the SDK (optional but recommended). The two automatic writers —
`session-log.mjs` (SessionEnd) and `compile.mjs`
(SessionStart) — spawn detached runners under `.claude/scripts/` that
`import { query } from "@anthropic-ai/claude-agent-sdk"`. Node resolves that
bare import by walking up from the runner's **own** directory, so the SDK must
live in a `node_modules` at or above `.claude/scripts/`. Install it **isolated
there**, never at the project root — this keeps a non-Node project (Go, Python,
Rust, …) clean: no root `package.json`, no root `node_modules`, nothing
committed. (`.claude/scripts/node_modules` is the runners' own directory, so
the existing bare import resolves with no code change; a sibling like
`.claude/hooks/node_modules` would NOT be found — Node only searches the
importing file's own dir and its ancestors, never a sibling.)

This step is optional. Without the SDK, only those two writers no-op; the vault
itself and every `mcp__obsidian__*` tool (manual search/read/write) work
regardless — so never block or fail the command on it.

Run it automatically only when `npm` is available (Node is already required for
every hook, and npm ships with standard Node installs):

```bash
if command -v npm >/dev/null 2>&1; then
  npm install --prefix "$TARGET/.claude/scripts" --no-audit --no-fund @anthropic-ai/claude-agent-sdk
fi
```

That writes `$TARGET/.claude/scripts/node_modules/` plus a
`.claude/scripts/package.json` and `.claude/scripts/package-lock.json` — all
already covered by the `.gitignore` block above.

If `npm` is not available, do not fail — note in the summary that the two
automatic writers stay off until the user runs the install line once.

## Step 8: Adapt the persistent-memory sanitation policy (if present)

**Both branches** — idempotent, safe to re-run. This is the last content
change this command makes, once the vault itself is fully installed and
configured; everything before it stands regardless of what this step finds.

Read `$TARGET/.claude/memory/INSTRUCTIONS.md`. This file is part of the base
harness (`/aia-harness:init`), not of this pillar — the user may have
deselected it during init, or deleted it since, and that choice must be
respected here.

- **Does not exist** → skip this step entirely. Do not create it; move
  straight to the summary.
- **Exists** → this project's persistent-memory system now has somewhere to
  send memory that no longer belongs in the always-loaded index: the vault
  just installed, instead of a local `.claude/memory/archive/` folder it
  would otherwise have to invent. Refresh just its "Sanitation" section to
  route there:

  ```bash
  node "${CLAUDE_PLUGIN_ROOT}/bin/harness.mjs" apply "$TARGET" --yes --tools=obsidian-mcp --only=obsidian:memory-instructions --merge --json
  ```

  Merging is what keeps this safe to re-run. `obsidian:memory-instructions`
  carries `mergeStrategy: "merge-section"`: a `## Sanitation` block that already
  exists **and differs** is parked in `conflicts[]` for adjudication instead of
  being replaced in place, discarding whatever the user wrote into it; a missing
  block is still appended mechanically (the normal case). **Adjudicate any
  conflict with `patch.md` section 7**, exactly as Step 5 does.

  **Never add `--force` to this call** — same reasoning as `obsidian:claude-md`
  in Step 5b: the strategy only ever touches the `## Sanitation` block by
  heading match, leaving "When to save", "How to save", "Reading memories" —
  and any project-specific edits already there — untouched. `--force`
  bypasses merge strategies entirely and falls through to a raw overwrite of
  the whole target file; on this id that would reduce the entire
  memory-instructions file down to nothing but the Sanitation section. This
  is also exactly why this step checks the file exists before applying,
  instead of folding this id into one of Step 5's unconditional calls:
  `applyPlan` only runs the merge when the destination is already on disk —
  against a target that doesn't exist yet it falls through to creating one
  from the incoming content as-is, which for this id would mean a new file
  containing nothing but a lone "Sanitation" section with no "When to save" /
  "How to save" context above it.

## Step 9: Summary

Tell the user:

- The vault was created at `<VAULT_DIR>/` with the 5 PARA folders + templates, committed (not gitignored) — except `<VAULT_DIR>/.obsidian/`, the Obsidian desktop app's own local config folder, which is gitignored.
- The `obsidian` MCP server was added to `.mcp.json`.
- **Restart Claude Code now** — the MCP server only loads on a fresh session.
- After restarting, `.claude/rules/obsidian.md` documents how to use the vault; the 6 hooks now keep it oriented and up to date automatically.
- The automatic session-log/compile writers need `@anthropic-ai/claude-agent-sdk`.
  Step 7 installs it **isolated** in `.claude/scripts/node_modules/` (gitignored;
  no root `package.json`/`node_modules`, so a Go/Python/Rust project stays clean).
  If `npm` was unavailable, those two writers stay off until you run once —
  `npm install --prefix .claude/scripts @anthropic-ai/claude-agent-sdk` — but the
  vault itself and all `mcp__obsidian__*` tools (manual search/read/write) work regardless.
- If `.claude/memory/INSTRUCTIONS.md` existed, its Sanitation section now
  migrates stale memory entries into the vault instead of a local archive
  folder (Step 8) — nothing about persistent memory is discarded, only
  relocated. If that file didn't exist, say nothing about it — there was
  nothing to adapt.
