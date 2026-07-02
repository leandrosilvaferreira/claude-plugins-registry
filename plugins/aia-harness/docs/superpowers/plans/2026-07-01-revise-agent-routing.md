# Revise Agent Routing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship `/aia-harness:revise-agent-routing [path]` — a command+skill pair that audits `.claude/agents/*.md` frontmatter descriptions on an existing target project against the routing-description standard, and syncs the project's own CLAUDE.md routing mentions to match.

**Architecture:** A read-only `.mjs` lib script (`skills/revise-agent-routing/lib/revise-agent-routing.mjs`) exposes 4 subcommands (`list`, `check`, `table`, `grep`) that reuse the aia-harness engine's own pure helpers via dynamic import (same pattern `condense.mjs` already uses for `lib/validate/frontmatter.mjs`). A skill (`skills/revise-agent-routing/SKILL.md`) drives the 4-phase workflow (audit frontmatter → map CLAUDE.md coverage → apply fixes with consent → report) using those subcommands plus `Read`/`Edit`/`AskUserQuestion`. A thin command (`commands/revise-agent-routing.md`) resolves the target directory and hands off to the skill — mirroring `commands/condense-harness-prompts.md`'s split.

**Tech Stack:** Node ≥18, pure ESM `.mjs`, JSDoc types checked by `tsc --checkJs --strict` (`tsconfig.json` includes `**/*.mjs`, no exclusion for `skills/`), ESLint flat config (no exclusion for `skills/` either).

## Global Constraints

- All source in English (code, comments, identifiers, strings) — per `CLAUDE.md`.
- No TypeScript files; JSDoc + `.mjs` only.
- Every script is `.mjs` run via `node`, no shell/`.sh`/`.py` — per `.claude/rules/scripts-cross-platform.md`.
- The lib script never writes a file — every mutation happens via the `Edit` tool inside the skill, after an explicit diff + consent (`doctor`/`patch`/`condense-harness-prompts` precedent).
- Reuse the engine's existing pure helpers via dynamic import rather than duplicating logic: `splitFrontmatter` (`lib/ecc/transform.mjs`), `parseFrontmatter` (`lib/util/frontmatter-yaml.mjs`), `checkAgentDescription` (`lib/validate/agent-description.mjs`), `collectFiles` (`lib/util/fs.mjs`).
- No `tests/*.test.mjs` precedent exists for `skills/*/lib/*.mjs` scripts (`condense.mjs` has none) — verification is a manual smoke test against a scratch fixture (Task 3), not a new permanent test file.
- Design spec: `docs/superpowers/specs/2026-07-01-revise-agent-routing-design.md` (commits `ab6f570`, `75d085d`) — read it for the full rationale behind every decision below.

---

### Task 1: Lib script — `list` + `check` subcommands

