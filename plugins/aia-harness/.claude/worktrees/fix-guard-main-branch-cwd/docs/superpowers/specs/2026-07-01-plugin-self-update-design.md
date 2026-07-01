# Plugin self-update on session start — Design

## Problem

`aia-harness` has no update mechanism. Installed copies silently go stale.
Demonstrated live during this design session: the plugin installed in this
very environment was at `0.3.0` while the registry already had `0.3.1`
published (bumped the day before) — nothing surfaced that gap.

The plugin already has a `SessionStart` hook slot declared in
`.claude-plugin/plugin.json`, referencing
`${CLAUDE_PLUGIN_ROOT}/hooks/scripts/suggest-harness.sh`. That file does not
exist (the `hooks/` directory itself is absent from the repo), and `.sh`
violates this project's own cross-platform convention (hooks must be
`.mjs` — see `.claude/memory/cross-platform-artifacts.md`). The slot has
been broken since it was declared. A graphify graph annotation on that node
indicates the original intent was two-fold: (a) suggest `/aia-harness:init`
when a target project has no harness yet, and (b) check for a newer plugin
version at most once per 24h. This design implements only (b); see
Non-goals.

## Goals

- On session start, check — at most once per 24h — whether a newer
  `aia-harness` version is published in the marketplace registry.
- If newer, update the installed copy on disk automatically. No command
  required from the user.
- Make sure the user finds out what happened, without them having to ask.
- Never add noticeable latency to normal session start, never block it,
  never surface an error to the user if the check fails for any reason.

## Non-goals (explicit, decided during brainstorming)

- **Per-command trigger.** Not wiring `UserPromptExpansion` alongside
  `SessionStart`. Session-start-only was chosen over "also check on every
  `/aia-harness:*` invocation" — the latter would need an empirical spike
  to confirm the real `command_name`/`command_source` payload shape for
  plugin-scoped commands (the official docs' only example is not
  plugin-scoped) and would add a hook type this project's own
  `lib/validate/hook-schema.mjs` doesn't cover yet. Not worth it: a 24h
  throttle already makes "checked once at the start of your session" and
  "checked on your first command" practically equivalent for a CLI tool.
- **`/aia-harness:init` suggestion.** The other original duty of the
  broken hook slot (nudge projects with no harness yet) is a distinct
  concern — project diagnosis, not plugin self-update — left for a
  separate task.
- **Same-session hot-reload with zero user action.** Confirmed not
  possible on the platform: `claude plugin update` itself documents
  "restart required to apply," and `/reload-plugins` is a human-typed REPL
  command — nothing in the agent's tool surface can invoke a CLI slash
  command the way it can invoke a plugin skill. The model cannot apply the
  update to its own running session; the best achievable is silently
  updating the files on disk and telling the user what to run next.

## Platform facts this design relies on

All verified empirically in this session (commands actually run, raw docs
fetched directly), not assumed from training knowledge or take a research
agent's summary at face value — two independent research agents disagreed
with each other and with this project's own CLAUDE.md on hook coverage, so
every load-bearing claim below was independently confirmed before being
designed around:

- `claude plugin update <plugin>@<marketplace>` and
  `claude plugin marketplace update <marketplace>` are real, non-interactive
  CLI subcommands (`claude plugin --help`), distinct from the interactive
  `/plugin` TUI menu. Both were actually run against this environment's real
  marketplace during this session.
- `claude plugin update` documents "restart required to apply" — mid-session
  hot-apply is impossible regardless of trigger mechanism.
