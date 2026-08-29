---
description: Audit an existing Claude Code harness (CLAUDE.md quality, settings safety, hook hygiene) and propose targeted fixes.
argument-hint: "[path]"
allowed-tools:
  - Bash
  - Read
  - Edit
  - AskUserQuestion
---

# Audit the existing harness

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
wrong place. **This is the longest command in the plugin** — the same resolved path must still be
the one reused in every `apply --only=...` call scattered across step 3's sub-checks below, not
just the calls immediately following this paragraph.

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

## 0. Check system dependencies

```bash
node "${CLAUDE_PLUGIN_ROOT}/bin/harness.mjs" check "${1:-$CLAUDE_PROJECT_DIR}" --json
```

If `status === "block"`: present the list of `missing[]` with `installHint`
for the user's platform and stop — do not execute the following steps.

Keep the `ghAuth` object from this payload (present whenever `gh` is found
among the checked dependencies — auto-detected on a GitHub repo, or forced by
`--tools=gh`) — step 3 reports it as a finding.

1. Re-scan to see what exists:

   ```bash
   node "${CLAUDE_PLUGIN_ROOT}/bin/harness.mjs" scan "${1:-$CLAUDE_PROJECT_DIR}" --json
   ```

2. **Completeness — what the current plugin version expects but is missing.**
   The rest of this audit grades *quality*; this step finds *drift*. Get the full
   expected artifact set for the detected stack and this plugin version:

   ```bash
   node "${CLAUDE_PLUGIN_ROOT}/bin/harness.mjs" plan "${1:-$CLAUDE_PROJECT_DIR}" --json
   ```

   Every artifact in the plan carries `exists` (already present in the project)
   and `defaultSelected`. Classify them:
   - **Missing (drift):** `exists:false && defaultSelected:true` — should be here
     by default but isn't. Typically new agents / hooks / skills / rules / commands
     shipped by a newer plugin version (or items skipped at init). Group by
     `category` and list each `title`. **This is the "detect what's missing after a
     plugin upgrade and add it" path.**
   - **Optionally available:** `exists:false && defaultSelected:false` (e.g.
     `.lsp.json`, ag-kit scripts) — mention as optionally available; do **not**
     flag as drift.
   - Caveat: "missing" is relative to the **currently detected stack**. If detection
     changed, the expected set changes — sanity-check surprising entries against the
     scan report before offering them.

   If there are missing default artifacts, use `AskUserQuestion` (multi-select,
   grouped by category) to let the user pick which to add. Add them **additively** —
   pass only the chosen `id`s and **never `--force`**, so `apply` creates only the
   missing targets and leaves everything that already exists untouched:

   ```bash
   node "${CLAUDE_PLUGIN_ROOT}/bin/harness.mjs" apply "${1:-$CLAUDE_PROJECT_DIR}" --yes --only=<chosen ids>
   ```

   Report the engine's `created` list back. If any newly-created file is a
   `claude-md` artifact (e.g. a new nested domain), run the enrichment pass from
   `/aia-harness:init` step 5.5 on just those new files so they don't ship as
   generic stubs. For artifacts that **exist but differ** from the current version
   (a changed `settings.json`, an updated hook), this additive step leaves them
   alone — step 3a below merges those, or point the user to `/aia-harness:patch`
   for the same merge-and-adjudicate flow driven by category.

   Merging is now the default, but it never engages here: every id in `<chosen ids>`
   comes from the `exists:false && defaultSelected:true` bucket above, so the file each
   one targets is always absent — the exists-and-differs branch that `merge` changes
   can never fire. This call only ever creates, exactly as it did before merge became
   the default.

3a. **Outdated artifacts — installed but differing from the current plugin version.**

Step 2 finds *missing* artifacts; this finds *stale* ones (present but out of date,
e.g. agents whose routing descriptions predate the best-practice update). Run a
dry-run apply and read the structured drift list (omitting `--yes` keeps it a dry run — no files are written):

```bash
node "${CLAUDE_PLUGIN_ROOT}/bin/harness.mjs" apply "${1:-$CLAUDE_PROJECT_DIR}" --json
```