**Files:**
- Create: `skills/revise-agent-routing/lib/revise-agent-routing.mjs`
- Test: none (no `tests/*.test.mjs` precedent for this tier of script — smoke-checked manually in this task's own steps, more thoroughly in Task 3).

**Interfaces:**
- Produces:
  - `flag(args: string[], name: string): string | null` — reads a `--flag value` pair out of argv.
  - `fail(msg: string): never` — writes to stderr, `process.exit(1)`.
  - `PLUGIN_ROOT: string` — module-level const, absolute path to the repo root, computed from `import.meta.url`.
  - `cmdList(args: string[]): Promise<void>` — subcommand `list`. Writes one JSON line to stdout: `{ agents: {file: string, name: string, description: string}[], skipped: {file: string, reason: string}[] }`.
  - `cmdCheck(args: string[]): Promise<void>` — subcommand `check`. Writes one JSON line to stdout: `{ ok: boolean, violations: string[] }` (exact shape of `checkAgentDescription`'s return value).
  - A dispatcher recognizing `list` and `check` (extended in Task 2 to also handle `table`/`grep`).
- Consumes (dynamic imports, all pre-existing and unchanged by this plan):
  - `splitFrontmatter(content: string): { frontmatter: string, body: string }` from `lib/ecc/transform.mjs` — `frontmatter` includes both `---` fences.
  - `parseFrontmatter(frontmatter: string): { key: string, value: string }[]` from `lib/util/frontmatter-yaml.mjs` — accepts a block that includes the fences (it skips `---` lines internally).
  - `checkAgentDescription(value: string): { ok: boolean, violations: string[] }` from `lib/validate/agent-description.mjs`.

- [ ] **Step 1: Write the lib script with `list` and `check`**

Create `skills/revise-agent-routing/lib/revise-agent-routing.mjs`:

```js
#!/usr/bin/env node
// revise-agent-routing.mjs — deterministic layer for the revise-agent-routing skill.
//
// Subcommands:
//   list   → enumerate .claude/agents/*.md, parse frontmatter (name, description).
//   check  → validate one description string against the routing-description standard.
//   table  → parse the root CLAUDE.md's "## Workflow & Agents" table into rows.
//   grep   → find literal mentions of an agent name across every CLAUDE.md in the project.
//
// Read-only. Never writes a file — the calling skill shows diffs and edits after consent.
// Reuses the aia-harness engine's own pure helpers via dynamic import (same precedent as
// condense.mjs's `frontmatter` subcommand, which imports lib/validate/frontmatter.mjs the
// same way) instead of duplicating their logic.

import { readFileSync, existsSync, readdirSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

// skills/revise-agent-routing/lib/ → 3 levels up → plugin root → lib/... . Same depth and
// same computation as condense.mjs's cmdFrontmatter.
const PLUGIN_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");

/** @param {string[]} args @param {string} name @returns {string | null} */
function flag(args, name) {
  const i = args.indexOf(name);
  return i >= 0 && i + 1 < args.length ? args[i + 1] : null;
}

/** @param {string} msg @returns {never} */
function fail(msg) {
  process.stderr.write(`${msg}\n`);
  process.exit(1);
}

// ---------- list ----------

/** @param {string[]} args */
async function cmdList(args) {
  const root = flag(args, "--root") || process.cwd();
  const dir = join(root, ".claude", "agents");
  const { splitFrontmatter } = await import(join(PLUGIN_ROOT, "lib/ecc/transform.mjs"));
  const { parseFrontmatter } = await import(join(PLUGIN_ROOT, "lib/util/frontmatter-yaml.mjs"));

  /** @type {{ file: string, name: string, description: string }[]} */
  const agents = [];
  /** @type {{ file: string, reason: string }[]} */
  const skipped = [];

  const files = existsSync(dir)
    ? readdirSync(dir, { withFileTypes: true })
        .filter((d) => d.isFile() && d.name.endsWith(".md"))
        .map((d) => join(dir, d.name))
        .sort()
    : [];

  for (const file of files) {
    const content = readFileSync(file, "utf8");
    const { frontmatter } = splitFrontmatter(content);
    if (!frontmatter) {
      skipped.push({ file, reason: "no frontmatter block" });
      continue;
    }
    const entries = parseFrontmatter(frontmatter);
    const name = entries.find((e) => e.key === "name")?.value;
    const description = entries.find((e) => e.key === "description")?.value;
    if (!name) {
      skipped.push({ file, reason: "missing name field" });
      continue;
    }
    if (!description) {
      skipped.push({ file, reason: "missing description field" });
      continue;
    }
    agents.push({ file, name, description });
  }

  process.stdout.write(JSON.stringify({ agents, skipped }));
}

// ---------- check ----------

/** @param {string[]} args */
async function cmdCheck(args) {
  const text = flag(args, "--text");
  if (text === null) fail('check: pass --text "<value>"');
  const { checkAgentDescription } = await import(
    join(PLUGIN_ROOT, "lib/validate/agent-description.mjs")
  );
  process.stdout.write(JSON.stringify(checkAgentDescription(text)));
}

// ---------- main ----------

const [, , cmd, ...rest] = process.argv;
if (cmd === "list") cmdList(rest).catch((e) => fail(e.message));
else if (cmd === "check") cmdCheck(rest).catch((e) => fail(e.message));
else fail("usage: revise-agent-routing.mjs <list|check|table|grep> [...args]");
```

- [ ] **Step 2: Smoke-check `list` against this repo's own dogfooded agents**

This repo's own `.claude/agents/` has 4 real files — use them as a zero-setup sanity
check (read-only, nothing is written).

Run:
```bash
node skills/revise-agent-routing/lib/revise-agent-routing.mjs list --root .
```

Expected: one JSON line, `agents` has exactly 4 entries (`aia-harness-code-reviewer`,
`engine-test-writer`, `sync-validator`, `vendor-provenance-auditor`), `skipped` is `[]`.

- [ ] **Step 3: Smoke-check `check` with a passing and a failing description**

Run:
```bash
node skills/revise-agent-routing/lib/revise-agent-routing.mjs check --text "Reviews code for quality and security. Use proactively after any source file edit."
```
Expected: `{"ok":true,"violations":[]}`

Run:
```bash
node skills/revise-agent-routing/lib/revise-agent-routing.mjs check --text "Reviews code."
```
Expected: `{"ok":false,"violations":["too short (<40 chars) — describe when to use it","missing a trigger signal — add \"Use proactively\" + when/after/before conditions"]}`

If either output doesn't match, fix the script before proceeding — do not move on with a
failing smoke check.

- [ ] **Step 4: Lint + typecheck**

```bash
npm run lint
npm run typecheck
```

Both are whole-repo commands (`eslint .` / `tsc`, per `package.json`) — there is no
narrower single-file equivalent for the typecheck. Both must exit 0. Fix any reported
issue (e.g. missing JSDoc annotations) before committing — `tsconfig.json` includes
`**/*.mjs` with `strict: true` and does not exclude `skills/`.

- [ ] **Step 5: Commit**

```bash
git add skills/revise-agent-routing/lib/revise-agent-routing.mjs
git commit -m "$(cat <<'EOF'
feat(revise-agent-routing): add list + check subcommands

Enumerates .claude/agents/*.md frontmatter and validates a description
against the routing-description standard, reusing splitFrontmatter,
parseFrontmatter, and checkAgentDescription from the engine lib via
dynamic import (same pattern condense.mjs already uses).

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: Lib script — `table` + `grep` subcommands

**Files:**
- Modify: `skills/revise-agent-routing/lib/revise-agent-routing.mjs` (append new subcommands, extend the dispatcher)
- Test: none (same rationale as Task 1; covered by Task 3's integration smoke test).

**Interfaces:**
- Consumes (from Task 1, same file): `flag`, `fail`, `PLUGIN_ROOT`.
- Produces:
  - `escapeRegExp(s: string): string`.
  - `TABLE_HEADING: string` = `"## Workflow & Agents"`, `ROW_RE: RegExp` matching `` | `name` | whenToUse | ``.
  - `parseAgentTable(text: string): { sectionExists: boolean, rows: { name: string, whenToUse: string, line: number }[] }` — pure, no IO.
  - `cmdTable(args: string[]): void` — subcommand `table` (sync, no dynamic import needed). Writes one JSON line: `{ fileExists: boolean, sectionExists: boolean, rows: {name, whenToUse, line}[] }`.
  - `cmdGrep(args: string[]): Promise<void>` — subcommand `grep`. Writes one JSON line: `{ matches: { file: string, line: number, text: string }[] }`.
  - The finished dispatcher recognizing all 4 subcommands.
- Consumes (dynamic import): `collectFiles(root: string, opts: { maxFiles?: number, maxDepth?: number }): { files: {rel: string, ext: string, base: string, size: number}[], dirs: Set<string>, truncated: boolean }` from `lib/util/fs.mjs` — already applies `IGNORE_DIRS` (node_modules, .git, vendor, dist, build, coverage, .next, .nuxt, target, …) to every recursive walk.

- [ ] **Step 1: Append `table` and `grep` to the lib script**

Edit `skills/revise-agent-routing/lib/revise-agent-routing.mjs` — insert the following
between the `check` section and the `main` section (replace the `// ---------- main ----------`
block entirely, since the dispatcher changes too):

```js
// ---------- table ----------

const TABLE_HEADING = "## Workflow & Agents";
// `| \`name\` | whenToUse |` — same row shape agentsWorkflowBlock() renders
// (lib/generate/claude-md.mjs).
const ROW_RE = /^\|\s*`([^`]+)`\s*\|\s*(.*?)\s*\|$/;

/**
 * @param {string} text
 * @returns {{ sectionExists: boolean, rows: { name: string, whenToUse: string, line: number }[] }}
 */
function parseAgentTable(text) {
  const lines = text.split("\n");
  const headingIdx = lines.findIndex((l) => l.trim() === TABLE_HEADING);
  if (headingIdx === -1) return { sectionExists: false, rows: [] };

  let i = headingIdx + 1;
  while (i < lines.length && lines[i].trim() !== "| Agent | When to use |") {
    if (/^#{1,6}\s/.test(lines[i])) return { sectionExists: true, rows: [] };
    i++;
  }
  if (i >= lines.length) return { sectionExists: true, rows: [] };
  i += 2; // skip the header row + the |---|---| separator row

  /** @type {{ name: string, whenToUse: string, line: number }[]} */
  const rows = [];
  while (i < lines.length) {
    const m = lines[i].match(ROW_RE);
    if (!m) break;
    rows.push({ name: m[1], whenToUse: m[2], line: i + 1 });
    i++;
  }
  return { sectionExists: true, rows };
}

/** @param {string[]} args */
function cmdTable(args) {
  const root = flag(args, "--root") || process.cwd();
  const file = join(root, "CLAUDE.md");
  if (!existsSync(file)) {
    process.stdout.write(JSON.stringify({ fileExists: false, sectionExists: false, rows: [] }));
    return;
  }
  const { sectionExists, rows } = parseAgentTable(readFileSync(file, "utf8"));
  process.stdout.write(JSON.stringify({ fileExists: true, sectionExists, rows }));
}

// ---------- grep ----------

/** @param {string} s @returns {string} */
function escapeRegExp(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** @param {string[]} args */
async function cmdGrep(args) {
  const root = flag(args, "--root") || process.cwd();
  const name = flag(args, "--name");
  if (!name) fail("grep: pass --name <agent-name>");
  const { collectFiles } = await import(join(PLUGIN_ROOT, "lib/util/fs.mjs"));

  const { files } = collectFiles(root, {});
  const claudeMdFiles = files.filter((f) => f.base === "CLAUDE.md");
  const nameRe = new RegExp(`(?<![\\w-])${escapeRegExp(name)}(?![\\w-])`);

  /** @type {{ file: string, line: number, text: string }[]} */
  const matches = [];
  for (const f of claudeMdFiles) {
    const abs = join(root, f.rel);
    const lines = readFileSync(abs, "utf8").split("\n");
    lines.forEach((line, idx) => {
      if (nameRe.test(line)) matches.push({ file: f.rel, line: idx + 1, text: line.trim() });
    });
  }
  process.stdout.write(JSON.stringify({ matches }));
}

// ---------- main ----------

const [, , cmd, ...rest] = process.argv;
if (cmd === "list") cmdList(rest).catch((e) => fail(e.message));
else if (cmd === "check") cmdCheck(rest).catch((e) => fail(e.message));
else if (cmd === "table") cmdTable(rest);
else if (cmd === "grep") cmdGrep(rest).catch((e) => fail(e.message));
else fail("usage: revise-agent-routing.mjs <list|check|table|grep> [...args]");
```

