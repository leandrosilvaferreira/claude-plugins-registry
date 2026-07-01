---
name: controller-session-worktree-cwd-drift
description: Not just subagents — the controller session's own Bash cwd can silently drift out of an EnterWorktree'd directory mid-session; ExitWorktree also loses removal-ownership after a path-based re-entry
metadata:
  type: architecture
---

The controller session itself (not only dispatched subagents — see
[[subagent-worktree-drift]] for that case) can have its Bash tool's cwd
silently reset away from an `EnterWorktree`'d directory back toward the main
checkout, with no explicit `cd` ever issued. Observed twice in one session:
a `Write` call using a hardcoded absolute path landed in the main checkout
instead of the worktree (caught because the file showed up as untracked in
the main checkout's `git status`), and later a bare `git add <relpath>` /
`git commit` inside a multi-command Bash call failed with "did not match any
files" — `pwd`/`git branch --show-current` at that moment showed the main
checkout on `main`, not the worktree, despite no intervening `cd`. A
dispatched implementer subagent later independently hit the identical drift
and self-caught it via the same defensive instruction given below,
confirming this is a recurring platform behavior, not a one-off fluke.

**Why this is easy to miss:** ordinary commands (`ls`, `Read`, most `Bash`
calls using relative paths) keep working and just silently operate on the
wrong tree — nothing errors until a git operation exposes the mismatch (or,
worse, a `git commit` succeeds — on the main checkout instead of the
worktree, exactly the class of bug this session was fixing in the hook
codebase itself).

**How to apply:** for every git-mutating command (`add`, `commit`, `mv`)
inside a worktree session, either use `git -C <worktree-abs-path> ...`
(immune to cwd drift entirely) or an explicit `cd "<path>" && ...` chained
in the *same* Bash call — never assume a cwd established by an earlier tool
call, even a recent one, still holds. Re-verify `pwd` and
`git branch --show-current` immediately before every commit, not just once
at task start — put this same instruction in every subagent dispatch that
will commit inside a worktree.

**`ExitWorktree` degrades too.** After enough of this drift (or simply after
many intervening tool calls), `ExitWorktree` can report "no active
EnterWorktree session to exit" (a no-op) even though the worktree is still
in active use — the harness's own "which worktree is this session in"
tracking lost the thread, same symptom class as the cwd drift itself.
Re-attaching via `EnterWorktree({path: <worktree-path>})` restores session
function, but a subsequent `ExitWorktree({action:"remove"})` will then
explicitly *refuse*: "was not created by EnterWorktree [in this reattached
session], will not remove it" — the tool distinguishes original creation
from path-based reattachment for removal-safety and will not delete a
worktree it can't prove it created. Recovery sequence:
`ExitWorktree({action:"keep"})` to return to the main checkout, then
manually `git worktree remove <path>` + `git worktree prune` +
`git branch -d <branch>` from the main root. Safe once the branch's commits
are confirmed reachable from the target branch (e.g. after a `--no-ff`
merge) — `git branch -d` (lowercase, not `-D`) itself refuses to delete an
unmerged branch, a natural safety net for this exact recovery path.
