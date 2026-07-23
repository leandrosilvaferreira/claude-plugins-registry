---
paths:
  - "**/*"
---

# Parallel Wave Execution (subagent-driven-development)

## Purpose

`superpowers:subagent-driven-development` dispatches one implementer subagent at a time by
default, and its own guidance explicitly warns against running multiple implementers in
parallel (concurrent-edit conflicts). This rule overrides that serial default with
**parallel waves** of independent tasks, for tasks that satisfy the safety conditions below.

**Precedence:** project rules / CLAUDE.md outrank a skill's internal guidance. This is a
precedence-based override, not a fork — the `superpowers` plugin itself is never modified,
edited, or vendored; its skill files are loaded and used exactly as shipped.

## Why this override is safe

The skill's serial-only guidance guards two failure modes that parallel dispatch can cause:

- **(a)** two implementers editing the **same file** concurrently (one clobbers the other), and
- **(b)** two implementers racing `git commit` (`.git/index.lock` contention, or one commit
  silently clobbering another).

Wave execution removes both premises structurally:

- **(a) Disjoint `Files` per wave** — no two tasks in the same wave touch overlapping paths,
  so there is nothing to clobber.
- **(b) Implementers do not commit; the controller serializes commits after the wave** — no
  concurrent `git commit`, so there is no index race.

Once both premises are gone, the conflict the skill's guidance warns about cannot occur. A
wave is only ever formed when both conditions hold for every pair of tasks in it (see Wave
formation below).

## What waves change — and what they keep

Waves change **only orchestration**: the skill's serial loop (one implementer at a time)
becomes parallel waves of independent tasks. **Everything else about the skill stays intact
and mandatory** — load `superpowers:subagent-driven-development` itself (this rule does not
replace it) and use its own templates unmodified:

- **The implementer contract** (`implementer-prompt.md`): read the task brief, **ask
  questions before starting**, TDD, self-review, report one of `DONE` / `DONE_WITH_CONCERNS` /
  `BLOCKED` / `NEEDS_CONTEXT`, write a report file. This is the prompt body for every wave
  implementer. **The one edit:** its "Commit your work" step becomes "do NOT commit — leave
  changes in the working tree and report the exact `Files changed`" (see the execution loop
  below).
- **The task-reviewer contract** (`task-reviewer-prompt.md`): two mandatory verdicts (spec
  compliance + code quality), the skill's review method, YAGNI, test hygiene. Prompt body for
  every wave reviewer, unmodified.
- Any other scripts or ledger the skill uses for task briefs, review packaging, and progress
  tracking — unmodified.

**Agent TYPE and PROMPT BODY are orthogonal.** The dispatched subagent's *type* is a project
specialist — look it up in the `## Workflow & Agents` / `Superpowers → Project Specialists`
table in your root `CLAUDE.md`, matched by the task's file scope — never `general-purpose`
unless no specialist row covers the task. The *prompt body* is still the skill's own template
above. Both apply in the same dispatch: the specialist supplies project rules and model tier;
the template supplies the SDD contract (questions first, TDD, self-review, one of 4 statuses,
2 verdicts). Dispatching a specialist does not replace the skill's contract — they coexist.
Never dispatch a wave implementer or reviewer with an ad-hoc prompt that drops the skill's
contract — that contract is what keeps SDD from getting lost.

## Task tagging

When a plan is decomposed into tasks (e.g. via `superpowers:writing-plans`), annotate each
task with two fields:

- `Files:` — the paths/globs the task will touch, as precise as possible.
- `Depends-on:` — the task numbers whose interfaces or outputs this task consumes, or `none`.

A task missing either field — or any uncertainty about its scope — is treated as **dependent
on everything**, which silently degrades that task to serial execution. This is the
fail-safe: untagged tasks never accidentally parallelize.

## Wave formation

Two tasks belong in the **same wave** if and only if both hold:

1. Neither task appears in the other's `Depends-on`, transitively (no dependency path connects
   them in either direction).
2. Their `Files` sets are disjoint (`Files(A) ∩ Files(B) = ∅`).

If either condition fails, the tasks go to separate waves — the dependent (or file-colliding)
task deferred to a later wave. In the degenerate case of a fully linear dependency chain,
every wave has exactly one task, which is byte-for-byte the skill's ordinary sequential
behavior — **no regression** versus not using this rule at all.