- [ ] **Step 2: Smoke-check `table` against this repo's own root CLAUDE.md**

This repo's root `CLAUDE.md` is hand-written (not `apply`-generated), so it has no
`## Workflow & Agents` section — a real example of the `sectionExists: false` branch.

Run:
```bash
node skills/revise-agent-routing/lib/revise-agent-routing.mjs table --root .
```

Expected: `{"fileExists":true,"sectionExists":false,"rows":[]}`

- [ ] **Step 3: Smoke-check `grep`**

Run:
```bash
node skills/revise-agent-routing/lib/revise-agent-routing.mjs grep --root . --name doctor
```

Expected: `matches` is a non-empty array (`doctor` is mentioned throughout this repo's own
`CLAUDE.md`); each entry has `file`, `line`, `text`.

Run with a name that does not exist anywhere:
```bash
node skills/revise-agent-routing/lib/revise-agent-routing.mjs grep --root . --name zzz-does-not-exist-zzz
```

Expected: `{"matches":[]}`

If any output doesn't match, fix the script before proceeding.

- [ ] **Step 4: Lint + typecheck**

```bash
npx eslint skills/revise-agent-routing/lib/revise-agent-routing.mjs
npx tsc --noEmit -p tsconfig.json
```

Both must exit 0.

- [ ] **Step 5: Commit**

