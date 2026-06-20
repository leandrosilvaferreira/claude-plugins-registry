#!/usr/bin/env bash
# Validate PR CI status and review approval before merge.
# Usage: check-pr-status.sh <PR_NUMBER> <OWNER/REPO>
# Exit 0: all checks passed + review approved (or no branch protection)
# Exit 1: one or more checks failing
# Exit 2: checks still pending
# Exit 3: PR not found, invalid, or no checks registered
# Exit 4: checks OK but no approved review

set -euo pipefail

PR_NUMBER="${1:-}"
OWNER_REPO="${2:-}"

if [[ -z "$PR_NUMBER" || -z "$OWNER_REPO" ]]; then
  echo "Usage: $0 <PR_NUMBER> <OWNER/REPO>" >&2
  exit 3
fi

# Fetch PR state
PR_JSON=$(gh pr view "$PR_NUMBER" --repo "$OWNER_REPO" \
  --json state,isDraft,mergeStateStatus,statusCheckRollup,reviewDecision 2>/dev/null) || {
  echo "PR #$PR_NUMBER not found in $OWNER_REPO" >&2
  exit 3
}

STATE=$(echo "$PR_JSON" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d['state'])")
IS_DRAFT=$(echo "$PR_JSON" | python3 -c "import sys,json; d=json.load(sys.stdin); print(str(d['isDraft']).lower())")

if [[ "$STATE" != "OPEN" ]]; then
  echo "PR #$PR_NUMBER is $STATE (not OPEN)" >&2
  exit 3
fi

if [[ "$IS_DRAFT" == "true" ]]; then
  echo "PR #$PR_NUMBER is a draft" >&2
  exit 3
fi

# Check CI rollup
ROLLUP=$(echo "$PR_JSON" | python3 -c "
import sys, json
d = json.load(sys.stdin)
checks = d.get('statusCheckRollup', [])
if not checks:
    print('NONE')
    sys.exit(0)
states = [c.get('conclusion') or c.get('state') or 'PENDING' for c in checks]
if any(s in ('FAILURE', 'ERROR', 'TIMED_OUT', 'CANCELLED') for s in states):
    print('FAILING')
elif any(s in ('PENDING', 'QUEUED', 'IN_PROGRESS', 'WAITING', 'REQUESTED', 'EXPECTED', None) for s in states):
    print('PENDING')
else:
    print('SUCCESS')
")

case "$ROLLUP" in
  NONE)
    # No checks registered — fall through to review check
    ;;
  FAILING)
    echo "CI checks are failing for PR #$PR_NUMBER" >&2
    gh pr checks "$PR_NUMBER" --repo "$OWNER_REPO" 2>/dev/null || true
    exit 1
    ;;
  PENDING)
    echo "CI checks still pending for PR #$PR_NUMBER" >&2
    exit 2
    ;;
  SUCCESS)
    ;;
esac

# Check review decision
REVIEW=$(echo "$PR_JSON" | python3 -c "
import sys, json
d = json.load(sys.stdin)
print(d.get('reviewDecision') or 'NONE')
")

if [[ "$REVIEW" == "APPROVED" || "$REVIEW" == "NONE" ]]; then
  echo "PR #$PR_NUMBER: all checks passed" >&2
  exit 0
else
  echo "PR #$PR_NUMBER: checks OK but review not approved (status: $REVIEW)" >&2
  exit 4
fi
