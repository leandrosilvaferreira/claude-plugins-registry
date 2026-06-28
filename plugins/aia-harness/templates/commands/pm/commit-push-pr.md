---
description: Commit, push, and open PR linked to the issue
allowed-tools: Bash(git *), Bash(gh *)
---

Current branch: !`git branch --show-current`
Status: !`git status --short`
Diff: !`git diff HEAD --stat`
Config PM: !`cat .claude/pm-config.json 2>/dev/null || echo "NOT_FOUND"`
Issues linked (via branch name): !`git branch --show-current | grep -oE '[0-9]+' | head -1 | xargs -I{} gh issue view {} --json number,title 2>/dev/null || echo "none"`
Base branch: !`BASE=$(git rev-parse --abbrev-ref HEAD@{upstream} 2>/dev/null | sed 's|.*/||'); [ -z "$BASE" ] && BASE=$(git symbolic-ref refs/remotes/origin/HEAD 2>/dev/null | sed 's|refs/remotes/origin/||'); [ -z "$BASE" ] && BASE=main; echo "$BASE"`

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

3. Commit immediately — do not ask for confirmation:

   ```bash
   git add -A && git commit -m "<generated message>"
   ```

4. Push (create upstream if needed):

   ```bash
   git push -u origin <BRANCH> 2>/dev/null || git push origin <BRANCH>
   ```

5. Detect the issue from the branch name (e.g.: `feat/42-*` → issue #42).
   Use the `Base branch` value from the dynamic context above for `--base`.
   Create PR with "Closes #N" in the body if an issue is detected:

   ```bash
   gh pr create \
     --title "<title based on commit>" \
     --body "## Summary\n\n<description>\n\nCloses #<N>" \
     --base <Base branch>
   ```

6. Report the PR URL. Suggest: "Run `/pm:code-review-pr <PR>` to start the review."