```bash
git add skills/revise-agent-routing/lib/revise-agent-routing.mjs
git commit -m "$(cat <<'EOF'
feat(revise-agent-routing): add table + grep subcommands

Parses the root CLAUDE.md's "## Workflow & Agents" table (same row
shape agentsWorkflowBlock() renders) and walks every CLAUDE.md in the
project for literal agent-name mentions outside the table, reusing
collectFiles (and its IGNORE_DIRS excludes) from the engine lib.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: Integration smoke test (all 4 verdicts) + final lib gate

**Files:**
- None created in the repo (fixture lives under the session scratchpad, not committed).
- Modify (only if Steps 2–5 surface a bug): `skills/revise-agent-routing/lib/revise-agent-routing.mjs`.

**Interfaces:**
- Consumes: the finished 4-subcommand CLI contract from Tasks 1–2, exactly as documented in
  their Interfaces sections. This task's job is to prove that contract is correct end-to-end
  before Task 4 locks it into the skill's prose instructions.

- [ ] **Step 1: Build a synthetic fixture covering all 4 verdicts**

Use the scratchpad directory (replace `$SCRATCH` with the session's actual scratchpad path).

Create `$SCRATCH/fixture/.claude/agents/good-agent.md`:
```markdown
---
name: good-agent
description: Reviews code for quality and security. Use proactively after any source file edit.
---

