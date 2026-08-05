---
description: Commit, push, and open PR linked to the issue
allowed-tools: Bash(git *), Bash(gh *), AskUserQuestion
---

Current branch: !`git branch --show-current`
Status: !`git status --short`
Diff: !`git diff HEAD --stat`
Config PM: !`cat .claude/pm-config.json 2>/dev/null || echo "NOT_FOUND"`

Use the `github-pm` skill to execute this workflow.

**Worktree-safe execution:** run every `git`/`gh` command below as its own separate,
plain Bash call — never chain two of them with `&&`, `;`, or `$(...)` command
substitution. A worktree-isolated session refuses any command it cannot statically
verify stays inside the worktree, and a compound git invocation (variable assigned
from a git command substitution, then reused) is exactly what gets refused ("too
complex to verify that it stays inside the worktree"). Each step below is already
written as one command per code block for this reason — keep it that way, including
when a step has two consecutive code blocks (run them as two separate Bash calls,
not pasted together).

1. Branch gate — never commit onto `main`/`master`. If the current branch is
   `main` or `master`, automatically create a fresh branch for the pending
   changes and switch to it before committing:
   - Name it from the change you are about to commit (same conventional-commit
     type + a kebab slug of the subject): `<type>/<slug>`, max 60 chars
     (e.g. `fix/version-from-plugin-json`). If an issue number is already known
     from context, prefix it: `<type>/<N>-<slug>`.

   ```bash
   git checkout -b <branch>
   ```

   Then continue the workflow on this new branch (use it as `<BRANCH>` below).
   If already on a non-main branch, use it as-is. The PR's base branch does not
   need to be computed here — step 5 lets `gh pr create` resolve it on its own.

2. Analyze `git diff HEAD` to generate a commit message (conventional commits):
   - feat: new feature
   - fix: bug fix
   - chore: maintenance/infra
   - docs: documentation
   - refactor: refactoring without behavior change
   - test: tests

3. Commit immediately — do not ask for confirmation. Two separate commands,
   run one at a time (not joined by `&&`):

   ```bash
   git add -A
   ```

   ```bash
   git commit -m "<generated message>"
   ```

4. Push. `-u` both creates the upstream tracking branch on the first push and is
   a safe, idempotent no-op re-run on later pushes, so no `||` fallback command
   is needed:

   ```bash
   git push -u origin <BRANCH>
   ```

5. Detect the issue from the branch name — the branch you created in step 1 if
   the gate fired, otherwise the `Current branch` value from the dynamic context
   above (that value was captured before step 1, so it is stale if the gate
   created a new branch). Take the first `[0-9]+` match: `feat/42-*` or `42-*`
   → issue #42. Optionally verify it:

   ```bash
   gh issue view <N> --json number,title
   ```

   Create the PR with "Closes #N" in the body if an issue was detected. Omit
   `--base` entirely — `gh pr create` already defaults it to the repository's
   real default branch, so there is nothing to compute or hardcode. (The old
   `BASE=$(git rev-parse --abbrev-ref HEAD@{upstream} ...)` fallback was worse
   than useless: `@{upstream}` is the current branch's tracking ref, not the
   PR target, and its `sed 's|.*/||'` mangles any branch name containing `/`.)

   ```bash
   gh pr create --title "<title based on commit>" --body "<body with Closes #N>"
   ```

6. Report the PR URL. Suggest: "Run `/pm:code-review-pr <PR>` to start the review."

7. Ask via the **AskUserQuestion** tool whether to merge now — question
   "Merge this PR now?", options "Merge now (`/pm:pr-merge <N>`)" and "Not yet".
   If they choose to merge → run the `/pm:pr-merge <N>` workflow with `<N>` = the
   PR number from step 5.
