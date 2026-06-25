---
name: condense-harness-prompts
description: Condenses harness .md prompts (.claude/agents, commands, rules, skills) using caveman full + Opus, without losing information. Compresses verbose prose and tables, preserves code blocks/URLs/inline-code/headings via a deterministic gate. Overwrites in place (git is the review safety net). Use when asked to "condense/compress/shorten the agents/commands/rules/skills in .claude".
---

# Condense Harness Prompts

Condenses the Claude Code harness `.md` files (`.claude/`) with **caveman full + the Opus model**, guaranteeing semantic preservation. Goal: fewer tokens per artifact without losing any rule, technical example, or nuance.

## Architecture — 2 layers

| Layer | Who | Does |
|--------|------|------|
| Semantic compression | **parallel Opus subagents** (1/file) | compresses prose + condenses tables; writes `<file>.condensed.tmp` |
| Deterministic gate + commit | `lib/condense.mjs` (main thread) | validates `.tmp` vs original, overwrites on pass, keeps `.tmp` on fail |

> The subagent **only compresses** — it never validates nor overwrites. The gate runs in the main mjs because a subagent can report a false green. It separates the creative part (compress) from the mechanical part (validate+commit).

---

## MANDATORY workflow

### 1. Ask scope — `AskUserQuestion`

Single question, header `Scope`, options:

| Option | Resolves to |
|-------|--------------|
| **Everything (agents+commands+rules)** | `node ... enumerate --all` |
| **One folder** | 2nd question: agents \| commands \| rules → `--type <folder>` |
| **One skill** | ask the skill name (dir in `.claude/skills/`) → `--type skills --name <name>` |
| **One file** | ask the path → `--file <path>` |

- **Skills: only 1 per run** (never batch) — a skill can have multiple `.md` files; enumerate already scans that skill recursively.
- If the user already stated the scope in the invocation prompt, skip the question and use it directly.
- Accepts the `--skip-dedup` flag to skip step 5c. Default: dedup active for files in `.claude/`.

### 2. Enumerate targets

```bash
node "${CLAUDE_PLUGIN_ROOT}/skills/condense-harness-prompts/lib/condense.mjs" \
  enumerate --root "${CLAUDE_PROJECT_DIR}" <flags>
```

Output = one line per file, **already sorted largest to smallest**, in the format:

```text
<bytes>\t<human-size>\t<path>
```

E.g.: `14802\t14.5KB\t/…/.claude/agents/frontend-specialist.md`. If empty → warn and stop.

**When presenting the files to the user** (when the scope returned several and/or to confirm): list **largest → smallest** (the order already comes ready), with the **size next to each path**. Largest first = most to gain from condensation.

If the user passed `--skip-dedup`, record it internally to skip step 5c.

### 2.5. Determine the artifact type per file

For each enumerated file, derive the type from the path and record it internally:

| Path pattern | Type | Best-practices file |
| --- | --- | --- |
| `.claude/agents/*.md` | `agent` | `best-practices/agents.md` |
| `.claude/commands/*.md` | `command` | `best-practices/commands.md` |
| `.claude/rules/*.md` | `rule` | `best-practices/rules.md` |
| `.claude/skills/**/SKILL.md` | `skill` | `best-practices/skills.md` |

`best_practices_path` = `"${CLAUDE_PLUGIN_ROOT}/skills/condense-harness-prompts/best-practices/<type>s.md"` (replace `<type>s` with the plural of the type, e.g. `agents.md`).

Record `{ path, type, best_practices_path }` per file. Use it when composing each subagent's prompt in step 4.

### 3. Todo list — MANDATORY (2+ files)

`TodoWrite` one item per enumerated file. Mark complete as each subagent returns.

### 4. Dispatch Opus subagents — PARALLEL

One `Agent` per file, **all in the same turn** (multiple `Agent` calls in a single message). `subagent_type: general-purpose`, `model: opus`. Prompt = template below (self-contained — the subagent does not inherit history).

**For each file, substitute in the prompt:**

- `<absolute-path>` → the file path
- `<artifact-type>` → the type derived in step 2.5 (`agent`/`skill`/`command`/`rule`)
- `<best-practices-path>` → the `best_practices_path` derived in step 2.5

