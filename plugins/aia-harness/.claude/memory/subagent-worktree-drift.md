---
name: subagent-worktree-drift
description: Agent-tool subagents don't inherit the controller's EnterWorktree state — cheap-tier models especially may commit to the original repo root instead of the assigned worktree
metadata:
  type: architecture
---

When the controller session is inside a linked worktree (via `EnterWorktree`) and
dispatches a subagent via the `Agent` tool with a prose instruction like "work from
`/path/to/.claude/worktrees/<name>`", the subagent does **not** automatically inherit
the controller's worktree pinning. Its own sandbox's "home"/pinned directory appears to
default to the main repo root. If the subagent's session ever resets its shell cwd
(the same auto-reset-after-`cd` mechanism the controller itself experiences), it can
snap back to the main repo root instead of the assigned worktree — and any `git commit`
it runs from there lands on `main` (or whatever branch the main checkout is on), not on
the intended worktree branch.

**Confirmed reproducible:** happened twice in one session, both times with `model:
"haiku"` dispatches; two other dispatches in the same session with `model: "sonnet"`
correctly stayed in the assigned worktree the whole time (confirmed via git log). An
explicit "verify pwd/branch/HEAD before doing anything, STOP if mismatched" instruction
in the prompt did not prevent it in either haiku case — the reported final
self-verification in one case falsely claimed a match that further Bash inspection
proved false.

**Why this is easy to miss:** the subagent's own final report can look completely
normal (plausible commit SHA, "typecheck passes," "location verified ✓") while the
actual commit sits on the wrong branch entirely — `git log` on the intended worktree
branch simply won't show it, since the object exists in the shared `.git` object
database but isn't reachable from that branch's ref.

**How to apply:** after every subagent dispatch that is supposed to commit inside a
worktree, the controller must independently run `git log --oneline -3` (and ideally
`npm test`) **on the actual worktree path**, not just trust the subagent's report. If
the claimed commit SHA isn't in that log, check `git branch --all --contains <sha>` to
find where it actually landed (commonly `main`), then recover via `git reset --hard
<previous-good-commit>` on the contaminated branch (safe if unpushed — check
`git rev-list --left-right --count origin/<branch>...<branch>` first) followed by
`git cherry-pick <sha>` onto the correct worktree branch. Prefer `sonnet`-tier or higher
for any subagent dispatch that will run `git commit` inside a worktree; reserve cheap
tiers for read-only or non-worktree work.

See also: [[controller-session-worktree-cwd-drift]] — the same drift mechanism,
confirmed to also hit the controller session itself (not only dispatched
subagents), plus what happens when it causes `ExitWorktree` to lose track of
the active worktree.
