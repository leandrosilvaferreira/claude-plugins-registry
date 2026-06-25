---
name: goal-builder
description: Use when asked to generate, build, prepare, optimize or assemble a /goal command for autonomous or overnight execution — triggers: "assemble goal", "generate autonomous goal", "prepare overnight task", "goal for autonomous session", "optimize goal", "goal builder".
allowed-tools: Read, Glob, Grep, AskUserQuestion, Write
model: opus
---

# Goal Builder

Generates an optimized `/goal` for autonomous execution, with a 5-phase superpowers pipeline, transcript-verifiable checks, and a mandatory safety cap.

## Invariants — never violate

- The evaluator (Haiku) reads **only the transcript**. A check only proves something if the agent **writes the output in the conversation**.
- Every condition needs a **check whose result appears in the transcript** (`npm test exit 0`, `git status clean`, printed count).
- Max **4000 chars** in the condition.
- **Superpowers pipeline always present** — 5 phases. No user instruction = use default pipeline.
- **Goodhart Effect:** the agent optimizes exactly what is measured. Rich task → reference an external spec with quality requirements.

## Anatomy of a `/goal` (3 + 1)

| # | Component | Example |
|---|-----------|---------|
| 1 | Measurable end state | "all tests in `test/auth` pass" |
| 2 | Transcript-verifiable check | "`npm test` exits 0" |
| 3 | Constraints | "without altering existing test files" |
| + | Mandatory cap | "or stop after 80 turns" |

## Default superpowers pipeline (5 phases)

```
PHASE 1  superpowers:brainstorming               — design + spec (review if spec already exists)
PHASE 2  superpowers:writing-plans               — detailed implementation plan
PHASE 3  superpowers:executing-plans             — execute plan task-by-task with checkpoints
PHASE 4  superpowers:verification-before-completion — verify everything before finishing
PHASE 5  superpowers:finishing-a-development-branch — integrate: merge, PR or cleanup
```

**Default cap: 80 turns.** Calibrate: trivial task → 40t; broad task → 120t+. Minimum ~15t per phase.

**When to replace:** user lists alternative phases with explicit commands/skills → replace pipeline entirely.

## MANDATORY Workflow

### 1. Collect requirements

- Doc/spec provided → `Read` to extract objectives, criteria, constraints, paths. Do not re-ask what is already clear.
- Record which pipeline to apply before proceeding.
- Existing spec → PHASE 1 = "review/validate" (not recreate).
- Existing plan → PHASE 2 = "validate/update" (not recreate).

### 2. Map gaps → AskUserQuestion (max 4 per call)

| Point | Notes |
|-------|-------|
| Objective / end state | Heart of the goal — without this there is no condition |
| How to prove (check) | Output that appears in the transcript |
| Scope / paths | Limits where the agent operates |
| Constraints | What must not break/change |
| Cap (turns) | Default 80t. Reduce if trivial |
| Quality beyond the check | Requirements the check doesn't capture (anti-Goodhart) |
| PHASE 1 skip or review? | Spec already exists → brainstorming in review mode |
| PHASE 2 update? | Plan exists → validate existing vs. recreate? |

Always offer a recommended default in the options.

### 3. Decide format

- **Simple task** (1 end state, obvious check, few requirements) → inline `/goal` with default pipeline.
- **Complex task** (multiple criteria, subjective quality, multi-domain, > 4000 chars) → spec + `/goal` that references it.
  - Existing spec pointed to → reference it, do not duplicate.
  - New spec → `Write` to `docs/specs/<slug>.md`.

### 4. Assemble the `/goal`

Mandatory checklist:

- ✅ Measurable end state
- ✅ Transcript-verifiable check
- ✅ Explicit constraints
- ✅ Cap calibrated to scope
- ✅ 5-phase pipeline in exact order with `"PHASE N OK"` markers
- ✅ Prohibition on skipping phases
- ✅ `do not ask questions, decide independently`

### 5. Deliver

- Copyable block with `/goal ...`.
- If a spec was generated: confirmed file path.
- "Before running" checklist: auto mode on, `git status` clean, spec reviewed if it exists.

---

## Templates

### A) Simple task — inline goal

```text
/goal <end state> proven by <check in transcript>; without <constraint>.

Execute the 5-phase superpowers pipeline in exact order, WITHOUT skipping any:
PHASE 1 superpowers:brainstorming — understand requirements, design and spec; print "PHASE 1 OK".
PHASE 2 superpowers:writing-plans — create detailed implementation plan; print "PHASE 2 OK".
PHASE 3 superpowers:executing-plans — execute plan task-by-task with checkpoints; print "PHASE 3 OK".
PHASE 4 superpowers:verification-before-completion — verify everything before finishing; print "PHASE 4 OK".
PHASE 5 superpowers:finishing-a-development-branch — integrate (merge/PR/cleanup); print "PHASE 5 OK".

End state proven: (1) <gate command> exiting 0; (2) all 5 "PHASE N OK" markers printed in order.
Do not ask questions, decide independently. Stop after <N> turns.
```

### B) Complex task — spec + goal

`docs/specs/<slug>.md`:

```markdown
# <Title> — Autonomous execution spec

## Objective
<desired result in 1-2 sentences>

## Acceptance criteria (each verifiable)
- [ ] <criterion 1> — proof: <command/output>
- [ ] <criterion 2> — proof: <command/output>

## Quality requirements (anti-Goodhart)
<what "good" means beyond the check: UX, business rules, edge cases>

## Scope
- Touch: <paths>
- DO NOT touch: <paths/constraints>

## Definition of done
<final state + all checks green + cap>
```

`/goal` line:

```text
/goal implement everything in docs/specs/<slug>.md until all acceptance criteria pass, each proven by the indicated command.

Execute the 5-phase superpowers pipeline in exact order, WITHOUT skipping any:
PHASE 1 superpowers:brainstorming — review spec at docs/specs/<slug>.md (DO NOT recreate); print "PHASE 1 OK".
PHASE 2 superpowers:writing-plans — create/validate plan based on spec; print "PHASE 2 OK".
PHASE 3 superpowers:executing-plans — execute plan task-by-task; print "PHASE 3 OK".
PHASE 4 superpowers:verification-before-completion — run <gate command>; verify coverage; print "PHASE 4 OK".
PHASE 5 superpowers:finishing-a-development-branch — integrate; print "PHASE 5 OK".

End state proven: (1) <gate command> exiting 0; (2) all 5 "PHASE N OK" markers printed in order; (3) git status clean.

Quality (anti-Goodhart): <requirements the gate does not capture>.
Constraints: <what must not change>.
Do not ask questions — decide independently. Stop after <N> turns.
```

---

## Anti-patterns

| Bad | Good |
|---------|--------|
| Goal without pipeline | 5-phase superpowers pipeline always present |
| No cap | `or stop after N turns` always |
| Check the evaluator cannot see | Check output printed in transcript |
| PHASE N OK markers absent | One marker per phase — evaluator proves execution |
| Re-asking what is in the doc | Read doc, extract, ask only what is missing |
| Undersized cap | 5 phases × ~15t minimum = 80t default |
| Pipeline omitted for "simple task" | Pipeline is DEFAULT — always present, always |
| New spec in `tasks/` | New spec goes in `docs/specs/<slug>.md` |
