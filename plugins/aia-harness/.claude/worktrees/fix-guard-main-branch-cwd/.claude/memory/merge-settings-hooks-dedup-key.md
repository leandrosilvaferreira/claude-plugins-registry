---
name: merge-settings-hooks-dedup-key
description: mergeSettingsHooks dedups hooks by exact {command,args} string — apply never repairs an existing hook's value, only adds missing ones
metadata:
  type: architecture
---

`mergeSettingsHooks` (`lib/apply.mjs`) is what `apply --only=settings` (non-force) uses
to merge a freshly-generated `settings.json` into an existing one. Its `hookKey`
identity is `JSON.stringify({command, args})` (normalized for placeholder bracing since
[[hook-placeholder-braces]] — see `normalizePlaceholders` — but that only fixes
false-duplicate-detection, nothing about value precedence). When a key already exists,
**the existing entry always wins**; the incoming one is silently dropped, never used to
overwrite.

**Consequence:** `apply` is an *additive* merge tool, never a *repair* tool. If an
existing hook's `args` value is wrong in any way (a stale path, a bug like a missing
placeholder brace, an outdated flag), re-running `apply` — even with the generator
already fixed — will **not** fix it. The only way to fix an existing hook's value is a
direct `Edit` on `settings.json` itself (or `--force`, which wholesale-overwrites the
entire file, destroying any user customization beyond what aia-harness manages).

**Why this matters:** it's tempting to assume "re-apply settings" fixes any hook-wiring
drift. It only ever adds hooks the target doesn't have yet. `commands/doctor.md`'s
"Hook placeholder hygiene" bullet exists specifically because of this — it fixes
placeholder-bug hooks via `Edit`, explicitly documenting why `apply --only=settings`
would be wrong there (before the dedup-key normalization fix it would add a *duplicate*
hook; after that fix it just silently does nothing to the broken one).

**How to apply:** before recommending `apply --only=<category>` as a fix for anything in
`doctor.md` or elsewhere, check whether the artifact uses `mergeStrategy:"merge-hooks"`
(currently only `settings`). If so, `apply` can only ADD missing hooks — repairing an
existing hook's value always requires a direct `Edit`.
