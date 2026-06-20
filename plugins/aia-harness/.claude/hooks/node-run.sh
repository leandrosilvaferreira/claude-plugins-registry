#!/usr/bin/env bash
# aia-harness node resolver. Finds a usable Node.js runtime and execs the given
# script, so JS hooks work even when `node` is not on PATH (e.g. nvm-managed).
# Usage: node-run.sh <script.mjs> [args...]
set -euo pipefail

SCRIPT="${1:-}"
if [ -z "$SCRIPT" ]; then
  echo "node-run: missing script argument" >&2
  exit 1
fi
shift || true

find_node() {
  if [ -n "${CLAUDE_NODE:-}" ] && [ -x "${CLAUDE_NODE}" ]; then
    printf '%s\n' "$CLAUDE_NODE"; return 0
  fi
  if command -v node >/dev/null 2>&1; then
    command -v node; return 0
  fi
  if [ -d "${HOME}/.nvm/versions/node" ]; then
    local newest
    newest="$(ls -d "${HOME}"/.nvm/versions/node/*/bin/node 2>/dev/null | sort -V | tail -n1)"
    if [ -n "$newest" ] && [ -x "$newest" ]; then printf '%s\n' "$newest"; return 0; fi
  fi
  if command -v bun >/dev/null 2>&1; then
    command -v bun; return 0
  fi
  return 1
}

NODE_BIN="$(find_node || true)"
if [ -z "$NODE_BIN" ]; then
  # Fail open: a missing runtime must never block Claude Code.
  echo "node-run: no Node.js runtime found (set CLAUDE_NODE to override)" >&2
  exit 0
fi

exec "$NODE_BIN" "$SCRIPT" "$@"
