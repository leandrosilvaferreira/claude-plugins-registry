---
name: sync-vendored
description: Refresh vendored third-party assets (ECC + tools) from their pinned upstream commits, review the provenance diff, and re-verify the repo. Use when bumping the pinned commit in scripts/ecc-source.json or scripts/tools-source.json, or when asked to update/re-pull vendored content under templates/ecc or templates/tools. Runs network fetches and writes files — user-invoked only.
disable-model-invocation: true
---

# Sync vendored assets

Re-fetches the third-party agents/skills/rules that aia-harness vendors, then
gates the result with a provenance audit and the test suite. This **touches the
network and rewrites files under `templates/`** — run it deliberately, review
the diff, never blind-commit.

## Procedure

1. **Confirm the pins.** Show the current pinned source(s) so the user knows
   what they're fetching:

   ```bash
   cat scripts/ecc-source.json scripts/tools-source.json
   ```

   If the intent is to *upgrade*, edit the `commit` (and repo/path if needed)
   in the relevant `*-source.json` first, then continue.

2. **Run the sync.** One or both, depending on what changed:

   ```bash
   npm run sync:ecc     # re-vendors templates/ecc/ from scripts/ecc-source.json
   npm run sync:tools   # re-vendors templates/tools/ from scripts/tools-source.json
   ```

3. **Review the diff.** Vendored content is fetched code — read it.

   ```bash
   git status --porcelain templates/ecc templates/tools
   git diff -- templates/ecc templates/tools
   ```

   Confirm provenance stamps updated, `templates/ecc/MANIFEST.json` matches the
   files on disk, and `templates/ecc/LICENSE` is intact.

4. **Audit the supply-chain boundary.** Dispatch the `vendor-provenance-auditor`
   subagent on the changed paths. It checks for missing stamps, commit
   mismatches against the pins, stripped licenses, secret shapes, and
   surprising network/exec calls. Resolve any FAIL/BLOCK before proceeding.

5. **Verify the repo.**

   ```bash
   npm test   # typecheck + lint + unit
   ```

   The catalog/transform tests (`tests/ecc-*.test.mjs`, `tests/tools-*.test.mjs`)
   must stay green; a break usually means upstream changed shape and a transform
   or catalog mapping needs updating.

## Done means

`npm test` green, `vendor-provenance-auditor` returns CLEAN, the diff is
human-reviewed, and the pin commits in `scripts/*-source.json` match the stamps
in the vendored files. Then it's safe to commit (e.g. `chore: sync vendored ECC
to <commit>`).
