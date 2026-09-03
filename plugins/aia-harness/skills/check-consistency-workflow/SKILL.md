---
name: check-consistency-workflow
description: >
  Whole-harness consistency audit for an existing Claude Code project: enumerates every
  skill, agent, rule, command, script, and CLAUDE.md file, cross-references every mention
  against what actually exists on disk, dispatches parallel auditors to settle uncertain
  references and judge whether each artifact's content still fits the project's real
  stack, then fixes what the user approves in bounded rounds. Works on any existing
  project, not just one scaffolded by aia-harness. Use standalone, or after adding,
  removing, or renaming any harness artifact by hand.
argument-hint: "[path]"
allowed-tools:
  - Bash
  - Read
  - Edit
  - AskUserQuestion
  - Agent
  - Skill
  - TodoWrite
---

# Check consistency

Audit every cross-reference between skills, agents, rules, commands, scripts, and
CLAUDE.md files in an existing harness, and whether each artifact's content still fits the
project's real stack. Target directory: `$1` if provided, else `$CLAUDE_PROJECT_DIR`.

<!-- aia-harness:target-dir-resolution -->
Resolve this **once**, at the
start of this skill, into a concrete literal absolute path. `$CLAUDE_PROJECT_DIR` is documented
as available "when hooks are executed" but is not guaranteed inside the general-purpose Bash tool
used to run these instructions — it can silently expand empty there, and the CLI then falls back
to the shell's *current* working directory, which is wrong if the agent has since `cd`'d elsewhere
(e.g. into the scratchpad for intermediate file work). Reuse that one resolved literal path in
every subsequent invocation below — the `enumerate`, `xref`, and `scan --json` calls in Phase 1,
and every subagent prompt built in Phase 2 — never re-expand a bare `$CLAUDE_PROJECT_DIR` in a
later, separately-issued Bash call, since each Bash tool call is a fresh shell (only cwd persists,
not exported variables) and an earlier `cd` silently redirects any later bare-env-var fallback to
the wrong place.

The lib script backing Phase 1:
`"${CLAUDE_PLUGIN_ROOT}/skills/check-consistency-workflow/lib/check-consistency.mjs"`.
It only reads and never writes. **One named exception to what follows:** Phase 2 Step 3
invokes `revise-agent-routing-workflow` via the `Skill` tool, which runs in this same
thread (a `Skill` call is not a subagent dispatch) and performs its own `Edit` calls —
gated by that skill's own per-finding `AskUserQuestion` approval, never written
sight-unseen. Outside that one step, **every fix this skill makes is written by a
dispatched subagent — this skill's own logic never calls `Edit` itself.** This is a
deliberate deviation from most other commands in this plugin (which edit directly after
showing a diff); it is required here because the fix work runs in parallel waves instead.

Track phase and per-category progress with `TodoWrite` as you go — this workflow has 7
phases and up to 2 fix/verify rounds, easy to lose track of by hand.

---

## Phase 1 — Deterministic inventory

### Step 1: Enumerate every artifact

```bash
node "${CLAUDE_PLUGIN_ROOT}/skills/check-consistency-workflow/lib/check-consistency.mjs" \
  enumerate --root "<resolved path>"
```

Returns:

```jsonc
{
  "root": "<resolved path>",
  "truncated": false,
  "skills":   [{ "file", "name", "description" }],
  "agents":   [{ "file", "name", "description" }],
  "rules":    [{ "file", "name" }],
  "commands": [{ "file", "name" }],
  "scripts":  [{ "file" }],
  "claudeMd": [{ "file" }],
  "settingsHookScripts": [{ "event", "script" }]
}
```

`truncated` (same field name as `bin/harness.mjs scan --json`, placed second so it survives
any output cap) is `true` when the walk hit its file cap before finishing — check it before
trusting anything else in this response; see the Stop condition below. Internally, `xref`
resolves a `dangling` mention against the **complete** walked-path list — not just these
six categories — so a real file in a skill's `references/`/`scripts/` subdirectory or a
nested agent is never misreported as missing; that full list is not part of this CLI
command's own output (it can be very large on a real project), only of `xref`'s own
resolution.

### Step 2: Cross-reference

```bash
node "${CLAUDE_PLUGIN_ROOT}/skills/check-consistency-workflow/lib/check-consistency.mjs" \
  xref --root "<resolved path>"
```