Body text, not relevant to this fixture.
```

Create `$SCRATCH/fixture/.claude/agents/bad-agent.md`:
```markdown
---
name: bad-agent
description: Handles migrations.
---

Body text, not relevant to this fixture.
```

Create `$SCRATCH/fixture/.claude/agents/prose-agent.md`:
```markdown
---
name: prose-agent
description: Runs integration tests after API changes. Use proactively before merging API PRs.
---

Body text, not relevant to this fixture.
```

Create `$SCRATCH/fixture/.claude/agents/orphan-agent.md`:
```markdown
---
name: orphan-agent
description: Deploys the legacy batch pipeline. Use proactively when touching batch/ files.
---

Body text, not relevant to this fixture.
```

Create `$SCRATCH/fixture/CLAUDE.md`:
```markdown
# Fixture project

## Workflow & Agents

For every non-trivial implementation: invoke `superpowers:subagent-driven-development`.

| Agent | When to use |
|---|---|
| `good-agent` | Reviews code for quality and security. Use proactively after any source file edit. |
| `bad-agent` | This text is intentionally stale and does not match the frontmatter. |

## Notes

Ask `prose-agent` if you need help with API test coverage.
```

- [ ] **Step 2: Run `list` + `check` against the fixture**

```bash
node skills/revise-agent-routing/lib/revise-agent-routing.mjs list --root "$SCRATCH/fixture"
```

Expected: `agents` has exactly 4 entries (`good-agent`, `bad-agent`, `prose-agent`,
`orphan-agent`), `skipped` is `[]`.

```bash
node skills/revise-agent-routing/lib/revise-agent-routing.mjs check --text "Handles migrations."
```

Expected: `ok:false` (too short, no trigger signal) — confirms `bad-agent` would be flagged
in Phase 1.

- [ ] **Step 3: Run `table` against the fixture**

```bash
node skills/revise-agent-routing/lib/revise-agent-routing.mjs table --root "$SCRATCH/fixture"
```

Expected: `fileExists:true`, `sectionExists:true`, `rows` has 2 entries:
- `good-agent` with `whenToUse` exactly equal to its frontmatter description (verdict would be `ok`).
- `bad-agent` with `whenToUse` = `"This text is intentionally stale and does not match the frontmatter."` — different from its frontmatter description (verdict would be `stale-description`).

- [ ] **Step 4: Run `grep` for the two agents with no table row**

```bash
node skills/revise-agent-routing/lib/revise-agent-routing.mjs grep --root "$SCRATCH/fixture" --name prose-agent
```

Expected: one match, `file: "CLAUDE.md"`, `text` containing
`` Ask `prose-agent` if you need help with API test coverage. `` (verdict would be
`name-only` or `ok` depending on the skill's judgment call in Phase 2 Step 2 — either is
a defensible read of this sentence; the point of this check is that the match is found at
all, not which side of that judgment call it falls on).

```bash
node skills/revise-agent-routing/lib/revise-agent-routing.mjs grep --root "$SCRATCH/fixture" --name orphan-agent
```

Expected: `{"matches":[]}` — confirms `orphan-agent` would be verdict `orphan`.

- [ ] **Step 5: Fix and re-verify if anything diverged**

If any expected value in Steps 2–4 didn't match, fix `revise-agent-routing.mjs`, re-run the
specific failing check, and confirm it now matches before moving on. If a fix was needed,
re-run `npx eslint skills/revise-agent-routing/lib/revise-agent-routing.mjs && npx tsc --noEmit -p tsconfig.json`
and commit:

```bash
git add skills/revise-agent-routing/lib/revise-agent-routing.mjs
git commit -m "$(cat <<'EOF'
fix(revise-agent-routing): correct <describe the specific bug found>

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

