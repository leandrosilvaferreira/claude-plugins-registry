#!/usr/bin/env bash
# SessionStart hook (read-only): if no harness is detected in the project,
# gently suggest /aia-harness:init. Emits non-blocking additionalContext.
set -euo pipefail

DIR="${CLAUDE_PROJECT_DIR:-$PWD}"

# Already has a harness? Stay quiet.
if [ -f "$DIR/CLAUDE.md" ] || [ -d "$DIR/.claude" ]; then
  exit 0
fi

cat <<'JSON'
{"hookSpecificOutput":{"hookEventName":"SessionStart","additionalContext":"No Claude Code harness detected in this project. Run /aia-harness:init to scan the stack and scaffold hooks, rules, settings, MCP servers and CLAUDE.md (diagnose -> approve -> apply)."}}
JSON
exit 0