Returns:

```jsonc
{
  "dangling":  [{ "from", "line", "kind", "mention", "text" }],
  "uncertain": [{ "from", "line", "kind": "name", "mention", "text" }],
  "orphans":   [{ "file", "kind", "confidence": "high" | "low", "reason" }]
}
```

`dangling` means `mention` was checked against every file the walk saw (`allFiles`, not
just the four classified artifact lists) and does not exist anywhere on disk in the
project — that existence check is settled, not a judgment call. Whether it should be
*fixed* is a separate question a human still has to answer: the mention could be a
genuinely broken reference, or an illustrative placeholder inside a fenced code example
(`node .claude/hooks/my-example-hook.mjs` in a rule) — which is exactly why Phase 5 shows
every dangling fix as a diff before writing it, the same as any other finding, never as an
automatic mechanical repair. `uncertain` is a backticked name that may or may not name a
real missing artifact — the real judgment happens in Phase 2. `orphans` is a file nothing
else mentions by name or path; `confidence: "low"` entries are informational (Claude Code
auto-discovers skills/agents/rules/commands, so being unmentioned is not automatically a
defect) — `confidence: "high"` (a hook script wired nowhere in `settings.json` **and**
mentioned nowhere else) is a stronger finding, but still goes through the same
diff-then-approve gate as everything else before anything is written.

### Step 3: Stack profile

```bash
node "${CLAUDE_PLUGIN_ROOT}/bin/harness.mjs" scan "<resolved path>" --json
```

From the result, keep `primaryLanguage`, `frameworks`, `packageManagers`, and `commands`
(the canonical `lint`/`format`/`typecheck`/`test`/`build` the project actually runs) — every
Phase 2 dispatch needs these to judge stack fit.

### Stop condition

If `enumerate`'s `truncated` is `true`: **stop here, before Phase 2.** The file walk hit
`collectFiles`'s cap before it finished, so every list in the response — including which
`.claude/` files exist at all — is an incomplete inventory, not a real one. Proceeding
would audit partial results, and a file the walk never reached reads as missing: exactly
what turns a real, existing file into a false `dangling`. Report "⚠️ file walk truncated —
this project is too large for `check-consistency` to inventory completely" and stop the
whole skill here, the same way the empty-inventory case below does.

If `enumerate`'s `skills`, `agents`, `rules`, `commands`, and `scripts` are **all** empty
and `claudeMd` is also empty: report exactly "no harness artifacts found — nothing to
audit" and stop the whole skill here. Do not proceed to Phase 2.

---

## Phase 2 — Parallel audit wave

### Step 1: Build each category's slice