## Per-wave execution loop

1. **Task brief per task** — one brief file per task (via the skill's own task-brief
   mechanism), distinctly named, no collisions.
2. **Dispatch every implementer in the wave in ONE message** — this is what makes it real
   parallelism (one turn fanning out N subagents, not N sequential turns). Prompt body = the
   skill's `implementer-prompt.md`, unmodified except the override below. Subagent type = the
   specialist matching each task's file scope (see previous section).
   - **Mandatory override, in every implementer's prompt:** replace the "Commit your work"
     step with *"do NOT commit — leave changes in the working tree and report the exact
     `Files changed`."* Everything else is unchanged: implement → test (a focused suite while
     working, the full suite once before reporting) → self-review → write the report. It just
     never runs `git commit`.
3. **Controller serializes commits after the wave** — if and when committing fits your
   project's workflow (some flows commit right away; others batch, or leave commits to a
   human). When it does commit, do it **per task, in order**: capture `BASE = current HEAD`,
   `git add` that task's `Files`, `git commit`. One commit per task, with `BASE` captured
   fresh immediately before *that* task's own commit — never a hardcoded `HEAD~1`, which
   becomes wrong as soon as more than one commit has landed in the wave.
4. **Parallel per-task review, distinct ranges.** Once commits exist, review each task's
   `BASE..HEAD` range independently; dispatch all of the wave's task reviewers together in one
   message (prompt body = the skill's `task-reviewer-prompt.md`, unmodified) — safe because
   review is read-only, so there's no race. Route any findings through a per-task fix loop:
   the fix subagent also does not self-commit — the controller re-commits after each fix. Both
   verdicts (spec compliance + code quality) are required per task before it's marked done.
5. **One controller-owned ledger write per wave.** Record all of the wave's tasks in your
   progress ledger in a single write, rather than one append per task — this avoids a
   blind-append race on a ledger file that may be shared across the whole plan or worktree.
6. Proceed to the next wave.

## Safety rails

| Never | Always |
| --- | --- |
| Two implementers touch the same file in the same wave | Disjoint `Files` per wave guarantee separation |
| An implementer self-commits inside a parallel wave | The controller serializes commits after the wave |
| A task without `Files:`/`Depends-on:` runs in a parallel wave | Tag every task at decomposition; missing tags → serial |
| Tasks with a declared dependency run in the same wave | The dependent task moves to a later wave |
| A wave needs overlapping `Files` with no way to split them | Serialize those tasks, or fall back to worktree isolation (below) |

## Fallback: worktree isolation

When two tasks genuinely cannot avoid touching the same file(s) and splitting them would
defeat the purpose of parallelizing, dispatch them using the native `Agent` tool's
`isolation: "worktree"` parameter instead of a wave: each implementer gets its own worktree
and branch, so self-committing is safe (there is no shared index to race on), and the
controller integrates the results afterward via merge or cherry-pick. This is the one path
where an implementer is allowed to commit its own work.

Treat this as **expensive and a last resort**, not a default — per-worktree setup (dependency
install, environment bootstrap) costs real time, so only reach for it when the parallelism
gained is worth that cost.

**Cwd-drift caution:** both subagents and the controller can drift the shell's working
directory out of the worktree mid-task. Always operate on the worktree explicitly —
`git -C <worktree> ...` or `cd <worktree> && ...` — never a bare command that assumes the
current directory, and verify `HEAD` immediately after creating the worktree to confirm it
branched from the expected commit before doing any work in it.

## Relationship to whole-branch review

Unchanged. Waves scope **only** the implementation phase and per-task review described above.
Any whole-branch or whole-PR review your project runs afterward — whether that is the skill's
own `superpowers:requesting-code-review` step or a separate project-level review command — is
unaffected: run it exactly as you would without this rule.

## No numeric concurrency cap

There is no hard "max N implementers per wave" setting anywhere in this rule, and none should
be added. Throttling is purely structural — disjoint `Files` and no mutual dependency — never
a numeric concurrency limit. A wave is exactly as large as the disjoint-files/no-dependency
test allows for the current set of ready tasks.
