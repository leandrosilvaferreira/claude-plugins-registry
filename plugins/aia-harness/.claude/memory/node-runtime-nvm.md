---
name: node-runtime-nvm
description: Node/npm not on PATH in non-interactive shells; resolve via nvm path
metadata: 
  node_type: memory
  type: reference
  originSessionId: 771f2bf6-1cc4-4795-a542-72b4f587e30d
---

Node.js is nvm-managed on this machine and is NOT on PATH in non-interactive shells — bare `node`/`npm`/`npx` return nothing. Newest install: `~/.nvm/versions/node/v22.16.0/bin`. `bun` also exists at `~/.bun/bin/bun`. No system node.

**How to apply:** Prefix node/npm Bash calls with `export PATH="$HOME/.nvm/versions/node/v22.16.0/bin:$PATH"`. For shipped scripts that must find node at runtime, use a resolver order `$CLAUDE_NODE → node on PATH → newest ~/.nvm/versions/node/*/bin/node → bun`.