Five categories: `skills`, `rules`, `commands+scripts`, `claude-md`, `agents`. Each gets
its own slice of `enumerate` and of `xref`'s three arrays — `dangling`/`uncertain` slice on
**`from`** (the file the mention was found in) while `orphans` slices on **`kind`** (the
kind of the file that's missing a mention). These are genuinely different partitions of
the two arrays, confirmed against the CLI source — do not reuse one filter for both:

- **`skills`** — `enumerate.skills`; dangling/uncertain where `from` is a `skills[].file`;
  orphans where `kind` is `"skill"`.
- **`rules`** — `enumerate.rules`; dangling/uncertain where `from` is a `rules[].file`;
  orphans where `kind` is `"rule"`.
- **`commands+scripts`** — `enumerate.commands` + `enumerate.scripts` +
  `enumerate.settingsHookScripts` (context for judging wiring); dangling/uncertain where
  `from` is a `commands[].file` (scripts are never a `from` source themselves — they're
  code, not text `xref` scans for mentions); orphans where `kind` is `"command"` or
  `"script"`.
- **`claude-md`** — `enumerate.claudeMd`; dangling/uncertain where `from` is a
  `claudeMd[].file`; orphans always `[]` — the deterministic layer never orphan-checks a
  CLAUDE.md file.
- **`agents`** — `enumerate.agents`; dangling/uncertain where `from` is an `agents[].file`;
  orphans where `kind` is `"agent"`.

**Division of labour for `agents` — two audits, two owners, never the same territory.**
This category's auditor dispatch (Step 2 below) covers the agent's **content and outgoing
references**: the dangling/uncertain/orphans slice above, plus stack-fit of the agent's own
body — a checklist naming a framework, tool, lint rule, or command the project does not
use; guidance pinned to a library major version the project has moved past. Separately,
`revise-agent-routing-workflow` (Step 3 below) covers **routing descriptions and CLAUDE.md
table sync** only — it never touches an agent's body content or the references it makes
outward. Neither re-audits the other's territory; say so again at Step 3 so it stays
unmissable.

### Step 2: Dispatch the five auditors

Dispatch the `Agent` tool **once per category, all five in a single message**, with
`subagent_type: "aia-harness:harness-consistency-auditor"` and **`model: "sonnet"` passed
explicitly on every one of the five dispatches**. This is not optional boilerplate: this
agent is a **namespaced plugin agent**, and per root `CLAUDE.md`'s "Model dispatch" note,
the `PreToolUse` model guard force-sets `sonnet` on a model-less dispatch for project/user
agents but **deliberately does not rewrite namespaced plugin agents** — an omitted `model`
here is silently *not* corrected for you, unlike almost every other agent dispatch in this
plugin. Do not "simplify" this line away in a future edit.

Each of the five prompts is self-contained (a subagent inherits nothing from this
conversation) and must carry:

- The resolved absolute project path.
- That category's `enumerate` slice (Step 1).
- That category's `dangling` / `uncertain` / `orphans` slice (Step 1).
- The stack profile fields from Phase 1 Step 3.
- This exact instruction for the return shape: *"Return your findings as a markdown table
  with exactly these columns: severity (critical/warning/nit), file, line (blank if not
  line-specific), kind, finding (one line), fix (one line). If this category has no real
  problems, say so plainly instead of a table — do not manufacture findings."* **`file`
  always means the file to EDIT to resolve the finding — never a dangling mention's
  missing target, which may not exist at all.** Phase 5 buckets fix waves on this exact
  value; an auditor reporting the wrong file here would put two findings that really touch
  the same file into different, apparently-disjoint buckets, breaking the parallel-wave
  safety guarantee without anyone noticing.

### Step 3: Dispatch the routing-sync audit

Separately — a `Skill` call cannot ride in the same message as the parallel `Agent`
dispatches above — invoke the `Skill` tool with
`skill: "aia-harness:revise-agent-routing-workflow"` and `args: <resolved path>`.

This is **not** a second pass over the `agents` category above — it is a narrower, disjoint
audit: routing-description-vs-CLAUDE.md-table sync only, never agent body content and never
the agent's own outgoing references (that's Step 2's `agents` dispatch). By the time it
returns, whatever it found has **already been fixed or explicitly declined**, under its own
per-finding `AskUserQuestion` gate (its own Phase 3) — nothing from *this* audit is left
pending for this skill's Phase 4/5. Fold its final report (the counts block from its own
Phase 4) into Phase 3 below as an **already-resolved** row, labeled `agents (routing sync)`
to keep it visibly distinct from the `agents` category's own pending findings from Step 2.

---

## Phase 3 — Consolidate

Merge into one list: the five auditors' findings tables and the routing-workflow skill's
own report. Drop duplicate findings (same `file` **and** same `finding`, exact match after
trimming whitespace). Group by category, then by severity.

Present the merged result as one table before doing anything else — state every count even
when it's zero, an empty category is a result, not a skipped step:

```text
Category                 Findings   Critical  Warning  Nit   Status
skills                    3          1         2        0     pending
rules                     0          —         —        —     pending (none found)
commands+scripts          2          0         1        1     pending
claude-md                 1          1         0        0     pending
agents                    2          0         2        0     pending
agents (routing sync)     —          —         —        —     resolved via revise-agent-routing-workflow
```

---

## Phase 4 — Approve

`AskUserQuestion`, multi-select: one option per category that has **pending** findings
from Phase 3 (whichever of `skills`/`rules`/`commands+scripts`/`claude-md`/`agents` are
non-zero), recommending all of them selected. `agents (routing sync)` is never an option
here — it has nothing pending by this point (Phase 2 Step 3 already resolved it under its
own consent gate).

Nothing in Phases 5-6 runs before this answer returns.

---

## Phase 5 — Fix waves

### Step 1: Bucket by file