Parse `conflicts[]` (each `{ id, relPath, category, pendingPath }`). Merging is the default
apply behaviour, so an artifact that exists and differs is reported there; the legacy
`differs[]` array is still part of the JSON shape but a dry run never fills it. **This first
run is discovery only** — it reports every conflict but writes nothing, so the `pendingPath`s
it hands back do not exist on disk yet. Group by `category`. For each category with entries,
report the count + sample `relPath`s. Of particular note:

- **`agents`** — installed agent files whose descriptions differ. Re-applying gives
  the best-practice, condition-shaped "Use proactively" routing descriptions that the
  native router and the CLAUDE.md table depend on.
- **`claude-md`** — the root `CLAUDE.md` always lands here, because init enrichment
  edits `## Conventions` and `## Architecture map`; so does `.claude/memory/MEMORY.md`,
  which grows with every session. **Offer this category like any other.** The refresh
  below merges by default, and neither of those two files carries a mechanical
  merge strategy, so neither is ever written — each is parked as a conflict and
  adjudicated hunk by hunk, where enrichment and accumulated memory count as user
  content that must survive. (This category used to be excluded here because the
  refresh force-overwrote and destroyed both. It no longer does.) The root file's
  *structural* integrity — missing sections, fixed-rules content — is still audited
  separately in step 3 via the **Root CLAUDE.md section completeness** and **Fixed
  rules intact** checks.

Use `AskUserQuestion` (multi-select, grouped by category) to let the user pick which
categories to refresh. For each chosen category, collect its `conflicts[].id`s and merge
ONLY those:

```bash
node "${CLAUDE_PLUGIN_ROOT}/bin/harness.mjs" apply "${1:-$CLAUDE_PROJECT_DIR}" \
  --yes --merge --only=<comma-joined ids> --json
```

Merging never overwrites a file the user has changed: a missing target is created, a
file with an additive merge strategy (`settings.json`, `.mcp.json`) is merged with the
existing value always winning, and anything else that exists and differs — including a
merged CLAUDE.md section, which replaces the whole section rather than merging
key-by-key — is left exactly as it is: rendered under `.claude/.aia-harness-pending/`
and reported in `conflicts[]` with its exact `pendingPath`. Files outside the selected
ids are untouched.

**Both runs are needed — this second one is not a repeat of the first.** The dry run only
*names* the conflicts, which is what lets the user choose before anything is written; this
run is what actually stages them, writing each `pendingPath` to disk so there is a real file
for the adjudication below to diff against. Neither call can absorb the other: a dry run
stages nothing to adjudicate, and a writing run must not happen before the user has picked
categories.

Note that an artifact carrying a **mechanical** merge strategy (`merge-settings`,
`merge-mcp`, `merge-lines`) never reaches `conflicts[]` at all — it is always merged and
reported as `updated` or `skipped` — so the `settings`, `mcp` and `worktree` **ids** can
never be among the ones collected here, and no `--large-files` mode has to be threaded
through this call. The `settings` wiring is audited by the dedicated checks in step 3
instead. The `settings` *category* can still appear, via `.claude/settings.local.json`
(id `settings-local`), which carries no strategy of its own — offering it is safe for the
same reason, since it is a different artifact from the one that holds the guard wiring.

