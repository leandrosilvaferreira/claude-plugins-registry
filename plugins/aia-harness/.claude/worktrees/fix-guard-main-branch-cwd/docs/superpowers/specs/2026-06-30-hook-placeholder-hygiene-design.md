# Design: hook-placeholder hygiene detection + guided fix

**Date:** 2026-06-30
**Status:** Approved

## Summary

Claude Code hook entries that use exec form (`args` array present) spawn the
command directly with no shell. In exec form, Claude Code only substitutes
the **braced** form of its path placeholders (`${CLAUDE_PROJECT_DIR}`,
`${CLAUDE_PLUGIN_ROOT}`, `${CLAUDE_PLUGIN_DATA}`) into `args` elements — a
**bare** `$CLAUDE_PROJECT_DIR` (no braces) is passed through literally and
`node` throws `MODULE_NOT_FOUND` trying to resolve it as a relative path.
This exact bug was just found and fixed in aia-harness's own dogfood
`.claude/settings.json` (introduced by a hand-edit that migrated shell-form
hooks to exec-form but kept the old, shell-only-safe bare syntax).

Any project this plugin has already scaffolded — or any project with hand-
or AI-edited hooks — can carry the same mistake, silently, since a broken
hook just logs a debug error and the session continues. This feature adds a
deterministic detector for the bug, a `scan` warning so it's visible even to
users who never run `doctor`, and a `doctor` audit step that offers a
targeted, consent-gated fix.

## Goals

- Deterministically detect exec-form hook `args` entries using a bare
  (unbraced) `$CLAUDE_PROJECT_DIR` / `$CLAUDE_PLUGIN_ROOT` /
  `$CLAUDE_PLUGIN_DATA` in a project's `.claude/settings.json`.
- Surface it in `scan` (report + `--json`) as a warning, even if the user
  never runs `doctor`.
- Offer a guided, consent-gated fix in `doctor`, matching the project's
  existing "show diff, get approval, `Edit`" convention.
- Unit-test the detector directly (pure function, fixture strings, no I/O).
- Fix the related `mergeSettingsHooks` dedup fragility this bug exposed: its
  identity key is the exact `{command, args}` string, so a bare and a
  braced form of the same hook hash differently — re-running
  `apply --only=settings` on an affected project would add a **duplicate**
  hook rather than recognize it as already present. Normalize the key so
  bracing differences don't cause false-duplicate-detection.

## Non-goals

