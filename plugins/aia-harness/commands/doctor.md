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

## 0. Check system dependencies

```bash
node "${CLAUDE_PLUGIN_ROOT}/bin/harness.mjs" check "${1:-$CLAUDE_PROJECT_DIR}" --json
```

If `status === "block"`: present the list of `missing[]` with `installHint`
for the user's platform and stop — do not execute the following steps.

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
   alone — point the user to `/aia-harness:patch` to force-overwrite those by
   category.

3a. **Outdated artifacts — installed but differing from the current plugin version.**
    Step 2 finds *missing* artifacts; this finds *stale* ones (present but out of date,
    e.g. agents whose routing descriptions predate the best-practice update). Run a
    dry-run apply and read the structured drift list (omitting `--yes` keeps it a dry run — no files are written):

    ```bash
    node "${CLAUDE_PLUGIN_ROOT}/bin/harness.mjs" apply "${1:-$CLAUDE_PROJECT_DIR}" --json
    ```

    Parse `differs[]` (each `{ id, relPath, category }`). Group by `category`. For each
    category with entries, report the count + sample `relPath`s. Of particular note:
    - **`agents`** — installed agent files whose descriptions differ. Re-applying gives
      the best-practice, condition-shaped "Use proactively" routing descriptions that the
      native router and the CLAUDE.md table depend on.

    **IMPORTANT — exclude `claude-md` from the multi-select offered here.** The root
    `CLAUDE.md` always appears in `differs[]` as category `claude-md` because init
    enrichment edits `## Conventions` and `## Architecture map` — whole-file force-overwrite
    would silently destroy that enrichment. The root file's structural integrity
    (superpowers bridge, behavioral guidelines, fixed rules) is audited separately in step 3
    via the `aia-harness:agent-routing`, `aia-harness:behavioral`, and `aia-harness:fixed`
    markers — not by brute force-overwrite here.

    Use `AskUserQuestion` (multi-select, grouped by category, **omitting `claude-md`**) to
    let the user pick which categories to refresh. For each chosen category, collect its
    `differs[].id`s and force-overwrite ONLY those:

    ```bash
    node "${CLAUDE_PLUGIN_ROOT}/bin/harness.mjs" apply "${1:-$CLAUDE_PROJECT_DIR}" \
      --yes --force --only=<comma-joined ids>
    ```

    `--force` is required (these files exist and differ). Files outside the selected ids
    are untouched. If the user prefers, point them at `/aia-harness:patch` for the same
    by-category force-overwrite.

3. Audit each existing artifact and grade it:
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
     domain file its `## Rules` section, both with the full baseline lines verbatim.
     If a prior enrichment stripped or edited them (marker missing, or rules
     reworded/removed), flag it as a regression and offer to restore the exact
     baseline from the generator (`ROOT_FIXED_RULES` / `DOMAIN_FIXED_RULES`).
   - **Behavioral guidelines intact:** grep the root `CLAUDE.md` for the
     `aia-harness:behavioral` marker. This block (`## Behavioral guidelines`) is
     non-negotiable and must survive enrichment. If missing (enrichment stripped it
     or the project predates this block), flag it as a regression and offer to
     restore it by force-regenerating the root file:

     ```bash
     node "${CLAUDE_PLUGIN_ROOT}/bin/harness.mjs" apply "${1:-$CLAUDE_PROJECT_DIR}" \
       --yes --force --only=claude-md-root
     ```

     Warn the user that `--force` will overwrite the root `CLAUDE.md` — their
     enriched `## Conventions` and `## Architecture map` sections will need to be
     re-enriched (run the enrichment pass from `/aia-harness:init` step 5.5 after).
   - **Superpowers agent-routing bridge (when agents are installed):** if the plan
     includes any `agents` artifact, grep the root `CLAUDE.md` for the marker
     `aia-harness:agent-routing`. If absent, the file predates the superpowers→specialist
     bridge (the section that tells Claude to dispatch project specialists instead of
     `general-purpose`). Offer to regenerate the root file:

     ```bash
     node "${CLAUDE_PLUGIN_ROOT}/bin/harness.mjs" apply "${1:-$CLAUDE_PROJECT_DIR}" \
       --yes --force --only=claude-md-root
     ```

     Warn (as with the behavioral block) that `--force` overwrites the root `CLAUDE.md`,
     so the enriched `## Conventions` / `## Architecture map` must be re-enriched after
     (run the enrichment pass from `/aia-harness:init` step 5.5). If the marker is present,
     the bridge is current — say nothing.
   - **settings.json:** permissions should be least-privilege; deny reads of
     `.env`/secrets; `defaultMode:"bypassPermissions"` is expected at the top level
     (the harness generates it intentionally so project settings never shadow the flag
     out of a global `permissions` object — do **not** flag it); hooks wired correctly.
   - **Hooks:** confirm guards use exit code 2 to block, formatters are
     non-blocking, and JS hooks go through the node-resolver wrapper.
   - **Large-file guard (mandatory):** confirm `large-file-warning.mjs` is present
     **and wired** in `settings.json` — under `Stop` (block mode: agent refactors
     files over 350 lines before finishing) or `PostToolUse` matcher
     `Edit|Write|MultiEdit` (advisory: suggest + confirm, never auto-block). If it
     is **missing from the wiring** (or `settings.json` predates this guard), it is
     **not configured** — surface it and offer to set it up with `AskUserQuestion`:
     ask `block` vs `advisory`, recommending the scan's `largeFiles.recommended`
     (`block` for a clean repo, `advisory` when there are pre-existing oversized
     files — `largeFiles.count > 0`). On approval, rewire (force, settings + the
     hook file only):

     ```bash
     node "${CLAUDE_PLUGIN_ROOT}/bin/harness.mjs" apply "${1:-$CLAUDE_PROJECT_DIR}" \
       --yes --force --only=settings,hook:large-file-warning.mjs --large-files=<mode>
     ```

   - **.mcp.json:** only `${ENV}` placeholders, never literal secrets.
   - **.gitignore:** must ignore `.claude/*.local.*`.

   - **docs/harness/strategies.md:** If the `strategies` artifact exists, verify it
     was generated for the current detected stack (grep the first 10 lines for the
     project's primary language). If it looks like a placeholder or was generated for
     a different stack, flag it and offer to regenerate with:
     ```bash
     node "${CLAUDE_PLUGIN_ROOT}/bin/harness.mjs" apply "${1:-$CLAUDE_PROJECT_DIR}" \
       --yes --force --only=strategies
     ```

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

   - **Graphify git hooks:** If the plan includes `graphify-git-hook:` artifacts (check plan JSON for IDs starting with `graphify-git-hook:`), verify that the graphify git hooks are installed in the target project:
     - `.git/hooks/post-commit` contains marker `# graphify-hook-start`
     - `.git/hooks/post-checkout` contains marker `# graphify-checkout-hook-start`

     If either is missing: report as missing and offer to install:

     ```bash
     node "${CLAUDE_PLUGIN_ROOT}/bin/harness.mjs" apply "${1:-$CLAUDE_PROJECT_DIR}" \
       --yes --only=graphify-git-hook:post-commit,graphify-git-hook:post-checkout
     ```

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
       --yes --only=settings
     ```

     If graphify is not in the plan, skip this check silently.

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
     `mergeSettingsHooks` dedups hook entries by exact `{command, args}` string identity,
     so re-applying would add a duplicate hook, not repair the broken one — `Edit` is the
     only correct fix here.

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