Report the engine's `created` / `updated` / `skipped` / `errors` lists, then work
through every entry in `conflicts[]` using **`patch.md` section 7 ("Adjudicate each
conflict")** — `Read` `${CLAUDE_PLUGIN_ROOT}/commands/patch.md` and follow that section
as written rather than improvising a diff review here. Its three preconditions are
already satisfied: the merge run above, the `plan --json` from step 2 (whose
`rootClaudeMd` audit is the ownership map it needs for the root `CLAUDE.md`), and the
target path resolved at the top of this command. Once every conflict has an answer,
delete the staging directory as that command's step 8 describes. If `conflicts[]` is
empty, say so and move on.

If the user would rather sweep the whole harness by category than only the stale ids,
point them at `/aia-harness:patch` — it runs this same merge-and-adjudicate flow.

3. Audit each existing artifact and grade it:

- **Root CLAUDE.md section completeness:** read the `rootClaudeMd` object from the
  `plan --json` output already produced in step 2. It lists every section that
  *should* be in this project's root `CLAUDE.md` but is absent (`missing`), plus
  `present` / `notApplicable` (report nothing for those). For each `missing` entry,
  act by its `fix`:
  - **`fix: "force-root"`** — a section the base generator renders into the root
    file is gone. The value names the *remediation unit* — the whole base-generated
    root file, as opposed to one merge-section id or a separate command — not a CLI
    flag; the fix below merges by default and never force-overwrites. This
    covers both the always-required structural sections
    (`required: true`: behavioral, stack, canonical-commands, architecture-map,
    conventions, engineering-rules, memory-imports) and conditional sections
    that *do* apply to this project (`required: false`: skills, workflow-agents,
    agent-routing, parallel-sdd — e.g. agents are installed but the `## Workflow & Agents` /
    superpowers-bridge section is gone). Frame the required ones as structural
    gaps and the conditional ones as "applies here but missing" — either way
    they're fixed the same way. Offer to restore them **once, as a group** (not
    one prompt per section) by merging the regenerated root file:

    ```bash
    node "${CLAUDE_PLUGIN_ROOT}/bin/harness.mjs" apply "${1:-$CLAUDE_PROJECT_DIR}" \
      --yes --merge --only=claude-md-root --json
    ```

    `claude-md-root` carries no mechanical merge strategy, so an existing root file
    is never written by this call — it is rendered under
    `.claude/.aia-harness-pending/` and comes back as a single `conflicts[]`
    entry carrying its own `pendingPath` (it differs by definition; that is why a
    section is missing). Adjudicate it
    with **`patch.md` section 7**, exactly as step 3a does. The missing sections are
    that procedure's "plugin evolution → take" bucket and the enriched
    `## Conventions` / `## Architecture map` are its "user customization → preserve"
    bucket, so the enrichment survives and nothing has to be re-enriched afterwards.
    Only its "take the generated version" answer discards it, and step 7.5 already
    requires warning before that one.
  - **`fix: "merge:claude-md:graphify-root"`** (graphify installed but its
    `## graphify` section is gone) — merge it back in place, **never `--force`**
    (that would overwrite the whole root file with just this section):

    ```bash
    node "${CLAUDE_PLUGIN_ROOT}/bin/harness.mjs" apply "${1:-$CLAUDE_PROJECT_DIR}" \
      --yes --only=claude-md:graphify-root --json
    ```

    Merging is the default, and for a `merge-section` id it splits two ways. A section that
    is **absent** is appended in place, reported in `updated`, siblings untouched — and that
    is the only case this fix ever runs in, because the audit lists `graphify` as missing
    only when neither its heading nor its marker is anywhere in the file. A section that
    **exists and differs** is instead parked in `conflicts[]` rather than replaced, so text
    the user wrote inside it is never silently discarded. That second outcome should
    therefore be unreachable here: if `conflicts[]` comes back non-empty, the audit and the
    file disagree about the section (a heading at the wrong level, say). Adjudicate it with
    **`patch.md` section 7**, exactly as step 3a does — never re-run with `--force`.

  - **`fix: "command:/aia-harness:add-obsidian"`** (obsidian pillar installed but
    its `## obsidian-vault` section is gone) — tell the user to re-run
    `/aia-harness:add-obsidian` (its artifacts aren't in the base plan, so there's
    no `--only` id to apply here).

  Apply any fix only after user approval (diff-then-approve / `AskUserQuestion`),
  consistent with the rest of this audit. This section audits **presence** only;
  baseline-rule *content* integrity is still covered by **Fixed rules intact** below.
- **Unit tests:** report `profile.testing`:
  - If `configured` is `false`: flag the gap and recommend `/setup-testing` (suggested framework: `testing.recommended`).
  - If `configured` is `true`: grep `CLAUDE.md` for `No unit tests yet`. If found, the note is stale — tests are already configured. Offer to replace it with the updated note (same format as `/setup-testing` step 7): `> **Tests:** \`{framework}\` — run \`{test-command}\`. Write unit tests for **every** new function or module added; never declare work complete without passing tests.` Apply with `Edit` after user approval.
- **CLAUDE.md files:** flag any over ~200 lines or full of generic boilerplate
     ("bloated memory gets ignored"). Critical rules should be near the top.
     Suggest moving domain detail into nested CLAUDE.md / `.claude/rules/`.
