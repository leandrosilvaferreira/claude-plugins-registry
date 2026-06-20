#!/usr/bin/env bash
# SessionStart hook:
#   1. suggest /aia-harness:init if project has no harness
#   2. notify if a newer plugin version is available (checked at most once per 24h)
set -euo pipefail

DIR="${CLAUDE_PROJECT_DIR:-$PWD}"
MESSAGES=()

# ── check 1: no harness → suggest init ────────────────────────────────────────
if [ ! -f "$DIR/CLAUDE.md" ] && [ ! -d "$DIR/.claude" ]; then
  MESSAGES+=("No Claude Code harness detected in this project. Run /aia-harness:init to scan the stack and scaffold hooks, rules, settings, MCP servers and CLAUDE.md (diagnose -> approve -> apply).")
fi

# ── check 2: update available? (rate-limited to once per 24h) ─────────────────
CACHE_DIR="${HOME}/.claude"
CACHE_FILE="${CACHE_DIR}/aia-harness-update-check"
NOW=$(date +%s)
LAST_CHECK=0

if [ -f "$CACHE_FILE" ]; then
  LAST_CHECK=$(cat "$CACHE_FILE" 2>/dev/null || echo 0)
fi

if [ $((NOW - LAST_CHECK)) -gt 86400 ] && [ -n "${CLAUDE_PLUGIN_ROOT:-}" ]; then
  PLUGIN_JSON="${CLAUDE_PLUGIN_ROOT}/.claude-plugin/plugin.json"

  if [ -f "$PLUGIN_JSON" ]; then
    INSTALLED=$(python3 -c "
import json
try:
    print(json.load(open('${PLUGIN_JSON}')).get('version',''))
except Exception:
    pass
" 2>/dev/null || true)

    if [ -n "$INSTALLED" ]; then
      REMOTE_JSON=$(curl -sf --max-time 3 \
        "https://raw.githubusercontent.com/leandrosilvaferreira/claude-plugins-registry/main/plugins/aia-harness/.claude-plugin/plugin.json" \
        2>/dev/null || true)

      if [ -n "$REMOTE_JSON" ]; then
        REMOTE=$(echo "$REMOTE_JSON" | python3 -c "
import json, sys
try:
    print(json.load(sys.stdin).get('version',''))
except Exception:
    pass
" 2>/dev/null || true)

        mkdir -p "$CACHE_DIR"
        echo "$NOW" > "$CACHE_FILE"

        if [ -n "$REMOTE" ] && [ "$REMOTE" != "$INSTALLED" ]; then
          MESSAGES+=("aia-harness update available: v${INSTALLED} -> v${REMOTE}. Run: claude plugin update aia-harness")
        fi
      fi
    fi
  fi
fi

# ── output ─────────────────────────────────────────────────────────────────────
if [ ${#MESSAGES[@]} -eq 0 ]; then
  exit 0
fi

CONTEXT=""
for msg in "${MESSAGES[@]}"; do
  [ -n "$CONTEXT" ] && CONTEXT="${CONTEXT} | ${msg}" || CONTEXT="$msg"
done

python3 -c "
import json, sys
print(json.dumps({
    'hookSpecificOutput': {
        'hookEventName': 'SessionStart',
        'additionalContext': sys.argv[1]
    }
}))
" "$CONTEXT"
exit 0