If nothing needed fixing, no commit — this task only reads existing files plus a scratchpad
fixture, so there is nothing new to stage.

---

### Task 4: `skills/revise-agent-routing/SKILL.md`

**Files:**
- Create: `skills/revise-agent-routing/SKILL.md`

**Interfaces:**
- Consumes: the verified CLI contract from Tasks 1–3 (subcommand names, flags, exact JSON
  shapes) — every bash invocation below must match that contract exactly.
- Produces: the skill `aia-harness:revise-agent-routing`, invocable directly
  (`/aia-harness:revise-agent-routing [path]`) or via the Task 5 command wrapper.

- [ ] **Step 1: Write the skill**

Create `skills/revise-agent-routing/SKILL.md`:

```markdown
---
name: revise-agent-routing
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

The lib script backing every step below:
`"${CLAUDE_PLUGIN_ROOT}/skills/revise-agent-routing/lib/revise-agent-routing.mjs"`.
It only reads — every write in this skill goes through `Edit`, shown as a diff, after
explicit approval.

---

## Phase 1 — Audit + fix agent frontmatter

### Step 1: List agents

\```bash
node "${CLAUDE_PLUGIN_ROOT}/skills/revise-agent-routing/lib/revise-agent-routing.mjs" \
  list --root "${1:-$CLAUDE_PROJECT_DIR}"
\```

Returns `{ "agents": [{ "file", "name", "description" }], "skipped": [{ "file", "reason" }] }`.

If `agents` is empty: report "No `.claude/agents/*.md` found — nothing to audit" and stop
the whole skill here.

If `skipped` is non-empty: note each skipped file + reason for the final report (Phase 4);
continue with the rest.

### Step 2: Check each agent's description

For each agent in `agents`:

\```bash
node "${CLAUDE_PLUGIN_ROOT}/skills/revise-agent-routing/lib/revise-agent-routing.mjs" \
  check --text "<agent.description>"
\```

Returns `{ "ok": boolean, "violations": string[] }`.

### Step 3: Fix failing descriptions

For each agent where `ok` is `false`:

1. `Read` the agent's file body (below the frontmatter) to understand its real role.
2. Author a replacement one-line `description` that fixes every reported violation:
   condition-shaped (says WHEN to use it, not just what it does), contains "Use
   proactively" plus an explicit when/after/before trigger, one logical line (no `|`, no
   newline), 40-600 characters.
3. Show the old line and the new line as a diff:
   \```
   - description: <old value>
   + description: <new value>
   \```
4. Ask for confirmation (`AskUserQuestion`, one per agent, or batched if there are many).
5. On approval, `Edit` the agent's frontmatter `description:` line directly.

### Step 4: Track final descriptions

Keep an in-memory map `agentName -> finalDescription` for every agent (the fixed value if
Step 3 ran, otherwise the original value from Step 1). Phase 2 uses this map — do not
re-run `list`.

---

## Phase 2 — Map CLAUDE.md coverage

### Step 1: Parse the root table

\```bash
node "${CLAUDE_PLUGIN_ROOT}/skills/revise-agent-routing/lib/revise-agent-routing.mjs" \
  table --root "${1:-$CLAUDE_PROJECT_DIR}"
\```

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

  \```bash
  node "${CLAUDE_PLUGIN_ROOT}/skills/revise-agent-routing/lib/revise-agent-routing.mjs" \
    grep --root "${1:-$CLAUDE_PROJECT_DIR}" --name "<agent.name>"
  \```

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

\```text
Agent            Found in                     Verdict
`db-migrator`    CLAUDE.md:47 (table)         stale-description
`api-tester`     CLAUDE.md:112 (prose)        name-only
`legacy-runner`  —                            orphan
`code-reviewer`  CLAUDE.md:44 (table)         ok
\```

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

    \```markdown
    ## Workflow & Agents

    For every non-trivial implementation: invoke `superpowers:subagent-driven-development`.
    When dispatching subagents, you MUST use the matching specialist agent from the table below — never the generic agent when a specialist is listed. Cross-reference the task type with the "When to use" column and pass the exact name as `subagent_type`.

    | Agent | When to use |
    |---|---|
    | `<name>` | <finalDescription> |
    \```

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

\```text
Agents audited: N
Descriptions fixed: M
CLAUDE.md rows fixed: K
Orphans found: J (added: A, left as-is: J-A)
Skipped (unparsable frontmatter): S
\```

List every skipped file with its reason (from Phase 1 Step 1's `skipped` array).
```

- [ ] **Step 2: Lint the new markdown**

```bash
npx markdownlint-cli2 "skills/revise-agent-routing/SKILL.md" 2>/dev/null || true
```

If the project doesn't have `markdownlint-cli2` wired as a direct script, skip this and
instead visually check for the same two classes of issue seen in the design spec: unescaped
`|` inside any table cell, and bare ` ``` ` fences without a language tag (this file uses
` ```bash ` and ` ```text ` throughout — verify none were left bare).

- [ ] **Step 3: Commit**

```bash
git add skills/revise-agent-routing/SKILL.md
git commit -m "$(cat <<'EOF'
feat(revise-agent-routing): add the 4-phase workflow skill

Audits agent frontmatter, maps CLAUDE.md coverage (structured table
or free-text fallback), and applies fixes one finding at a time with
diff + consent. Standalone-invocable as /aia-harness:revise-agent-routing.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 5: `commands/revise-agent-routing.md`

**Files:**
- Create: `commands/revise-agent-routing.md`

**Interfaces:**
- Consumes: the skill name `aia-harness:revise-agent-routing` from Task 4.
- Produces: the command `/aia-harness:revise-agent-routing [path]`.

- [ ] **Step 1: Write the command**

Create `commands/revise-agent-routing.md`:

```markdown
---
description: Audit agent frontmatter descriptions in .claude/agents and sync them with CLAUDE.md routing mentions on an existing target project.
argument-hint: "[path]"
allowed-tools:
  - Bash
  - Read
  - Edit
  - AskUserQuestion
---

# Revise agent routing on an existing project

Target directory: `$1` if provided, else `$CLAUDE_PROJECT_DIR`.

<!-- aia-harness:target-dir-resolution -->
Resolve this **once**, at the
start of this command, into a concrete literal absolute path. `$CLAUDE_PROJECT_DIR` is documented
as available "when hooks are executed" but is not guaranteed inside the general-purpose Bash tool
used to run these instructions — it can silently expand empty there, and the CLI then falls back
to the shell's *current* working directory, which is wrong if the agent has since `cd`'d elsewhere
(e.g. into the scratchpad for intermediate file work). Reuse that one resolved literal path in
every subsequent invocation below, never re-expand a bare `$CLAUDE_PROJECT_DIR` in a later,
separately-issued Bash call, since each Bash tool call is a fresh shell (only cwd persists, not
exported variables) and an earlier `cd` silently redirects any later bare-env-var fallback to the
wrong place.

Invoke the `revise-agent-routing` skill with that resolved path: use the `Skill` tool with
`skill: "aia-harness:revise-agent-routing"` and `args: <resolved path>`.

Do **not** re-implement the audit here — the skill owns the full Phase 1-4 workflow (audit
agent frontmatter, map CLAUDE.md coverage, apply fixes with consent, report). This command
exists only to guarantee the target-dir-resolution boilerplate above runs identically to
`/aia-harness:doctor` and `/aia-harness:patch` before handing off.
```

- [ ] **Step 2: Commit**

```bash
git add commands/revise-agent-routing.md
git commit -m "$(cat <<'EOF'
feat(revise-agent-routing): add the thin command wrapper

Resolves the target directory with the same boilerplate doctor/patch
use, then hands off to the aia-harness:revise-agent-routing skill.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 6: `commands/help.md` — register the new command

**Files:**
- Modify: `commands/help.md`

**Interfaces:**
- Consumes: the command `/aia-harness:revise-agent-routing [path]` from Task 5.

- [ ] **Step 1: Add a row to the "Where to start" decision table**

In `commands/help.md`, find this existing row (currently the last content row before the
`| See this help |` row):

```markdown
| Generate or refresh **rich intermediate CLAUDE.md** files for strategic subdirectories | `/aia-harness:revise-claude-md` |
```

Add immediately after it:

```markdown
| **Sync agent routing** — audit `.claude/agents` frontmatter descriptions and fix stale/missing CLAUDE.md mentions | `/aia-harness:revise-agent-routing` |
```

- [ ] **Step 2: Add a detail block**

Find the existing `### /aia-harness:revise-claude-md [path]` section (ends right before the
`---` that precedes `## ⚙️ Engine CLI behind the commands`). Add this new section immediately
after it, before that `---`:

```markdown
### `/aia-harness:revise-agent-routing [path]`

**What it does:** audits every `.claude/agents/*.md` frontmatter `description` against the
routing-description standard (condition-shaped, "Use proactively" + trigger, 40-600 chars) and
offers to fix it in place. Cross-references each agent against the project's CLAUDE.md
`## Workflow & Agents` table (or free-text mentions if there's no table): fixes stale table
rows, proposes a minimal edit for name-only mentions, and flags/offers to add orphaned agents
(never mentioned anywhere). Works on any existing project, not just one scaffolded by
aia-harness. Shows a diff before every write; never writes without approval.
**When to use:** after adding or editing agents by hand, via a third-party plugin, or via
`/aia-harness:add-plugins` — anything that didn't go through `/aia-harness:init`'s own
agent-description pipeline.
**Writes files?** Only approved fixes, via `Edit` — agent frontmatter `description:` lines and
CLAUDE.md `## Workflow & Agents` rows/sections.
**Parameters:** `path` (optional).
```

- [ ] **Step 3: Commit**

```bash
git add commands/help.md
git commit -m "$(cat <<'EOF'
docs(help): register /aia-harness:revise-agent-routing

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 7: `README.md` — register the new command

**Files:**
- Modify: `README.md`

**Interfaces:**
- Consumes: the command `/aia-harness:revise-agent-routing [path]` from Task 5, and its
  one-line summary from Task 6.

- [ ] **Step 1: Add a row to the "🩺 Utility" command reference table**

In `README.md`, find this existing row (`## 🧩 Command Reference` → `### 🩺 Utility` table):

```markdown
| **`revise-claude-md`** `[path]` | Generates rich intermediate `CLAUDE.md` files for strategic subdirectories. Reads `.claude/rules/` (recursive — including per-stack subdirs), analyzes real source files, maps rules to domains by relevance, and produces domain-specific files with `## Key patterns` (concrete class names, DI tokens, naming conventions), `## Applied rules` (condensed summaries + `@`-references), and `## Local conventions` (derived from real code). Two-phase: map → approve → generate with diffs. Runs automatically as step 5.6 of `init`; run standalone to refresh after project structure or rules change. |
```

Add immediately after it:

```markdown
| **`revise-agent-routing`** `[path]` | Audits `.claude/agents/*.md` frontmatter descriptions against the routing-description standard and fixes them in place; cross-references each agent against the project's CLAUDE.md `## Workflow & Agents` table (or free-text mentions), fixing stale rows and flagging orphaned agents. Works on any existing project, not just one aia-harness scaffolded. |
```

- [ ] **Step 2: Commit**

```bash
git add README.md
git commit -m "$(cat <<'EOF'
docs(readme): register /aia-harness:revise-agent-routing

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 8: Final full-repo verification

**Files:** none (verification only).

**Interfaces:** consumes every file from Tasks 1–7.

- [ ] **Step 1: Run the full project check**

```bash
npm test
```

This runs `typecheck` + `lint` + `test:unit` (per `CLAUDE.md`'s Commands section). All three
must pass. If anything fails — including in a file this plan didn't touch — fix it before
finishing; per this repo's `CLAUDE.md`, a pre-existing failure in scope is not grounds to stop
without fixing it.

- [ ] **Step 2: Confirm the new command is visible where expected**

```bash
grep -n "revise-agent-routing" commands/help.md README.md commands/revise-agent-routing.md skills/revise-agent-routing/SKILL.md
```

Expected: at least one match in each of the four files.

- [ ] **Step 3: Report**

Summarize to the user: files created/modified, `npm test` result, and a one-line reminder
that this is a plugin-level command (not vendored into `templates/`, not usable inside a
target project unless the aia-harness plugin itself is active there — same as `doctor` and
`patch`).
