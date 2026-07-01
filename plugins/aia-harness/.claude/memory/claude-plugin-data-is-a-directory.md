---
name: claude-plugin-data-is-a-directory
description: ${CLAUDE_PLUGIN_DATA} resolves to a directory, not a file — passing it bare as a cache-file arg causes silent EISDIR on every read/write
metadata:
  type: architecture
---

`${CLAUDE_PLUGIN_DATA}` is a real, documented placeholder (docs.claude.com/plugins-reference,
"Persistent data directory" section) substituted in hook `args`/`command`, same family as
`${CLAUDE_PLUGIN_ROOT}` and `${CLAUDE_PROJECT_DIR}`. It resolves to
`~/.claude/plugins/data/{id}/` where `{id}` is `{plugin-name}-{marketplace-or-source}`
(e.g. `aia-harness-leandro-plugins-registry`, `aia-harness-inline` for a local/dev-loaded
copy) — **a directory**, auto-created by the host the first time the placeholder is
referenced. It is never a file.

`check-plugin-update.mjs` (v0.3.2) passed `"${CLAUDE_PLUGIN_DATA}"` bare as `argv[2]` and
the script did `fs.readFileSync(cacheFile)` / `fs.writeFileSync(cacheFile, ...)` directly on
it. Both throw `EISDIR`, caught silently by the hook's own fail-open `try/catch` — no error
ever surfaced, the cache directory just stayed empty forever, and `isCheckDue` always saw
"never checked" → the hook re-ran its full check (shelling out to `claude plugin list` +
`claude plugin marketplace update`) on **every** session start instead of once per 24h as
designed. Silent-by-design fail-open hooks can mask a real functional bug this way — a hook
never erroring is not proof it's working.

**Why:** Took a dispatched research subagent (to confirm the placeholder's real semantics
against official docs) plus a direct filesystem check of the resolved
`~/.claude/plugins/data/{id}/` path (empty directory = the tell) to confirm this wasn't
"first real run, nothing to see yet" but an actual bug. Fixed in v0.3.3 by appending the
filename directly in the placeholder string:
`"${CLAUDE_PLUGIN_DATA}/update-check.json"` — matching the official doc's own example
(`"${CLAUDE_PLUGIN_DATA}/package.json"`). Related: [[hook-placeholder-braces]],
[[claude-plugin-cli-and-marketplace-autoupdate]].

**How to apply:** Any hook/script that receives `${CLAUDE_PLUGIN_DATA}` as an arg must treat
it as a directory root and reference a filename inside it — never read/write it directly as
a file. When auditing a hook that uses this placeholder, check the real resolved directory
on disk (not just "no error thrown") before trusting it persists state correctly.
