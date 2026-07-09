---
name: hook-stdin-null-crash
description: The repo-wide try{JSON.parse(readStdin()||"{}")}catch{exit(0)} hook idiom does not guard against literal JSON `null` on stdin — crashes with exit 1
metadata:
  type: architecture
---

Every hook in `templates/hooks/` (and the sibling copies dogfooded in `.claude/hooks/`)
parses stdin with the idiom:

```js
let event = {};
try {
  event = JSON.parse(readStdin() || "{}");
} catch {
  process.exit(0);
}
```

`JSON.parse("null")` returns the JS value `null` without throwing (`null` is valid
JSON) — so the `catch` never fires, `event` becomes `null`, and the first property
access on it (`event.hook_event_name`, `event.cwd`, etc.) throws an uncaught
`TypeError`. Node's default uncaught-exception exit code is 1, silently violating
this repo's own "hooks exit 0 or 2 only" mandatory rule (`.claude/rules/hook-output-schema.md`)
via a crash rather than an explicit `process.exit()` call.

**Why this matters:** discovered while implementing `templates/hooks/worktree-remove.mjs`
(2026-07) — the implementer traced it, then confirmed via `git stash` that the identical
byte-for-byte gap already existed in the just-shipped `templates/hooks/worktree-create.mjs`
and by extension in every other existing hook sharing this exact idiom
(`worktree-write-guard.mjs`, `worktree-session-ctx.mjs`, `large-file-warning.mjs`, etc.) —
it is a repo-wide latent pattern, not something introduced by any single hook. Real Claude
Code hook invocations always send a JSON *object* per every documented event schema, so
this is unlikely to fire in practice — but a malformed/adversarial invocation, or a test
harness sending a bare `null`, would crash any hook using this idiom.

**How to apply:** don't fix this piecemeal in one or two hook files — that creates
inconsistency with the other ~10 hooks sharing the same idiom without addressing the
actual shared risk. If/when this gets fixed, it should be a single, repo-wide change
(e.g. a shared `readEvent()` helper in a common module, or an explicit `typeof parsed ===
"object" && parsed !== null` guard added to the idiom everywhere at once), not a one-off
patch. Until then, treat "literal `null` on stdin" as a known, accepted gap across the
whole hook fleet — not a defect specific to whichever hook you're currently reviewing.