- **Un-enriched stubs:** grep every `CLAUDE.md` for leftover
     `<!-- AI-ENRICH:` markers and flag them — they mean enrichment was skipped.
     Also flag **nested domain `CLAUDE.md` files that are identical generic stubs**
     (same `## Responsibility` / `## Local conventions` boilerplate across domains);
     suggest running `/aia-harness:revise-claude-md` to generate rich domain files.
     Compare only `## Responsibility` / `## Local conventions` — the
     `aia-harness:fixed` `## Rules` block is identical across domains **by design**,
     so do not treat it as stub duplication.
- **Fixed rules intact:** grep every `CLAUDE.md` for the `aia-harness:fixed`
     marker. The root file must keep its `## Engineering rules` section and each
     domain file its `## Rules` section, both with the full baseline lines
     verbatim — root **presence** (heading/marker entirely gone) is covered by
     *Root CLAUDE.md section completeness* above. This bullet's job on the root
     file is the verbatim-content check instead (a reworded or stripped line
     under an otherwise intact heading isn't caught by presence alone); for
     domain files it still covers both presence and content. If a prior
     enrichment stripped or edited baseline lines (marker missing, or rules
     reworded/removed), flag it as a regression and offer to restore the exact
     baseline from the generator (`ROOT_FIXED_RULES` / `DOMAIN_FIXED_RULES`).
- **settings.json:** permissions should be least-privilege; deny reads of
     `.env`/secrets; `permissions.defaultMode:"bypassPermissions"` is expected,
     nested under `permissions` (the harness sets it intentionally so agentic
     loops don't stall on prompts — do **not** flag `bypassPermissions` itself
     as unsafe). Flag it if found at the top level instead — the real schema
     (json.schemastore.org/claude-code-settings.json) has no top-level
     `defaultMode`, so that placement is a silently-inert generator bug, not a
     valid field; hooks wired correctly.
- **Hooks:** confirm guards use exit code 2 to block, formatters are
     non-blocking, and JS hooks go through the node-resolver wrapper.
- **Large-file guard (mandatory):** confirm `large-file-warning.mjs` is present
     **and wired** in `settings.json` — under `Stop` (block mode: agent refactors
     files over 350 lines before finishing) or `PostToolUse` matcher
     `Edit|Write|MultiEdit` (advisory: suggest + confirm, never auto-block).
     **Record which one you find** (`Stop` → `block`, `PostToolUse` → `advisory`) and
     reuse it for the rest of this audit: `renderSettings` wires the guard under one
     event *or* the other depending on the mode, and `mergeSettingsJson` only ever adds
     what is missing, so any later `apply` whose `--only` set includes the `settings`
     artifact must pass the recorded value as `--large-files=<mode>`. Generate the wrong
     mode and the target ends up wired under both events, firing the guard twice. If it
     is **missing from the wiring** (or `settings.json` predates this guard), it is
     **not configured** — surface it and offer to set it up with `AskUserQuestion`:
     ask `block` vs `advisory` — the answer becomes the recorded mode — recommending the scan's `largeFiles.recommended`
     (`block` for a clean repo, `advisory` when there are pre-existing oversized
     files — `largeFiles.count > 0`). On approval, rewire (merge, settings + the
     hook file only):

     ```bash
     node "${CLAUDE_PLUGIN_ROOT}/bin/harness.mjs" apply "${1:-$CLAUDE_PROJECT_DIR}" \
       --yes --merge --only=settings,hook:large-file-warning.mjs --large-files=<mode> --json
     ```

     `settings.json` merges additively, so this adds the missing wiring for the
     chosen mode and leaves every permission, env key and other pillar's hook the
     project already has untouched — which is the whole point here, since this check
     fires precisely when a `settings.json` that predates the guard is otherwise fine.
     If the hook *file* itself exists and differs it comes back in `conflicts[]`;
     adjudicate it with **`patch.md` section 7** as in step 3a.

- **.mcp.json:** only `${ENV}` placeholders, never literal secrets.
- **.gitignore:** must ignore `.claude/*.local.*`.

- **docs/harness/strategies.md:** If the `strategies` artifact exists, verify it
     was generated for the current detected stack (grep the first 10 lines for the
     project's primary language). If it looks like a placeholder or was generated for
     a different stack, flag it and offer to regenerate with:

     ```bash
     node "${CLAUDE_PLUGIN_ROOT}/bin/harness.mjs" apply "${1:-$CLAUDE_PROJECT_DIR}" \
       --yes --merge --only=strategies --json
     ```

     `strategies` carries no mechanical merge strategy, so the existing file is never
     written by this call: it is rendered under `.claude/.aia-harness-pending/` and
     comes back as a single `conflicts[]` entry carrying its own `pendingPath`. Adjudicate it with **`patch.md` section 7**, exactly as
     step 3a does — section 7.1 shows the real regenerated-versus-current diff, and the
     user chooses between taking it, keeping the current file, or a merge of the two.
     A doc generated for the wrong stack is the clearest possible "plugin evolution →
     take" case, but it is still the user's call, and any note they hand-wrote into the
     file is visible in that diff rather than silently destroyed.

- **.lsp.json:** If the `lsp` artifact exists, confirm it is valid JSON and
     contains language server entries (`languageServerCommand` or similar keys).
     If malformed, flag it. If missing but the plan would generate it
     (`defaultSelected:false` for lsp), note it as optionally available.

- **.worktreeinclude:** If the `worktree` artifact exists, check it contains
     `.claude/settings.json` (the key file to copy into worktrees). If missing from
     a git repo, note it as available via `apply --only=worktree`.

- **Install scripts:** If `scripts/install-plugins.mjs` exists, note it can be run
     with `node scripts/install-plugins.mjs -y` to install suggested plugins.

- **Commands (ag-kit):** If the plan includes `agkit-command:` artifacts (ag-kit workflow
     commands under `.claude/commands/`), verify each command file exists on disk. If any are
     missing, offer to add them:

     ```bash
     node "${CLAUDE_PLUGIN_ROOT}/bin/harness.mjs" apply "${1:-$CLAUDE_PROJECT_DIR}" \
       --yes --only=<agkit-command:ids>
     ```

- **GitHub PM:** If `profile.githubPM.detected`:
  - Check: `.claude/skills/github-pm/SKILL.md` exists
  - Check: `.claude/commands/pm/` directory has 10 command files
  - Check: `.github/ISSUE_TEMPLATE/` has bug.yml, feature.yml, task.yml
  - Check: `.github/workflows/` has issue-to-project.yml, commit-to-progress.yml,
       pr-to-review.yml, auto-close-issue.yml
  - Check: `.claude/pm-config.json` exists (warn if still has REPLACE_ME placeholders)
  - Check: `.claude/skills/github-issues/` exists (vendored)
  - Check: `.claude/skills/github-project/` exists (vendored)

     If any check fails → report as missing with `apply --only=github-pm` as fix suggestion.
     If `profile.githubPM.detected` is false → skip section silently.

- **Obsidian vault:** If `.mcp.json` has a top-level `mcpServers.obsidian` key:
  - Check: the vault folder at `mcpServers.obsidian.env.OBSIDIAN_VAULT_PATH` exists
       with its 5 PARA subfolders (`01-projects/`, `02-areas/`, `03-knowledge/`,
       `04-resources/`, `daily/`) plus `templates/`
  - Check: `.claude/hooks/` has all 6 hooks (`vault-orient.mjs`, `vault-guard.mjs`,
       `compile.mjs`, `session-log.mjs`, `vault-note-merge.mjs`, `vault-pipeline-shared.mjs`)
  - Check: `.claude/scripts/` has both runner scripts (`compile-runner.mjs`,
       `session-log-runner.mjs`)
  - Check: `.claude/rules/obsidian.md` exists
  - Check: `"mcp__obsidian"` is present in `.claude/settings.json`'s `permissions.allow`

     If any check fails → report as missing, with `/aia-harness:add-obsidian`
     (reconfigure) as the fix. `/aia-harness:patch` is not the fix here: it offers its
     `obsidian` category only when **every** `obsidian:` artifact already exists, which
     is by definition not the case when one of these checks fails — and only
     `/aia-harness:add-obsidian` substitutes the real vault folder name into the copied
     files (see `patch.md`).
     If `.mcp.json` has no `mcpServers.obsidian` key → skip section silently.
     (The root `## obsidian-vault` CLAUDE.md section itself is audited by *Root
     CLAUDE.md section completeness* above — this checks the rest of the pillar.)

- **Graphify git hooks:** If the plan includes `graphify-git-hook:` artifacts (check plan JSON for IDs starting with `graphify-git-hook:`), verify that the graphify git hooks are installed in the target project:
  - `.git/hooks/post-commit` contains marker `# graphify-hook-start`
  - `.git/hooks/post-checkout` contains marker `# graphify-checkout-hook-start`

     If either is missing: report as missing and offer to install:

     ```bash
     node "${CLAUDE_PLUGIN_ROOT}/bin/harness.mjs" apply "${1:-$CLAUDE_PROJECT_DIR}" \
       --yes --only=graphify-git-hook:post-commit,graphify-git-hook:post-checkout --json
     ```

     A hook file that is genuinely absent is created. One that already exists with different
     content — another tool's `post-commit`, say — is **not** overwritten: it comes back in
     `conflicts[]` with its own `pendingPath`, so adjudicate that entry with **`patch.md`
     section 7**, exactly as step 3a does. The two hooks do different work, so the merged
     proposal that keeps both is usually the right answer there; it is still the user's call.

     Note: git hooks are local (not tracked in git) — each developer must install them.
     If graphify is not in the plan, skip this check silently.

- **Graphify orientation hook (settings.json):** If the plan includes the
     `settings` artifact AND graphify is in the plan (a `tool-skill:graphify`,
     `graphify-orient-hook`, or `graphify-git-hook:` ID is present), verify the target
     `.claude/settings.json` already wires the PreToolUse orientation hook — grep its
     `hooks.PreToolUse` for the marker string `graphify-orient.mjs`. A project init'd
     before this hook existed will have a `settings.json` (so whole-file drift never flags
     it) that is missing the wiring. If the marker is absent, offer to merge it in
     (non-destructive — the merge adds the hook without touching existing settings):

     ```bash
     node "${CLAUDE_PLUGIN_ROOT}/bin/harness.mjs" apply "${1:-$CLAUDE_PROJECT_DIR}" \
       --yes --only=settings --large-files=<mode>
     ```

     `--large-files=<mode>` is the mode recorded by the **Large-file guard** check above,
     and it is required here even though this call is only about the graphify hook. This
     check fires on a project whose `settings.json` already exists and is otherwise fine,
     so the guard is already wired under one event; `settings.json` merges through its
     `merge-settings` strategy (no `--merge` needed) and that merge is additive-only, so
     generating the other mode would add a *second* wiring rather than replace the first.

     If graphify is not in the plan, skip this check silently.

- **Bash cd-carryover mitigation (settings.json):** grep `.claude/settings.json`'s
     `env` block for `CLAUDE_BASH_MAINTAIN_PROJECT_WORKING_DIR`. A project scaffolded
     before this default existed will have a `settings.json` (so whole-file drift never
     flags it) that is simply missing the key. If absent, explain briefly: without it, the
     Claude Code CLI's Bash tool carries a `cd` across tool calls within the same session,
     and once that happens `$CLAUDE_PROJECT_DIR` resolves wrong for every hook subprocess
     spawned afterward — a documented, unfixed upstream bug (closed not-planned/duplicate
     on GitHub as of v2.1.113+). Note that adding it also resets the Bash tool's cwd to the
     project root after every command instead of letting it persist — any of the project's
     own commands/skills/workflows that rely on a `cd` carrying over between separate Bash
     calls must switch to `cd X && cmd` or `git -C` in one call instead. Offer to merge the
     key in:

     ```bash
     node "${CLAUDE_PLUGIN_ROOT}/bin/harness.mjs" apply "${1:-$CLAUDE_PROJECT_DIR}" \
       --yes --merge --only=settings --large-files=<mode> --json
     ```

     `--large-files=<mode>` is the mode recorded by the **Large-file guard** check above,
     required here for the same reason it is on the graphify hook check just above: this
     call re-applies the whole `settings` artifact, and its `merge-settings` strategy is
     additive-only — generating the other large-file mode would add a second guard wiring
     rather than replace the first. Nothing already present is modified or removed.

     If the key is already present, say nothing.

- **Hook placeholder hygiene (settings.json):** Read `hookHygiene.placeholderIssues`
     from the `scan --json` output (step 1). If empty, say nothing. Otherwise, for each
     entry (`{ event, matcher, script, arg, placeholder }`), explain: exec-form hooks
     (an `args` array) spawn without a shell, so Claude Code only expands the **braced**
     `${placeholder}` form — the bare `$placeholder` currently in `arg` is passed through
     literally and will throw `MODULE_NOT_FOUND`. List every affected `script` with its
     event and the exact `arg` string. Ask the user to approve the fix with
     `AskUserQuestion`, then fix each one with `Edit` directly on `.claude/settings.json`
     — replace `$<placeholder>` with `${<placeholder>}` in that exact `args` string, and
     nothing else on the line. **Do not** fix this with `apply --only=settings`:
     `mergeSettingsJson` dedups hook entries by exact `{command, args}` string identity,
     so re-applying would add a duplicate hook, not repair the broken one — `Edit` is the
     only correct fix here.
- **Stale `javascript.md` rule (TypeScript rename):** Read `staleJavascriptRule` from
     the `scan --json` output (step 1). If `false`, say nothing. Otherwise: an older
     plugin version always named the generated JS/TS rule file
     `.claude/rules/javascript.md`, even for TypeScript projects; it is now
     `.claude/rules/typescript.md` for TypeScript (`lib/generate/rules.mjs`). The
     artifact id is derived from the path, so `apply`/`patch` only ever *add* the new
     file when it's missing (step 2 already offers that, driven by `plan --json`) —
     neither ever notices or removes the old one on its own; there is no general
     rename/orphan-detection mechanism in this pipeline. This project is detected as
     TypeScript and still has the old file: it is stale (JS-flavored guidance, and its
     `**/*.js`/`**/*.jsx`/`**/*.mjs`/`**/*.cjs` glob patterns keep matching real files)
     and would otherwise sit there indefinitely alongside the correct rule. Ask the
     user with `AskUserQuestion` (**Remove the stale file** / **Leave it for now**). On
     approval:

     ```bash
     rm "${1:-$CLAUDE_PROJECT_DIR}/.claude/rules/javascript.md"
     ```

     Not an `apply`/`patch` fix — the engine only ever writes artifacts the current
     plan wants and has no delete path, so removal is a direct `rm` after explicit
     user approval (same precedent as `patch.md` step 8's pending-directory cleanup).
- **gh OAuth scopes:** report the `ghAuth` object retained from step 0. Nothing
  to report when it is absent, or when `missing` is empty, `envTokenOverride`
  is false, and the login is authenticated.
  - `available: false` → finding: "gh was found but could not be executed (a
    corrupt binary, a permission problem, or a non-functional shim). Nothing
    else about its auth state could be determined — `missing` is an artifact
    of that failure, not a finding. Verify the installation by running
    `gh --version` yourself." Report only this finding — never also report
    scopes, and never suggest `gh auth refresh`/`gh auth login`, neither of
    which can fix a binary that will not start.
  - `envTokenOverride: true` → finding: "`GH_TOKEN`/`GITHUB_TOKEN` is set in the
    environment. `gh` prefers it over the keyring login, so its permissions are
    what apply and `gh auth refresh` cannot change them. Fix:
    `unset GH_TOKEN GITHUB_TOKEN`."
  - otherwise `authenticated: false` → finding: "gh is
    installed but not logged in. Fix: `gh auth login -h github.com -s
    <scopes>`" (`<scopes>` = `ghAuth.missing` joined by commas).
  - otherwise `missing` non-empty → finding: "gh is missing OAuth scope(s):
    `<ghAuth.missing joined>`. GitHub commands (issues, PRs, Projects v2) will
    fail until granted. Fix: `<ghAuth.refreshCmd>` — adds scopes without revoking
    existing ones; confirm with `gh auth status`."

  Present these as findings for the user to act on. Never offer to run
  `gh auth login`/`gh auth refresh` yourself (both are interactive browser
  flows), and never suggest a personal access token as an alternative.

4. Present a prioritized findings list. For each accepted fix, show a diff and
   apply with `Edit` only after the user approves. Do not rewrite files wholesale.

Re-run the relevant lint/test command after edits and report the real output.

Finally, invoke the **`claude-automation-recommender`** skill on the project for a
second opinion — let Claude surface further automation gaps beyond this audit.
Present its suggestions and offer to act on the new ones.

**How to invoke:** use the `Skill` tool with `skill: "claude-code-setup:claude-automation-recommender"`.
Do **not** use the `Agent` tool — this is a skill, not an agent type.
Check the available-skills list first: if `claude-code-setup:claude-automation-recommender` is not
listed, the plugin is not installed — note it ships in the `claude-code-setup` plugin
(`claude plugin install claude-code-setup@anthropics/claude-plugins-official`) and skip gracefully.
