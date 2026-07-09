---
name: cpsync-dereference-not-recursive
description: fs.cpSync's dereference:true only dereferences the top-level src argument, not symlinks found while walking a directory's contents during a recursive copy — confirmed empirically on Node v24
metadata:
  type: architecture
---

`fs.cpSync(src, dest, { recursive: true, dereference: true })` does **not** dereference
a symlink nested inside `src`'s directory tree — it survives the copy as a symlink,
still pointing at its original (pre-copy) absolute target. `dereference: true` only
affects whether the top-level `src` argument itself is dereferenced, if `src` is a
symlink. Confirmed empirically (not just from reading docs) with three isolated
`node -e` trials on Node v24.17.0, all consistent: a file `src/link.txt` symlinked to
`src/real.txt`, copied via `cpSync(src, dst, { recursive: true, dereference: true })`
(with and without `mode: COPYFILE_FICLONE`, and with `dereference: false`/omitted for
comparison) — `dst/link.txt` was **still a symlink** in every trial. Separately
confirmed that when `src` itself IS a symlink (pointing at a real directory),
`dereference: true` DOES correctly copy it as a real directory, not a symlink — so the
option isn't a no-op, its effective scope is just narrower than "recursively
dereference everything," which is the natural reading of the option name and how at
least one other project's own hook comment (mis)described it before this was caught.

**Why this matters:** `templates/hooks/worktree-create.mjs` copies `node_modules` from
a project root into each new git worktree, isolated (never symlinked, to avoid
parallel-test-run races on shared scratch state). npm always creates
`node_modules/.bin/*` entries as **absolute-path** symlinks into the real package
(e.g. `.bin/vitest -> /abs/path/root/node_modules/vitest/vitest.mjs`), never relative
ones. Trusting `dereference: true` on the top-level `cpSync` call to close this gap
does nothing — every worktree's `.bin/*` keeps silently pointing at the ROOT's copy.
The running binary then resolves its own transitive deps from root's node_modules,
while files loaded FROM the worktree by path (setupFiles, test files) resolve theirs
from the worktree's own copy: two separate module instances of the same package in one
process, so state one sets (e.g. jest-dom's `expect.extend`) is invisible to the other.
This exact failure mode was hit and fixed (via `npm rebuild`, then a `dereference: true`
code fix) in another project (`eve-poc`) — but that fix's own governing comment claimed
"`dereference: true` copies the symlinks' target bytes instead of the link, closing the
gap for every `.bin/*` entry," which the empirical trials above show is not actually
true for a recursive directory copy. Porting that fix into this repo and adding a
regression test (`fs.lstatSync(copiedBinEntry).isSymbolicLink()` must be `false`) caught
that the "fix" didn't fix anything, before it shipped.

**How to apply:** to recursively dereference every symlink in a directory tree copy
(not just the top-level `src`), don't reach for `fs.cpSync`'s `dereference` option — it
won't do it. Use a manual recursive walk instead: `fs.statSync` (not `lstatSync`)
already follows symlinks for type detection; `fs.copyFileSync(symlinkPath, dest, mode)`
correctly copies a symlink's *target content* as a real file (also confirmed
empirically) — so a small recursive function (`stat` → if directory, `mkdirSync` +
recurse over `readdirSync`; if file, `copyFileSync`) gets full dereferencing at every
depth. See `copyDereferenced()` in `templates/hooks/worktree-create.mjs` for the
implementation this repo uses. Any other code in this repo (or a future one) that needs
a "fully isolated, no-symlinks-anywhere" directory copy has the same trap waiting.