- Auto-fixing without user confirmation (violates the project's consent-gate
  invariant — see `commands/doctor.md` step 4: "show a diff and apply with
  `Edit` only after the user approves").
- Fixing the actual broken hook via `apply --only=settings`. Even after the
  `mergeSettingsHooks` key-normalization fix (in scope, see Architecture
  §6), a bare-form existing hook still survives a re-apply unchanged —
  normalizing the key only stops a *duplicate* from being added; the merge
  logic still leaves the existing (broken) entry's *value* untouched by
  design ("existing wins" — see §6). Repairing the value requires the
  targeted `Edit` in the doctor flow (§4); `apply` is not a repair path
  here or in general.
- Redesigning `mergeSettingsHooks`'s existing/incoming value precedence
  ("existing wins"). That's intentional, tested behavior protecting a
  user's own customizations (e.g. a hand-tuned `timeout`) from being
  clobbered by a routine re-apply. §6 only changes what counts as "the same
  hook" for dedup purposes — never which side's value survives.
- A general-purpose hook/settings.json linter. This detects exactly the one
  bug class described above, nothing broader (no schema re-validation — that
  already exists via `validate-settings-schema.mjs` and can't express this
  semantic rule anyway; a JSON Schema has no notion of "this string should
  contain a braced placeholder").
- Checking `command` (shell-form, no `args`) strings. Bare `$VAR` is
  correct and expected there — that form runs through a real shell, and
  bash expands `$VAR`/`${VAR}` identically. Only `args` elements (exec
  form, no shell) are affected.

---

## Architecture

### 1. Detector — `lib/detect/hook-hygiene.mjs` (new)

Pure function, no I/O, mirrors the shape of `lib/detect/github-pm.mjs`:

```js
/**
 * @param {unknown} settingsJson  Already-parsed .claude/settings.json content
 * @returns {{ event: string, matcher: string, script: string, arg: string, placeholder: string }[]}
 */
export function detectHookPlaceholderIssues(settingsJson) { ... }
```

- Walks `settingsJson.hooks[event][].hooks[]`.
- For each hook object with a non-empty `args` array (exec form —
  `command` alone, no `args`, is shell-form and never flagged), tests each
  `args[i]` string against:
  `/\$(?!\{)(CLAUDE_PROJECT_DIR|CLAUDE_PLUGIN_ROOT|CLAUDE_PLUGIN_DATA)\b/`
  (a `$` NOT immediately followed by `{`, then one of the three names).
- Returns one entry per match: `{ event, matcher, script, arg, placeholder }`
  — `script` is `arg.split("/").pop()` for a human-readable report line,
  `placeholder` is which of the three variables matched.
- Malformed/missing `hooks` key, non-object input, or anything that isn't
  the expected shape → return `[]`. This function never throws; the caller
  is responsible for `JSON.parse` and catching parse errors.

### 2. Wiring into scan — `lib/detect/index.mjs`

Read the target's own `.claude/settings.json` (if `profile.existing.settings`
is true), `JSON.parse` it (swallow parse errors → skip, same fail-open
posture as `validate-settings-schema.mjs`), run the detector, and populate:

```js
profile.hookHygiene = {
  placeholderIssues: [ ...detector output... ],
}
```

New `HookHygieneInfo` typedef in `lib/profile.mjs`, following the existing
`TestingInfo` / `LargeFilesInfo` pattern (own named profile field, populated
after the main file walk).

### 3. Scan report + `--json`

When `placeholderIssues.length > 0`, add a warning block to the human-
readable scan report (same section style as the existing testing/large-files
notes) and include the field verbatim in `--json` output:

```text
⚠ 3 hook(s) in .claude/settings.json use a bare $CLAUDE_PROJECT_DIR instead
  of ${CLAUDE_PROJECT_DIR} — Claude Code only expands the braced form in
  exec-form hooks (no shell), so these will throw MODULE_NOT_FOUND. Run
  /aia-harness:doctor to fix.
```

When empty, scan says nothing (matches existing "silent when clean" pattern
used by e.g. the GitHub PM section).

### 4. Doctor audit + guided fix — `commands/doctor.md`

New bullet under step 3, styled after the existing "Graphify orientation
hook (settings.json)" bullet (same file, reads a `scan --json` field and
offers a merge-only fix):

> **Hook placeholder hygiene (settings.json):** Read `profile.hookHygiene.
> placeholderIssues` from the `scan --json` output. If non-empty, list each
> affected hook (`script`, the offending `arg`) and show the exact fix (add
> braces around the placeholder name — nothing else changes). After the user
> approves, fix with `Edit` directly on `.claude/settings.json` — **not**
> `apply --only=settings`: `mergeSettingsHooks` dedups hooks by exact
> `{command, args}` string identity, so re-applying would add a duplicate
> hook rather than replace the broken one. If the list is empty, say
> nothing.

This follows the file's own closing instruction (step 4): "For each
accepted fix, show a diff and apply with `Edit` only after the user
approves. Do not rewrite files wholesale."

### 5. Tests — `tests/detect-hook-hygiene.test.mjs` (new)

Fixture-based, no filesystem, matching `tests/detect-github-pm.test.mjs`'s
style for the hand-built-object tests:

- Bare `$CLAUDE_PROJECT_DIR` in an `args` element → 1 issue, correct
  `script`/`arg`/`placeholder` fields.
- Braced `${CLAUDE_PROJECT_DIR}` → 0 issues.
- Bare placeholder inside a shell-form hook (`command` string, no `args`
  key at all) → 0 issues (shell form is exempt).