### 5. Commit + gate

After all subagents return:

```bash
node "${CLAUDE_PLUGIN_ROOT}/skills/condense-harness-prompts/lib/condense.mjs" \
  commit <file1> <file2> ...
```

The gate blocks if it lost a code block, URL, inline-code, or heading count. Blocked → original intact, `.tmp` kept.

### 5b. Optional fix-loop

For each **blocked** file, you may re-dispatch 1 correction subagent (max 1-2 rounds) — it receives the exact gate errors + the original as reference and ONLY restores what was lost, rewriting the `.tmp`. Then run `commit` again on just that file. If it still blocks → give up, leave it to the human via `.tmp`.

### 5c. Global Dedup Review (default: active; skip with `--skip-dedup`)

> `graphify` **does not index `.claude/`** — the scan is always native grep/glob.

**Precondition:** the step 5 gate passed for at least 1 file. Run only if the artifact belongs to `.claude/`.

#### 5c-1. Map cross-references

For each file that passed the gate, grep/glob in `.claude/` to identify:

1. What the artifact mentions (names of rules, skills, agents, or commands it cites).
2. Who mentions the artifact (other artifacts that reference the file's name/path).

```bash
grep -rl "<name>" .claude/rules/ .claude/skills/ .claude/agents/ .claude/commands/
```

If grep returns **0 references** in either direction → skip 5c silently.

#### 5c-2. Dispatch Dedup Analyst subagent

If cross-refs are found: 1 `general-purpose` / `sonnet` subagent with the template from the "Dedup Analyst Template" section. Runs after the step 5 commit.

#### 5c-3. Present the proposal to the user

Show the subagent output (proposal table + byte estimate). Ask for confirmation before any edit.

#### 5c-4. Apply only on approval

If approved: apply via `Edit` to the already-compressed file. If refused: discard.

### 6. Report to the user

The commit table. For each **blocked** file, give the `.tmp` path. If step 5c ran: include a dedup summary (how many duplications, substitutions applied, bytes saved).

---

## Subagent prompt template (caveman full + preservation)

```
You are a Claude Code harness prompt compressor. Compress the file below in CAVEMAN FULL style, without losing ANY technical information.

FILE: <absolute-path>
ARTIFACT TYPE: <artifact-type>

STEP 0 — MANDATORY: Read the best-practices file for this artifact type:
  <best-practices-path>

Apply the invariants and type-specific compression rules in it BEFORE and DURING compression. In particular:
- agents: preserve delegation triggers in the `description`; do not change behavioral frontmatter fields (`tools`, `model`, `permissionMode`, `isolation`, etc.)
- skills: preserve "Use when..." patterns in the `description`; do not change `allowed-tools`/`paths`/`disable-model-invocation`
- commands: preserve `$1`/`${VAR}` variables, dynamic context `` !`...` ``, AskUserQuestion options, paths with `${CLAUDE_PLUGIN_ROOT}`
- rules: NEVER remove `paths:` from the frontmatter; compress the body aggressively (every token saved repeats in every session)

CAVEMAN FULL — cut: articles (a/the), filler (just/really/basically/simply), hedging (maybe/could/I think), pleasantries. Sentences → fragments. Short synonyms. Say once, do not repeat.

CONDENSE (aggressive where it is prose):
- Narrative text → terse bullets/fragments
- Verbose tables → merge redundant prose-cells, remove duplicate rows
- Frontmatter `description:` → condense the prose BUT keep ALL triggers/keywords (they drive delegation routing)

PRESERVE EXACT (never change/remove):
- Code blocks (``` … ```) — byte for byte, incl. content
- Inline code (`token`) — every token; do NOT drop any even when merging a table
- Exact URLs and paths
- Headings (#..######) — same text and same count
- Wikilinks [[...]]
- All other YAML frontmatter fields (name, model, skills, allowed-tools, etc.) — intact
- Every rule, prohibition, numeric threshold, tool/file name

HARD RULE: there is a deterministic gate after you. If you lose a code block, URL, inline-code, or change the heading count, the file is REJECTED and your work discarded. Be aggressive on prose, surgical on the rest.

OUTPUT: write the compressed markdown to `<absolute-path>.condensed.tmp` (Write tool). Do NOT overwrite the original file. Do NOT validate. Do NOT wrap in an outer code fence. Return only: bytes before → bytes after.
```

---

## Dedup Analyst subagent prompt template (step 5c-2)

```
## Context
Compressed file: <absolute-path-of-the-compressed-artifact>
Related artifacts found (grep/glob in .claude/):
<list-of-paths-with-size>

## Task
1. Read the compressed artifact (Read tool).
2. Read each related artifact listed above (Read tool).
3. Identify all content present in the compressed artifact that also exists substantially in some related artifact (checklist, rule, table, whole section).
4. For each duplication found: propose a pointer-based replacement — e.g. "> See rule X — section Y" or "> Apply skill Z".
5. Passages with no confirmed canonical equivalent in another artifact → do NOT propose removal (keep verbatim).
6. Deliver structured output (see format below).

## Constraints
- Do NOT use graphify — it does not cover .claude/.
- Do NOT remove information without a confirmed canonical equivalent.
- Do NOT touch code blocks, URLs, inline-code, or headings — only duplicated prose/checklists.
- Return text only (table + diffs) — do NOT edit files.

## Expected output format

### Proposal table

| Section in artifact | Canonical source (path + section) | Pointer-based replacement | Bytes saved (est.) |
|-------------------|-------------------------------|----------------------------|--------------------------|
| <passage/section> | <path>::<heading>             | `> See <file> — <section>` | ~<N> bytes               |

### Proposed diffs

For each table row, include:

old:
<current passage in the artifact>

new:
> See <file> — <section>

### Content without duplicate (keep)

List of the passages that have NO equivalent in another artifact and must be preserved verbatim.
```

---

## What the gate checks

A faithful port of caveman-compress's `validate.py`:

| Check | Failure = | Blocks? |
|-------|---------|-----------|
| Code blocks identical | any change | ERROR |
| URLs (set) | lost/added URL | ERROR |
| Inline code (count) | lost `token` | ERROR |
| Heading count | number of headings changed | ERROR |
| Heading text/order | reordered/renamed | warning |
| Path drift | path lost/added | warning |
| Bullet drift | >15% variation | warning |
| Inline code added | new `token` in the compressed | warning |

---

## Relationship with caveman-compress

**Does NOT reuse the compressor** (`caveman-compress.sh` nor `compress.py`):
- Both call a nested `claude --print` → it hangs in this session.
- Hardcoded model (haiku/sonnet-4-5). We want **Opus**.
- Haiku is lossy; the goal here is **preservation** (Opus + gate).

**Reuses (ported into `lib/condense.mjs`):**
- `validate.py` → deterministic gate, 6 checks. Self-contained in the plugin, works for the team.
- `compress.py` guardrails: `is_sensitive_path`, `MAX_FILE_SIZE` 500KB, skip empty, `strip_llm_wrapper`, abort if identical, fix-loop (step 5b).

## Best-practices reference files

Each artifact type has its guide in `best-practices/` — loaded by the subagent in Step 0:

- [best-practices/agents.md](best-practices/agents.md) — agent frontmatter, delegation triggers, body (system prompt)
- [best-practices/skills.md](best-practices/skills.md) — skill frontmatter, discovery triggers, progressive disclosure, invariants
- [best-practices/commands.md](best-practices/commands.md) — command frontmatter, `$1`/`${VAR}` variables, dynamic context, AskUserQuestion
- [best-practices/rules.md](best-practices/rules.md) — rule frontmatter, `paths:` scope, context cost of global rules

## Notes

- **No dry-run** — writes in place; git is the review.
- **Does not inherit history** — each subagent receives full context in the prompt.
- `.condensed.tmp` files are never re-enumerated (filtered out in enumerate).
- `<best-practices-path>` in the subagent template = `"${CLAUDE_PLUGIN_ROOT}/skills/condense-harness-prompts/best-practices/<type>s.md"` — substitute before dispatching.
