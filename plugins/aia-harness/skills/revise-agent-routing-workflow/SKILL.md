---
name: revise-agent-routing-workflow
description: >
  Audit .claude/agents/*.md frontmatter descriptions against the routing-description
  standard (condition-shaped, "Use proactively", 40-600 chars) and sync them with the
  project's CLAUDE.md `## Workflow & Agents` table or free-text mentions. Fixes
  descriptions in place, fixes stale/missing table rows, flags orphaned agents. Works on
  any existing project — not just one scaffolded by aia-harness. Use standalone, or after
  adding/editing agents by hand.
argument-hint: "[path]"
allowed-tools:
  - Bash
  - Read
  - Edit
  - AskUserQuestion
---

# Revise agent routing

Sync `.claude/agents/*.md` frontmatter descriptions with the project's CLAUDE.md routing
mentions. Target directory: `$1` if provided, else `$CLAUDE_PROJECT_DIR`.

<!-- aia-harness:target-dir-resolution -->
Resolve this **once**, at the
start of this skill, into a concrete literal absolute path. `$CLAUDE_PROJECT_DIR` is documented
as available "when hooks are executed" but is not guaranteed inside the general-purpose Bash tool
used to run these instructions — it can silently expand empty there, and the CLI then falls back
to the shell's *current* working directory, which is wrong if the agent has since `cd`'d elsewhere
(e.g. into the scratchpad for intermediate file work). Reuse that one resolved literal path in
every subsequent invocation below — `list`, `table`, and the `grep` call in Phase 2 — never
re-expand a bare `$CLAUDE_PROJECT_DIR` in a later, separately-issued Bash call, since each Bash
tool call is a fresh shell (only cwd persists, not exported variables) and an earlier `cd` silently
redirects any later bare-env-var fallback to the wrong place.

The lib script backing every step below:
`"${CLAUDE_PLUGIN_ROOT}/skills/revise-agent-routing-workflow/lib/revise-agent-routing.mjs"`.
It only reads — every write in this skill goes through `Edit`, shown as a diff, after
explicit approval.

---

## Phase 1 — Audit + fix agent frontmatter

### Step 1: List agents

```bash
node "${CLAUDE_PLUGIN_ROOT}/skills/revise-agent-routing-workflow/lib/revise-agent-routing.mjs" \
  list --root "${1:-$CLAUDE_PROJECT_DIR}"
```

Returns `{ "agents": [{ "file", "name", "description" }], "skipped": [{ "file", "reason" }] }`.

If `agents` is empty: report "No `.claude/agents/*.md` found — nothing to audit" and stop
the whole skill here.

If `skipped` is non-empty: note each skipped file + reason for the final report (Phase 4);
continue with the rest.

### Step 2: Check each agent's description

For each agent in `agents`:

```bash
node "${CLAUDE_PLUGIN_ROOT}/skills/revise-agent-routing-workflow/lib/revise-agent-routing.mjs" \
  check --text "<agent.description>"
```

Returns `{ "ok": boolean, "violations": string[] }`.

### Step 3: Fix failing descriptions

For each agent where `ok` is `false`:

1. `Read` the agent's whole file, frontmatter included — not just the body. Note the
   `description` field's shape: **flat** (`description: <value>` on one line) or
   **folded** (`description: >` followed by 2-space-indented continuation lines). Both
   shapes are valid and in real use — this plugin's own `templates/{ecc,ag-kit,agents}/`
   agent sources fold whenever the description exceeds ~72 characters (via
   `renderFrontmatter` in `lib/util/frontmatter-yaml.mjs`), but a target project's
   hand-written or third-party agents may use either shape regardless of length. Check
   the real file every time; never assume flat.
2. Author a replacement one-line `description` that fixes every reported violation:
   condition-shaped (says WHEN to use it, not just what it does), contains "Use
   proactively" plus an explicit when/after/before trigger, one logical line (no `|`, no
   newline), 40-600 characters.
3. Show a diff old vs. new, scoped to whichever shape Step 1 found:
   - Flat:
     ```diff
     - description: <old value>
     + description: <new value>
     ```
   - Folded — the "old" side is the **entire** `description: >` block, from that heading
     line through its last indented continuation line, not just its first line:
     ```diff
     - description: >
     -   <old value, wrapped across its original continuation lines>
     + description: >
     +   <new value, re-wrapped>
     ```
     (If the new value happens to fit under ~72 chars, the "new" side can collapse to a
     flat `description: <new value>` line instead.)
4. Ask for confirmation (`AskUserQuestion`, one per agent, or batched if there are many).
5. On approval, `Edit` the agent's frontmatter. For a folded description, the `old_string`
   passed to `Edit` must span the whole `description: >` block — matching only its first
   line will not find a unique match and the edit will fail.

### Step 4: Track final descriptions

Keep an in-memory map `agentName -> finalDescription` for every agent (the fixed value if
Step 3 ran, otherwise the original value from Step 1). Phase 2 uses this map — do not
re-run `list`.

---

## Phase 2 — Map CLAUDE.md coverage

### Step 1: Parse the root table

```bash
node "${CLAUDE_PLUGIN_ROOT}/skills/revise-agent-routing-workflow/lib/revise-agent-routing.mjs" \
  table --root "${1:-$CLAUDE_PROJECT_DIR}"
```

Returns `{ "fileExists": boolean, "sectionExists": boolean, "rows": [{ "name", "whenToUse", "line" }] }`.

Run this **once** for the whole project, not per agent.

### Step 2: Classify each agent

For every agent in the Phase 1 map, using `table`'s `rows`:

- **Row found** (`rows` has an entry with matching `name`): compare `row.whenToUse` against
  the agent's final description using **exact string match** (trim both, collapse
  whitespace runs to a single space before comparing — do not paraphrase or eyeball
  similarity).
  - Equal → verdict `ok`.
  - Different → verdict `stale-description`.
- **No row found**: run the textual fallback —

  ```bash
  node "${CLAUDE_PLUGIN_ROOT}/skills/revise-agent-routing-workflow/lib/revise-agent-routing.mjs" \
    grep --root "${1:-$CLAUDE_PROJECT_DIR}" --name "<agent.name>"
  ```

  Returns `{ "matches": [{ "file", "line", "text" }] }`.
  - `matches` empty → verdict `orphan`.
  - `matches` non-empty → read each `text` snippet. If **any** match reads as an actual
    explanation of the agent's purpose (a nearby clause describing when/why to use it, not
    just the bare name in a list or an unrelated sentence), treat it as already adequately
    documented → verdict `ok` (nothing to fix — this is a deliberate judgment call, not a
    regex; it's the accepted trade-off of the textual-fallback path). Otherwise → verdict
    `name-only`.

### Step 3: Present the findings table

Before any write in Phase 3, show the complete table:

```text
Agent            Found in                     Verdict
`db-migrator`    CLAUDE.md:47 (table)         stale-description
`api-tester`     CLAUDE.md:112 (prose)        name-only
`legacy-runner`  —                            orphan
`code-reviewer`  CLAUDE.md:44 (table)         ok
```

Agents with verdict `ok` need no further action — keep them in the report for
completeness but skip them in Phase 3.

---

## Phase 3 — Apply, one finding at a time

Process findings in the order shown, each with its own diff and explicit consent
(`AskUserQuestion` or a direct yes/no per finding — never batch-apply without showing
each diff).

### `stale-description`

Regenerate just that row using the exact shape `agentsWorkflowBlock()` produces
(`lib/generate/claude-md.mjs`): agent name in backticks, then its when-to-use text,
pipe-delimited. `Edit` **only** that one line (`table`'s `row.line` tells you which line
to anchor on) — never touch any other row.

### `name-only`

Propose the smallest possible edit that adds an explanatory clause next to the existing
mention (e.g. turn "see `api-tester`" into "see `api-tester` — runs integration tests
after API changes"). Never rewrite the surrounding paragraph or regenerate the file.

### `orphan`

Ask (`AskUserQuestion`): "Add `<name>` to the CLAUDE.md routing table?"

- If **declined**: leave it reported only, move to the next finding.
- If **approved**:
  - `table`'s `sectionExists: true` (root CLAUDE.md has the section, just missing this
    row) → `Edit` a new row into the existing table, right after the last existing row.
  - `table`'s `sectionExists: false` but `fileExists: true` (root CLAUDE.md exists, no
    `## Workflow & Agents` section yet) → `Edit` a new section onto the end of the file,
    using this exact shape:

    ```markdown
    ## Workflow & Agents

    For every non-trivial implementation: invoke `superpowers:subagent-driven-development`.
    When dispatching subagents, you MUST use the matching specialist agent from the table below — never the generic agent when a specialist is listed. Cross-reference the task type with the "When to use" column and pass the exact name as `subagent_type`.

    | Agent | When to use |
    |---|---|
    | `<name>` | <finalDescription> |
    ```

    Do **not** add the "Superpowers → Project Specialists" bridge sub-block — it requires
    role classification (`routingRole()` in `lib/generate/claude-md.mjs`) aia-harness only
    knows for its own catalogued agent names. A foreign/hand-written agent has no role to
    classify, so never synthesize that sub-block here, structured-table or freshly-created.
  - `table`'s `fileExists: false` (no root CLAUDE.md at all) → cannot `Edit` a
    non-existent file. Report this specific agent as "orphan — no root CLAUDE.md to add
    it to" and move on; do not create a CLAUDE.md from scratch (out of scope for this
    skill).

---

## Phase 4 — Report

```text
Agents audited: N
Descriptions fixed: M
CLAUDE.md rows fixed: K
Orphans found: J (added: A, left as-is: J-A)
Skipped (unparsable frontmatter): S
```

List every skipped file with its reason (from Phase 1 Step 1's `skipped` array).
