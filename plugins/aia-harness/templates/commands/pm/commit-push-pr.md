---
description: Commit, push, and open PR linked to the issue
allowed-tools: Bash(git *), Bash(gh *), AskUserQuestion
---

Current branch: !`git branch --show-current`
Status: !`git status --short`
Diff: !`git diff HEAD --stat`
Config PM: !`cat .claude/pm-config.json 2>/dev/null || echo "NOT_FOUND"`
Issues linked (via branch name): !`git branch --show-current | grep -oE '[0-9]+' | head -1 | xargs -I{} gh issue view {} --json number,title 2>/dev/null || echo "none"`

Use the `github-pm` skill to execute this workflow:

1. MANDATORY GATE: if current branch = `main` or `master` → STOP.
   Instruct the user to create a branch first (`/pm:worktree-new` or `git checkout -b`).

2. Analyze `git diff HEAD` to generate a commit message (conventional commits):
   - feat: new feature
   - fix: bug fix
   - chore: maintenance/infra
   - docs: documentation
   - refactor: refactoring without behavior change
   - test: tests

3. Propose the commit message and show it to the user. Wait for confirmation.

4. Commit:

   ```bash
   git add -A && git commit -m "<approved message>"
   ```

5. Push (create upstream if needed):

   ```bash
   git push -u origin <BRANCH> 2>/dev/null || git push origin <BRANCH>
   ```

6. Detect the issue from the branch name (e.g.: `feat/42-*` → issue #42).
   Create PR with "Closes #N" in the body if an issue is detected:

   ```bash
   gh pr create \
     --title "<title based on commit>" \
     --body "## Summary\n\n<description>\n\nCloses #<N>" \
     --base main
   ```

7. Report the PR URL. Suggest: "Run `/pm:code-review-pr <PR>` to start the review."