- All three placeholder names (`CLAUDE_PROJECT_DIR`, `CLAUDE_PLUGIN_ROOT`,
  `CLAUDE_PLUGIN_DATA`) individually detected.
- A string containing an unrelated `$SOMETHING_ELSE` → 0 issues (name list
  is exact, not a wildcard).
- Multiple issues across different events/matchers in one settings object
  → all returned, not just the first.
- `{}`, `{ hooks: null }`, `{ hooks: "not an object" }` → `[]`, no throw.

### 6. `mergeSettingsHooks` dedup-key normalization — `lib/apply.mjs`

The current `hookKey`:

```js
const hookKey = (h) => JSON.stringify({ command: h.command, args: h.args });
```

hashes the raw `args` strings verbatim, so a bare and braced form of the
same script are different keys and both survive a merge (duplicate). Fix by
normalizing placeholder bracing **inside the key computation only** — the
stored hook object (existing or incoming) is never rewritten by this
function, only which key it's filed under:

```js
/** @param {unknown} v */
function normalizePlaceholders(v) {
  if (typeof v !== "string") return v;
  return v.replace(
    /\$(?!\{)(CLAUDE_PROJECT_DIR|CLAUDE_PLUGIN_ROOT|CLAUDE_PLUGIN_DATA)\b/g,
    "${$1}",
  );
}

/** @param {{ command?: unknown, args?: unknown }} h */
const hookKey = (h) =>
  JSON.stringify({
    command: normalizePlaceholders(h.command),
    args: Array.isArray(h.args) ? h.args.map(normalizePlaceholders) : h.args,
  });
```

Effect: a bare-form existing hook and a braced-form incoming hook for the
same script now hash identically, so the incoming one is recognized as
already present and is **not** added — no duplicate. "Existing wins" is
unaffected: the survivor is still whichever object was already in
`exHooks`, byte-for-byte, unchanged. This function's only job is answering
"is this the same hook," not "which version should win."

**Test** (added to `tests/plan-apply.test.mjs`, alongside the existing
`mergeSettingsHooks: duplicate hook entry → appears only once` case):

```js
test("mergeSettingsHooks: bare vs braced placeholder in args → recognized as same hook, no duplicate", () => {
  const existingHook = { command: "node", args: ["$CLAUDE_PROJECT_DIR/.claude/hooks/x.mjs"] };
  const incomingHook = { command: "node", args: ["${CLAUDE_PROJECT_DIR}/.claude/hooks/x.mjs"] };
  const existing = JSON.stringify({ hooks: { PostToolUse: [{ matcher: "*", hooks: [existingHook] }] } });
  const incoming = JSON.stringify({ hooks: { PostToolUse: [{ matcher: "*", hooks: [incomingHook] }] } });

  const result = JSON.parse(mergeSettingsHooks(existing, incoming));
  const merged = result.hooks.PostToolUse[0].hooks;
  assert.equal(merged.length, 1, "bare and braced forms of the same hook must not both survive");
  assert.deepEqual(merged[0], existingHook, "existing (bare) form still wins the slot — merge only dedups identity, never rewrites values");
});
```

---

## Data flow

```text
.claude/settings.json (target project, already on disk)
        │  JSON.parse (lib/detect/index.mjs, fail-open on parse error)
        ▼
detectHookPlaceholderIssues()  (lib/detect/hook-hygiene.mjs, pure)
        │
        ▼
profile.hookHygiene.placeholderIssues[]
        │
        ├──► scan report + scan --json   (warning, visible without doctor)
        │
        └──► doctor.md step 3 bullet ──► AskUserQuestion / diff ──► Edit
                                          (consent-gated, surgical fix)
```

## Out of scope / follow-ups

- Retroactively fixing already-scaffolded target projects that never run
  `doctor` — this is detection + guided fix, not a push mechanism. A user
  must run `scan` or `doctor` to learn about it.
- Generalizing `mergeSettingsHooks` identity beyond placeholder-bracing
  normalization (e.g. keying purely by script name, ignoring the rest of
  `args`) — a broader change to hook identity semantics than this bug
  requires; would need its own design if a future bug motivates it.
