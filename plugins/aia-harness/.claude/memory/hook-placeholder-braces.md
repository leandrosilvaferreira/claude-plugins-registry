---
name: hook-placeholder-braces
description: Claude Code exec-form hooks (args present) only expand ${VAR}, never bare $VAR — bare form silently breaks with MODULE_NOT_FOUND
metadata:
  type: business-rule
---

Claude Code hook entries in `settings.json` have two forms: **shell-form** (a single
`command` string, no `args`) and **exec-form** (`command` + an `args` array, spawned
directly with `shell:false`). Both forms support the path placeholders
`$CLAUDE_PROJECT_DIR`, `$CLAUDE_PLUGIN_ROOT`, `$CLAUDE_PLUGIN_DATA`, but the
substitution rule differs by form:

- **Shell-form**: runs through a real shell, so `$VAR` and `${VAR}` are expanded
  identically (ordinary POSIX/PowerShell variable expansion).
- **Exec-form**: no shell involved. Claude Code does its own textual substitution on
  `command` and each `args[]` element, and it **only recognizes the braced `${VAR}`
  form**. A bare `$VAR` is passed through completely literally to the spawned process.

Since `hookCmd()` in `lib/generate/settings.mjs` uses exec-form for all aia-harness
hooks, every path placeholder in `args` **must** be braced. A bare one is not a shell
issue and not caught by JSON Schema validation (schema only checks types, not this
semantic convention) — it silently produces `Cannot find module '<cwd>/$CLAUDE_PROJECT_DIR/...'`
(`MODULE_NOT_FOUND`) the first time the hook fires, and Claude Code just logs a DEBUG
error and continues, so it can go unnoticed for days.

**Why this was hard to discover:** confirmed only by downloading the raw
`https://www.schemastore.org/claude-code-settings.json` JSON Schema and the raw HTML of
`https://code.claude.com/docs/en/hooks` directly (via curl, not the summarizing
WebFetch tool) — the schema's own `args` field description says it plainly ("path
placeholders never need quoting" implies Claude Code does its own substitution there),
and the docs explicitly show every exec-form example using `${CLAUDE_PROJECT_DIR}`,
never the bare form.

**How to apply:** `lib/detect/hook-hygiene.mjs` (`detectHookPlaceholderIssues`) now
detects a bare placeholder in any target project's own `.claude/settings.json`, surfaced
via `scan` (warning) and `doctor` (guided fix via `Edit`, never via `apply` — see
[[merge-settings-hooks-dedup-key]]). When writing or reviewing ANY exec-form hook
(anywhere: `lib/generate/settings.mjs`, `templates/`, docs examples), the placeholder
must always be the braced form.
