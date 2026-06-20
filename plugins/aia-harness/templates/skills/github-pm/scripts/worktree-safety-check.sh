#!/usr/bin/env bash
# Validate a worktree is safe to remove.
# Usage: worktree-safety-check.sh <WORKTREE_TARGET> <OWNER/REPO>
# WORKTREE_TARGET: branch name, issue number, worktree path, or empty (current)
# Exit 0: safe to remove; prints RESULT_WT_PATH and RESULT_WT_BRANCH on stdout
# Exit 1: blocked (prints checklist with ✅/❌)
# Exit 2: worktree not found

set -euo pipefail

TARGET="${1:-}"
OWNER_REPO="${2:-}"

# Resolve worktree path and branch
WT_JSON=$(git worktree list --porcelain 2>/dev/null) || { echo "Not a git repo" >&2; exit 2; }

resolve_worktree() {
  local target="$1"
  local path="" branch=""

  while IFS= read -r line; do
    if [[ "$line" == worktree* ]]; then path="${line#worktree }"; fi
    if [[ "$line" == branch* ]]; then branch="${line#branch refs/heads/}"; fi
    if [[ -z "$line" && -n "$path" ]]; then
      local match=false
      # Match by path, branch name, or issue number in branch
      [[ "$path" == "$target" ]] && match=true
      [[ "$branch" == "$target" ]] && match=true
      [[ -n "$target" ]] && [[ "$branch" =~ /$target- || "$branch" =~ /$target$ ]] && match=true
      # Skip the main worktree (no .git file, has .git dir)
      if [[ "$match" == "true" && "$path" != "$(git rev-parse --show-toplevel 2>/dev/null)" ]]; then
        echo "$path|$branch"
        return 0
      fi
      path=""; branch=""
    fi
  done <<< "$WT_JSON"
  return 1
}

if [[ -z "$TARGET" ]]; then
  # Use current directory as worktree
  CURRENT=$(pwd)
  MAIN=$(git rev-parse --show-toplevel 2>/dev/null || echo "")
  if [[ "$CURRENT" == "$MAIN" ]]; then
    echo "Already in main worktree — nothing to remove" >&2
    exit 2
  fi
  WT_PATH="$CURRENT"
  WT_BRANCH=$(git branch --show-current 2>/dev/null || echo "")
else
  RESOLVED=$(resolve_worktree "$TARGET") || { echo "Worktree not found for: $TARGET" >&2; exit 2; }
  WT_PATH="${RESOLVED%%|*}"
  WT_BRANCH="${RESOLVED##*|}"
fi

if [[ -z "$WT_PATH" || -z "$WT_BRANCH" ]]; then
  echo "Could not resolve worktree for: $TARGET" >&2
  exit 2
fi

BLOCKED=false

# 1. Working tree clean
if git -C "$WT_PATH" status --porcelain 2>/dev/null | grep -q .; then
  echo "❌ Uncommitted changes in $WT_PATH" >&2
  BLOCKED=true
else
  echo "✅ Working tree clean" >&2
fi

# 2. Nothing committed without push
UNPUSHED=$(git -C "$WT_PATH" log "origin/$WT_BRANCH..$WT_BRANCH" --oneline 2>/dev/null | wc -l | tr -d ' ')
if [[ "$UNPUSHED" -gt 0 ]]; then
  echo "❌ $UNPUSHED commit(s) not pushed to origin/$WT_BRANCH" >&2
  BLOCKED=true
else
  echo "✅ All commits pushed" >&2
fi

# 3. Branch has a PR
if [[ -n "$OWNER_REPO" ]]; then
  PR_NUMBER=$(gh pr list --repo "$OWNER_REPO" --head "$WT_BRANCH" --json number --jq '.[0].number' 2>/dev/null || echo "")
  if [[ -z "$PR_NUMBER" ]]; then
    echo "❌ No PR found for branch $WT_BRANCH" >&2
    BLOCKED=true
  else
    echo "✅ PR #$PR_NUMBER found" >&2

    # 4. CI not failing
    set +e
    bash "$(dirname "$0")/check-pr-status.sh" "$PR_NUMBER" "$OWNER_REPO" >/dev/null 2>/dev/null
    CI_EXIT=$?
    set -e
    if [[ $CI_EXIT -eq 1 ]]; then
      echo "❌ CI checks failing on PR #$PR_NUMBER" >&2
      BLOCKED=true
    elif [[ $CI_EXIT -eq 2 ]]; then
      echo "❌ CI checks still pending on PR #$PR_NUMBER" >&2
      BLOCKED=true
    else
      echo "✅ CI checks OK" >&2
    fi

    # 5. PR merged
    PR_STATE=$(gh pr view "$PR_NUMBER" --repo "$OWNER_REPO" --json state --jq '.state' 2>/dev/null || echo "UNKNOWN")
    if [[ "$PR_STATE" != "MERGED" ]]; then
      echo "❌ PR #$PR_NUMBER not merged (state: $PR_STATE)" >&2
      BLOCKED=true
    else
      echo "✅ PR #$PR_NUMBER merged" >&2
    fi
  fi
fi

if [[ "$BLOCKED" == "true" ]]; then
  exit 1
fi

echo "RESULT_WT_PATH=$WT_PATH"
echo "RESULT_WT_BRANCH=$WT_BRANCH"
exit 0