- Third-party/local marketplaces (this plugin's own `leandro-plugins-registry`)
  have auto-update-at-startup **off** by default (only official Anthropic
  marketplaces default to on). This is the root cause of the staleness going
  unnoticed — nothing was ever refreshing it.
- `claude plugin list --json` returns each installed plugin's `id`
  (`<name>@<marketplace>`) and installed `version` in one call.
- After `claude plugin marketplace update <marketplace>`, the refreshed
  registry clone lives at `~/.claude/plugins/marketplaces/<marketplace>/`,
  and this plugin's manifest is readable directly at
  `plugins/aia-harness/.claude-plugin/plugin.json` inside that clone
  (verified: read `0.3.1` after refresh, matching the true published
  version).
- `${CLAUDE_PLUGIN_DATA}` is a documented, sanctioned, persists-across-updates
  per-plugin state directory (`code.claude.com/docs/en/plugins-reference`) —
  the right home for the throttle cache file.
- `UserPromptExpansion` is a real hook event (confirmed against the raw
  official docs, not a summarized fetch) but isn't yet covered by this
  project's `lib/validate/hook-schema.mjs`, which currently documents 14
  hook types — the platform now has more (`TaskCreated`, `ConfigChange`,
  `FileChanged`, etc.). Moot for this design since it isn't used here, but
  worth a separate note: this repo's own hook-type table in `CLAUDE.md` is
  stale relative to the platform.

## Design

### 1. Trigger & rate-limiting

`SessionStart` hook declared in this plugin's own `.claude-plugin/plugin.json`
(not `templates/hooks/` — that tree is for target projects, a different
concern). No matcher (fires on `startup`/`resume`/`clear`/`compact` alike) —
the 24h cache is the real throttle, so narrowing the matcher buys nothing.

- Script: `hooks/scripts/check-plugin-update.mjs`.
- Hook entry (exec-form, cross-platform, replacing the current shell-form
  entry):

  ```json
  {
    "type": "command",
    "command": "node",
    "args": ["${CLAUDE_PLUGIN_ROOT}/hooks/scripts/check-plugin-update.mjs"],
    "timeout": 20
  }
  ```

- Cache file: `${CLAUDE_PLUGIN_DATA}/update-check.json`, shape
  `{ "lastCheckedAt": "<ISO 8601>", "lastKnownVersion": "<semver>" }`. If
  `lastCheckedAt` is within 24h of now, the hook exits 0 immediately — no
  subprocess, no network, no file access beyond this one read.

### 2. Version check mechanics

All via the sanctioned `claude` CLI — no hand-rolled fetch of marketplace
data:

1. Run `claude plugin list --json`; find the entry whose `id` starts with
   `aia-harness@`. This gives the installed `version` and the marketplace
   name (the `@`-suffix) in one call — the marketplace name is *not*
   hardcoded, since a user could in principle have added the marketplace
   under a different local alias.
2. Run `claude plugin marketplace update <marketplace>` to refresh that
   marketplace's local cache.
3. Read
   `~/.claude/plugins/marketplaces/<marketplace>/plugins/aia-harness/.claude-plugin/plugin.json`
   directly (file read, no subprocess) for the latest published `version`.
   The `plugins/aia-harness/...` path is this project's own, self-controlled
   convention (both the plugin repo and the registry repo share the same
   author) — hardcoding it here is a deliberate simplification, not a
   generic marketplace-manifest parser, since the alternative (reading the
   marketplace's own `marketplace.json` to discover the path per-entry)
   buys no real robustness for a registry we already control.
4. Compare versions with a small hand-rolled semver comparator (`MAJOR.MINOR.PATCH`,
   numeric compare per segment) — three numbers don't need a dependency.
5. If the marketplace version is newer: run
   `claude plugin update aia-harness@<marketplace>` (writes the new version
   to the plugin's cache dir on disk; does not affect the currently-running
   session's already-loaded code).
6. Write the cache file with a fresh `lastCheckedAt` in every case — success,
   "already up to date," or failure — so the 24h throttle holds regardless
   of outcome.

### 3. Notifying the user

Only when an update was actually applied in step 5 above, the hook's stdout
JSON sets:

```json
{
  "hookSpecificOutput": {
    "hookEventName": "SessionStart",
    "additionalContext": "aia-harness was auto-updated in the background from <old> to <new>. Tell the user, and suggest running /reload-plugins (or starting a new session) to pick it up."
  }
}
```

Claude sees this alongside the next turn and tells the user proactively —
the closest possible approximation of "fully automatic" given the model
cannot invoke `/reload-plugins` itself. If no update was applied (already
current, or the check was throttled), the hook emits nothing at all —
silent by default.

### 4. Fail-open error handling (mandatory, matches existing project convention)

Every external call — subprocess spawn, file read, JSON parse — wrapped in
try/catch. Any failure (offline, `claude` unresolvable on `PATH`, a hung
subprocess, malformed JSON, a permission error writing the cache) results
in exit 0 with no output. Session start is never blocked and no error is
ever surfaced to the user, mirroring the existing fail-open pattern in
`.claude/hooks/validate-settings-schema.mjs`. The hook's own `timeout: 20`
is a backstop against a hung subprocess chain.

### 5. Fixing the existing broken hook slot

The current shell-form entry (pointing at the nonexistent `.sh`) is
*replaced* by the exec-form entry in §1 — same slot, not an addition
alongside a broken one.

### 6. Testing

`check-plugin-update.mjs` is structured so the decision logic — given
installed version, marketplace version, `lastCheckedAt`, and "now" — returns
`{ shouldCheck, shouldUpdate }` as a pure, exported, unit-testable function,
kept separate from the IO (subprocess calls, file access). This mirrors this
repo's own `lib/` purity convention even though the file lives under
`hooks/`, not `lib/`.

New `tests/hook-check-plugin-update.test.mjs` (node:test, matching this
repo's existing test style) covers:

- Throttle logic: within 24h skips, outside 24h proceeds.
- Version comparison: newer / equal / older (including installed-newer-than-registry,
  e.g. local dev builds — must not "downgrade").
- Fail-open behavior: simulated subprocess/file failures still produce a
  valid `SessionStart` output (or no output), validated against
  `validateSessionStartOutput` from `lib/validate/hook-schema.mjs`. No new
  validator is needed — `SessionStart` is already one of the 14 covered
  event types.

## Files touched

- Modify: `.claude-plugin/plugin.json` (`hooks.SessionStart[0].hooks[0]`).
- Create: `hooks/scripts/check-plugin-update.mjs`.
- Create: `tests/hook-check-plugin-update.test.mjs`.

## Decisions made during brainstorming (for the record)

- Automation level: silently write the update to disk automatically, then
  notify — not detect-only. (User initially chose "maximum automatic,
  including self-reload"; corrected during the session once it was
  confirmed the model cannot invoke `/reload-plugins` itself. Silent
  auto-write + notify is the actual ceiling.)
- Trigger granularity: `SessionStart` only, not per-command.
- Scope: update-check only, not bundled with the `/aia-harness:init`
  suggestion.