Take every approved finding, from only the categories the user selected. Group by `file`
(the file to edit — see Phase 2 Step 2's return-shape instruction, never a dangling
mention's missing target): every finding for the same file goes in the same bucket, and no
two buckets ever share a file — the disjoint-`Files` wave rule from
`.claude/rules/08-parallel-subagent-driven-development.md`, applied per file since a
"task" here already **is** one file's worth of findings.

### Step 2: Dispatch one fix subagent per bucket

All buckets dispatched **in a single message**, `subagent_type: "general-purpose"` — no
specialist in root CLAUDE.md's `## Workflow & Agents` table covers ad-hoc content repair
across skill/rule/command/agent/CLAUDE.md prose, so this is the documented fallback case,
not an invented one — and **`model: "sonnet"` passed explicitly** (a model-less `general-purpose`
dispatch would be auto-corrected by the `PreToolUse` guard anyway, but stay explicit here
to match Phase 2's style rather than relying on that).

Each prompt carries: the resolved project root, the exact findings for its file(s) (`line`,
`kind`, `finding`, `fix`), and two hard rules stated verbatim:

1. **Do NOT commit.** Leave changes in the working tree.
2. **Never write to disk in this step, for any finding.** Every fix — whether it's a
   **mechanical** repair (a path reference to correct, a mention line to add, a stale
   command name to swap) or a **content rewrite** (anything that changes prose meaning
   rather than just a reference — most stack-fit findings) — is returned as an exact
   proposed unified diff in the final report. The mechanical/rewrite label still matters
   for Phase 7's report (which kind of fix it was), but it never decides whether the user
   sees the change first — that gate (Step 3 below) is identical for both. A `dangling`
   finding is a confirmed-missing path, not a confirmed intent to fix it: the mention
   could be a real broken reference, or an illustrative placeholder in a fenced code
   example (`node .claude/hooks/my-example-hook.mjs` inside a rule) — only a human can
   tell the difference, which is exactly why nothing, mechanical or not, is ever written
   sight-unseen.

### Step 3: Approve and apply proposed diffs

For every proposed diff returned in Step 2 — mechanical and content-rewrite alike — show
it to the user (`AskUserQuestion` or a direct yes/no) before it counts as done. On
approval, dispatch a follow-up subagent (`subagent_type: "general-purpose"`,
`model: "sonnet"`) whose only job is to apply exactly that diff via `Edit` to that one
file — **this skill's own logic still never calls `Edit` itself, outside the one exception
named at the top of this skill** (Phase 2 Step 3's routing-sync invocation); approval
changes who may write, never that constraint. On decline, leave it reported only and move
to the next.

---

## Phase 6 — Re-verify

Re-run only:

```bash
node "${CLAUDE_PLUGIN_ROOT}/skills/check-consistency-workflow/lib/check-consistency.mjs" \
  xref --root "<resolved path>"
```

For every approved **dangling** finding, confirm no entry with the same `from` + `mention`
remains in the new `dangling`. For every approved **orphan** finding, confirm no entry
with the same `file` remains in the new `orphans`. These are the only two checks `xref`
can mechanically re-confirm — it cannot re-judge a resolved `uncertain` reference or
re-check a stack-fit content rewrite; treat the diff already shown and approved in Phase 5
as the only verification those get.

If any approved dangling/orphan finding is still present: bucket the stragglers (Phase 5
Step 1's rule still applies) and repeat Phase 5 once more. **Hard cap: 2 rounds total** —
the original fix wave plus at most one retry. After the second round's re-verification,
stop regardless of what remains and report it in Phase 7 — never loop a third time.

---

## Phase 7 — Report

Final table, one row per category — list the exact `file:line` of everything still open
underneath it (Phase 6's remaining stragglers and every declined finding) — never just a
count with nothing to act on. `Declined` covers two distinct cases, counted the same way:
a whole category the user did not select in Phase 4, and a per-diff decline in Phase 5
Step 3 — both land in that column, never in `Remaining` (which means selected, attempted,
and still broken after the 2-round cap):

```text
Category                                      Found  Fixed  Declined  Remaining
skills                                         3      3      0         0
rules                                          0      0      0         0
commands+scripts                               2      1      1         0
claude-md                                      1      1      0         0
agents                                         2      2      0         0
agents (routing sync)                          —      2      0         0
```
