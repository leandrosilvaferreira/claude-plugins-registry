#!/usr/bin/env node
/**
 * Detached worktree seeder — the slow half of the WorktreeCreate flow.
 *
 * templates/hooks/worktree-create.mjs creates the worktree itself (fast:
 * `git worktree add`) and reports its path back to Claude Code immediately,
 * then spawns THIS script detached to do the potentially-slow copy work
 * (node_modules, .husky/_, .docker, graphify-out, .worktreeinclude) outside
 * that hook's own timeout window. This is a plain script, not a hook: it
 * reads no stdin, writes no hookSpecificOutput JSON, and the 0/2 hook
 * exit-code contract does not apply.
 *
 * Invoked as:
 *
 *   node worktree-seed.mjs <rootDir> <worktreeDir> [statePath]
 *
 * - rootDir      absolute path to the repo root to copy FROM.
 * - worktreeDir  absolute path to the worktree to copy INTO.
 * - statePath    optional absolute path to aia-seed.json. When present, this
 *                script rewrites it to {pid, status, startedAt, finishedAt}
 *                on completion, preserving startedAt from the existing file
 *                when readable. status is "done" only when every seeding
 *                block completed without a block-level failure; "failed"
 *                if any block's own copy/regen attempt threw (a per-entry
 *                skip inside one tree — a dangling symlink, one unreadable
 *                file — does NOT count: the tree still completed). A
 *                "failed" status is what makes worktree-create.mjs's
 *                idempotent re-seed safety net actually retry — the same
 *                unrecognized-status fall-through claimSeed already uses for
 *                a dead/missing claim. A missing/unwritable state path is
 *                logged, never fatal.
 *
 * Exits 0 always, except a usage error (missing argv), which exits 1. Every
 * seeding block below runs through guardBlock() so one block's failure can
 * never prevent the others — or the final state-file write — from running.
 */
import { execFileSync, spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const [, , rootDirArg, worktreeDirArg, statePathArg] = process.argv;
if (!rootDirArg || !worktreeDirArg) {
  process.stderr.write(
    "worktree-seed: usage: node worktree-seed.mjs <rootDir> <worktreeDir> [statePath]\n",
  );
  process.exit(1);
}

// Same roles as worktree-create.mjs's `cwd`/`dir`: cwd is the repo root to
// copy FROM, dir is the worktree to copy INTO. Kept as argv values here
// rather than derived from a stdin event, since this script runs standalone.
const cwd = rootDirArg;
const dir = worktreeDirArg;

// Set only by a REAL throw from a block's own core copy/regen attempt —
// node_modules's copy, `.docker`'s copy, graphify-out's copy, and husky's
// shim copy/regen (see the `.husky/_` block below) — plus guardBlock's own
// catch as the backstop for anything escaping a block entirely. This is
// what makes the final state write "failed" instead of "done", which is
// what makes worktree-create.mjs's claimSeed retry on the next EnterWorktree.
//
// Never set by: a per-entry skip inside one copy tree (copyDereferenced's
// own statSync/copyFileSync catches — a dangling symlink or one unreadable
// file, warned-and-skipped while the rest of that tree still completes);
// .worktreeinclude's per-listed-path catch (one path failing doesn't abort
// the others still copying); an ADVISORY post-condition like husky's "shim
// is still missing" check (when husky genuinely isn't installed, re-running
// the seeder can never fix that — see that block's own comment); or a block
// SKIPPED because its precondition isn't met YET, not never (husky's regen
// needs node_modules/husky/bin.js, which cannot exist the same run
// node_modules itself had to be installed fresh in the background — see
// `installSpawned`, below). All four are benign/expected and (except the
// last, new this round) already covered by their own tests. Marking any of
// them "failed" re-seeds an otherwise-fine project on every single
// EnterWorktree forever — a worse bug than a silently-skipped retry, which
// is what this flag exists to fix in the first place.
let failed = false;

// True once the node_modules block below had to spawn a backgrounded
// install instead of copying (root had no node_modules at all yet). Used by
// the `.husky/_` block to skip its own regen attempt entirely: regen needs
// node_modules/husky/bin.js, which cannot exist while that install is still
// running, so attempting it now can only fail — not because anything is
// broken, but because the precondition isn't met YET. Never waited on: the
// install is detached and unref'd by design, and it runs the project's own
// `prepare` script — the same mechanism that creates .husky/_ in the first
// place — so the install itself produces the shim once it finishes;
// blocking here to wait for it would undo the whole point of backgrounding
// it.
let installSpawned = false;

/**
 * Runs `fn`, warning to stderr and continuing (never throwing) if it fails.
 * Every seeding block below is invoked through this so one block's
 * unexpected failure can never prevent the others — or the final
 * state-file write — from running. Also marks the whole seed `failed` (see
 * above) — this is the backstop for anything that escapes a block's own
 * try/catch entirely.
 * @param {string} label
 * @param {() => void} fn
 */
function guardBlock(label, fn) {
  try {
    fn();
  } catch (err) {
    failed = true;
    process.stderr.write(
      `worktree-seed: WARNING — ${label} seeding failed unexpectedly: ${err instanceof Error ? err.message : String(err)}\n`,
    );
  }
}

/**
 * Package manager install command for a fresh `node_modules`, chosen by lockfile.
 * @param {string} d
 * @returns {{ cmd: string, args: string[] }}
 */
function detectInstallCommand(d) {
  if (fs.existsSync(path.join(d, "pnpm-lock.yaml"))) return { cmd: "pnpm", args: ["install"] };
  if (fs.existsSync(path.join(d, "yarn.lock"))) return { cmd: "yarn", args: ["install"] };
  if (fs.existsSync(path.join(d, "bun.lockb")) || fs.existsSync(path.join(d, "bun.lock")))
    return { cmd: "bun", args: ["install"] };
  return { cmd: "npm", args: ["install"] };
}

/**
 * Recursively copies `src` to `dest`, dereferencing every symlink
 * encountered — including ones nested inside subdirectories — instead of
 * preserving it. A single entry that can't be stat'd or copied (a dangling
 * symlink, a permission error, an exotic file type) is warned about and
 * skipped — it does NOT abort the rest of the tree. fs.cpSync's default
 * behavior (verbatim symlink copy, no throw on a dangling one) always
 * completes the whole tree; matching that resilience matters here because
 * copyDereferencedAtomic (below) treats "did this function throw" as "is the
 * copy unusable" — a single bad entry must not look like a total failure.
 *
 * fs.cpSync's own `dereference` option does NOT dereference recursively:
 * confirmed empirically (Node v24) that it only dereferences the top-level
 * `src` argument if THAT itself is a symlink — a symlink found while walking
 * a directory's contents during a recursive copy survives unchanged. That
 * matters here: npm always creates node_modules/.bin/* as absolute-path
 * symlinks into the real package (e.g. .bin/vitest -> <root>/node_modules/
 * vitest/vitest.mjs), never relative ones. A preserved symlink keeps every
 * worktree's .bin/* pointing at the ROOT's copy instead of its own — the
 * binary then resolves its own transitive deps from root's node_modules
 * while files loaded FROM the worktree (setupFiles, test files) resolve
 * theirs from the worktree's copy: two separate module instances of the
 * same package in one process, so state one sets (e.g. jest-dom's
 * `expect.extend`) is invisible to the other. This walks the tree manually
 * so every entry, at any depth, resolves to real file content instead.
 *
 * Uses COPYFILE_FICLONE per file — copy-on-write reflink where supported
 * (near-instant, space-efficient on APFS/Btrfs/XFS), silent fallback to a
 * full byte-copy otherwise — matching fs.cpSync's own `mode` semantics.
 * @param {string} src
 * @param {string} dest
 */
function copyDereferenced(src, dest) {
  /** @type {fs.Stats} */
  let st;
  try {
    st = fs.statSync(src); // follows symlinks, unlike lstatSync
  } catch (err) {
    process.stderr.write(
      `worktree-seed: WARNING — could not stat "${src}" (dangling symlink?), skipped: ${err instanceof Error ? err.message : String(err)}\n`,
    );
    return;
  }
  if (st.isDirectory()) {
    fs.mkdirSync(dest, { recursive: true });
    for (const entry of fs.readdirSync(src)) {
      copyDereferenced(path.join(src, entry), path.join(dest, entry));
    }
  } else {
    try {
      fs.copyFileSync(src, dest, fs.constants.COPYFILE_FICLONE);
    } catch (err) {
      process.stderr.write(
        `worktree-seed: WARNING — could not copy "${src}", skipped: ${err instanceof Error ? err.message : String(err)}\n`,
      );
    }
  }
}

/**
 * True if `pid` is a positive integer identifying a currently-running
 * process. Guards `Number.isInteger(pid) && pid > 0` before calling
 * `process.kill(pid, 0)` — the standard cross-platform "does this pid exist"
 * probe, which throws ESRCH (never actually signals) once it's gone —
 * because pid 0 and negative pids address process GROUPS on POSIX:
 * `process.kill(0, 0)` and `process.kill(-1, 0)` both succeed as long as ANY
 * process in that group exists (confirmed empirically, Node v24.17.0), which
 * would otherwise misread a corrupt/malformed pid in a `<dest>.tmp-<pid>`
 * directory name as a live process and never clean it up.
 * @param {unknown} pid
 * @returns {boolean}
 */
function isAlivePid(pid) {
  if (typeof pid !== "number" || !Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/**
 * Wraps copyDereferenced so the copy is atomic from every call site's point
 * of view: it lands at `dest` only once the WHOLE copy has finished, never
 * partially.
 *
 * This matters because every call site below guards re-seeding with
 * `!fs.existsSync(dest)` (skip if already seeded) so the idempotent
 * PostToolUse:EnterWorktree safety net doesn't redo finished work. Without
 * this wrapper, a copy interrupted mid-way — e.g. this hook's own process
 * killed by Claude Code's timeout partway through a large node_modules copy
 * on a non-reflink filesystem — leaves a PARTIALLY populated `dest` that
 * still satisfies that exists-check, so the safety net wrongly treats it as
 * "already done" and never finishes it. Copying into a temporary sibling
 * first and renaming into place only on success means an interrupted copy
 * leaves nothing at `dest` at all — the safety net correctly sees "not
 * seeded yet" next time and retries cleanly.
 * @param {string} src
 * @param {string} dest
 */
function copyDereferencedAtomic(src, dest) {
  // Remove orphaned tmp directories left by a previous seeder run that was
  // killed mid-copy before it could rename its own tmp dir into place. The
  // cleanup below used to be scoped to `${dest}.tmp-${process.pid}` (the
  // CURRENT pid only), so a run killed under a different pid left a
  // `<dest>.tmp-<oldpid>` directory — potentially node_modules-sized — that
  // nothing ever collected.
  //
  // This does NOT rely on "at most one live seeder per worktree" — the
  // spawning hook's claim file makes that true only when the claim itself
  // resolves and is honored correctly, and a second seeder CAN still end up
  // racing this one (a corrupt/lost claim file, a manual invocation, a bug
  // in the claim logic itself). A tmp dir whose pid is STILL ALIVE is
  // therefore treated as a live sibling's own staging area, not an orphan,
  // and left alone: deleting it out from under that sibling — while it is
  // mid-`readdirSync`/`copyFileSync` on the very same inodes — is exactly
  // how a double seed turns from merely wasteful into silently corrupting
  // `dest`. Only a tmp dir whose pid is dead, malformed, or non-positive is
  // removed here; a live sibling instead makes this run's own `renameSync`
  // below fail with ENOTEMPTY once the sibling finishes and renames first —
  // caught below, which also removes THIS run's own now-redundant tmp dir
  // before propagating the warning (see renameSync's own try/catch): a
  // losing run is the only party that can safely clean up what it staged,
  // since a sweep by anyone else is the exact mechanism that caused the
  // corruption this whole function guards against.
  //
  // Two real ceilings remain here, not chased further in this pass: a lost
  // rename still costs the full wasted copy time and I/O of the losing run
  // (the fix above only stops it from also costing the disk space
  // afterward), and pid reuse — a long-dead seeder's pid later reassigned
  // by the OS to an unrelated live process — can make a truly abandoned tmp
  // dir look live forever, leaking it permanently. Both are a leak/waste in
  // the failure direction, never corruption, which is the property that
  // actually matters here. Wrapped in try/catch — a missing parent
  // directory (e.g. `dest`'s own parent hasn't been created yet) must not
  // throw.
  try {
    const parent = path.dirname(dest);
    const escapedBase = path.basename(dest).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const orphanPattern = new RegExp(`^${escapedBase}\\.tmp-(\\d+)$`);
    for (const entry of fs.readdirSync(parent)) {
      const m = orphanPattern.exec(entry);
      if (!m) continue;
      if (isAlivePid(Number(m[1]))) continue; // a live sibling is still staging here — not an orphan
      fs.rmSync(path.join(parent, entry), { recursive: true, force: true });
    }
  } catch {
    /* missing parent directory, permission issue, etc. — not fatal */
  }

  const tmp = `${dest}.tmp-${process.pid}`;
  fs.rmSync(tmp, { recursive: true, force: true });
  copyDereferenced(src, tmp);
  try {
    fs.renameSync(tmp, dest);
  } catch (err) {
    // Lost the rename race to a sibling that finished first (`dest` already
    // exists) — our own tmp dir is now dead weight nobody else will safely
    // collect (see the sweep's own comment above), so remove it ourselves
    // before propagating the same warning the caller already expects.
    fs.rmSync(tmp, { recursive: true, force: true });
    throw err;
  }
}

// node_modules: isolated copy, never a symlink — gated on package.json so a
// non-Node project never attempts this block. Vitest/Vite write scratch state
// into node_modules/.vite-temp; a symlinked node_modules shares that dir
// between root and every worktree, so parallel test runs race on it (one
// process removes/renames it while another reads/writes). Trade-off
// accepted: root `npm install` no longer propagates to already-live
// worktrees — run it inside the worktree itself for a new dependency.
// copyDereferencedAtomic (not fs.cpSync) — see its own doc comment for why.
guardBlock("node_modules", () => {
  if (fs.existsSync(path.join(cwd, "package.json"))) {
    const rootModules = path.join(cwd, "node_modules");
    const wtModules = path.join(dir, "node_modules");
    if (fs.existsSync(rootModules)) {
      if (!fs.existsSync(wtModules)) {
        try {
          copyDereferencedAtomic(rootModules, wtModules);
        } catch (err) {
          failed = true;
          process.stderr.write(
            `worktree-seed: WARNING — node_modules copy failed: ${err instanceof Error ? err.message : String(err)}\n`,
          );
        }
      }
    } else if (!fs.existsSync(wtModules)) {
      // No root node_modules to copy — install fresh, backgrounded so this hook
      // doesn't block the session on a full install. shell:true is scoped to
      // Windows only: npm/pnpm/yarn/bun resolve to .cmd shims there, which
      // spawn() cannot invoke without a shell (Node's own documented mechanism
      // for this case). cmd/args here are hardcoded by this file, not derived
      // from external input, so this carries none of the injection risk the
      // hooks-cross-platform.md "no shell form" rule targets (that rule is about
      // a hook's own top-level settings.json invocation, a different case).
      installSpawned = true; // tells the .husky/_ block below to skip its own regen attempt
      const { cmd, args } = detectInstallCommand(cwd);
      const child = spawn(cmd, args, {
        cwd: dir,
        stdio: "ignore",
        detached: true,
        windowsHide: true,
        shell: process.platform === "win32",
      });
      child.on("error", (err) => {
        process.stderr.write(
          `worktree-seed: WARNING — background ${cmd} install failed to start: ${err.message}\n`,
        );
      });
      child.unref();
    }
  }
});

// .husky/_: Husky's generated shim (from `npm run prepare`/`husky`), ignored via
// its own .husky/_/.gitignore — git worktree only materializes tracked content,
// so a new worktree never inherits it. Gated on the root .husky dir existing at
// all, so a project that doesn't use Husky never triggers this block or its
// warning. Without the shim, core.hooksPath points at an empty dir and git
// silently skips pre-commit/pre-push there. Never symlink: a shared inode means
// one worktree regenerating it (via `npm install`/`prepare`) can race with
// another mid-commit/push.
guardBlock(".husky/_", () => {
  if (fs.existsSync(path.join(cwd, ".husky"))) {
    if (installSpawned) {
      // Regeneration below needs node_modules/husky/bin.js, which cannot
      // exist yet — the node_modules block just spawned a background install
      // instead of finding root node_modules to copy. That install runs the
      // project's own `prepare` script (the same mechanism that creates
      // .husky/_ in the first place), so it will produce the shim once it
      // finishes; attempting regen NOW can only fail, and warning that git
      // hooks are inactive would be actively wrong the moment the install
      // catches up. Not a failure — see `installSpawned`'s own comment.
      // Nested inside the `.husky` existence check above so this note only
      // ever fires for a project that genuinely uses husky — a JS project
      // with package.json but no .husky dir must see nothing from this block.
      process.stderr.write(
        "worktree-seed: .husky/_ regeneration deferred — node_modules is still installing " +
          "in the background and will create it via the project's own prepare script.\n",
      );
      return;
    }
    const wtHuskyShim = path.join(dir, ".husky", "_");
    if (!fs.existsSync(wtHuskyShim)) {
      const rootHuskyShim = path.join(cwd, ".husky", "_");
      if (fs.existsSync(rootHuskyShim)) {
        try {
          copyDereferencedAtomic(rootHuskyShim, wtHuskyShim);
        } catch {
          // A real, retryable failure (e.g. EACCES) — see the post-condition
          // check below for the single unified warning; this flag is what
          // makes the next EnterWorktree actually retry it.
          failed = true;
        }
      } else if (fs.existsSync(path.join(dir, ".husky"))) {
        // Invoke husky's JS entrypoint directly via node — never `npx` as the
        // spawn command (npx is a .cmd shim on Windows, not directly
        // executable without a shell). Missing bin.js (e.g. a Husky major
        // version with a different entry) falls through to the advisory
        // warning below WITHOUT setting `failed` — see that check's own
        // comment for why a missing bin.js is terminal, not retryable.
        try {
          const huskyBin = path.join(dir, "node_modules", "husky", "bin.js");
          if (fs.existsSync(huskyBin)) {
            execFileSync("node", [huskyBin], { cwd: dir, stdio: "ignore", windowsHide: true });
          }
        } catch {
          // huskyBin existed but running it threw — a real, retryable
          // failure, unlike the "huskyBin doesn't exist at all" case above.
          failed = true;
        }
      }
    }
    if (!fs.existsSync(wtHuskyShim)) {
      // Reached only when the outer `.husky` guard already confirmed this
      // project uses husky. Deliberately does NOT set `failed`: by this
      // point installSpawned is false (node_modules is genuinely present),
      // so a still-missing shim means either a real copy/regen failure just
      // above (which already set `failed` itself) or — just as often —
      // husky simply isn't a node_modules dependency here at all, a
      // terminal condition re-running the seeder can never change. Warning
      // once is useful; failing the seed over it would re-seed this
      // otherwise-fine project on every single EnterWorktree forever.
      process.stderr.write(
        "worktree-seed: WARNING — .husky/_ missing; native git hooks (pre-commit, pre-push) " +
          "will be INACTIVE and SILENT in this worktree.\n",
      );
    }
  }
});

// .docker: isolated copy of any local Docker volumes/state at the repo root, if
// present. Never symlink — a worktree needs its own independent volume state
// (e.g. a local DB). copyDereferencedAtomic (not fs.cpSync) — see its doc comment.
guardBlock(".docker", () => {
  const rootDocker = path.join(cwd, ".docker");
  const wtDocker = path.join(dir, ".docker");
  if (fs.existsSync(rootDocker) && !fs.existsSync(wtDocker)) {
    try {
      copyDereferencedAtomic(rootDocker, wtDocker);
    } catch (err) {
      failed = true;
      process.stderr.write(
        `worktree-seed: WARNING — .docker copy failed: ${err instanceof Error ? err.message : String(err)}\n`,
      );
    }
  }
});

// graphify-out: isolated copy of the knowledge graph, if the root has already
// built one. graph.json/manifest.json store only repo-relative paths (no
// absolute-path entries), so the copy itself carries no wrong-location
// baggage the way an undereferenced node_modules/.bin symlink would — but
// per-file mtimes in manifest.json were recorded against root's files, while
// `git worktree add`/this copy stamp fresh mtimes on the worktree's own
// files, so every file looks "changed" by mtime alone. `graphify update .`
// reconciles this via each file's stored content hash (unaffected by mtime)
// and self-heals — backgrounded so this hook doesn't block the session on a
// full graph pass. Skipped entirely when root has no graphify-out yet.
guardBlock("graphify-out", () => {
  const rootGraphifyOut = path.join(cwd, "graphify-out");
  const wtGraphifyOut = path.join(dir, "graphify-out");
  if (fs.existsSync(rootGraphifyOut) && !fs.existsSync(wtGraphifyOut)) {
    try {
      copyDereferencedAtomic(rootGraphifyOut, wtGraphifyOut);
      // shell:true is scoped to Windows only, same reasoning as the npm/pnpm/
      // yarn/bun install fallback above — graphify's binary resolution on
      // Windows is not guaranteed shim-free, and shell:true costs nothing when
      // it isn't needed.
      const child = spawn("graphify", ["update", "."], {
        cwd: dir,
        stdio: "ignore",
        detached: true,
        windowsHide: true,
        shell: process.platform === "win32",
      });
      child.on("error", (err) => {
        process.stderr.write(
          `worktree-seed: WARNING — background graphify update failed to start: ${err.message}\n`,
        );
      });
      child.unref();
    } catch (err) {
      failed = true;
      process.stderr.write(
        `worktree-seed: WARNING — graphify-out copy failed: ${err instanceof Error ? err.message : String(err)}\n`,
      );
    }
  }
});

/**
 * Compiles one .worktreeinclude line (gitignore syntax — a strict subset:
 * `*`/`**` wildcards, leading `/` anchoring, trailing `/` for directory-only,
 * leading `!` for negation) into a matcher.
 * @param {string} rawLine
 * @returns {{ negate: boolean, dirOnly: boolean, regex: RegExp } | null}
 *   null for a pattern that reduces to nothing (e.g. a bare "!").
 */
function compilePattern(rawLine) {
  let line = rawLine;
  let negate = false;
  if (line.startsWith("!")) {
    negate = true;
    line = line.slice(1);
  }
  if (!line) return null;
  const anchored = line.startsWith("/");
  if (anchored) line = line.slice(1);
  const dirOnly = line.endsWith("/");
  if (dirOnly) line = line.slice(0, -1);
  if (!line) return null;

  const DOUBLESTAR = "  ";
  const parts = line
    .split("/")
    .map((seg) =>
      seg === "**" ? DOUBLESTAR : seg.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, "[^/]*"),
    );
  let body = parts.join("/");
  if (body === DOUBLESTAR) {
    body = ".*";
  } else {
    body = body
      .split(`/${DOUBLESTAR}/`)
      .join("(?:/.*)?/")
      .split(`${DOUBLESTAR}/`)
      .join("(?:.*/)?")
      .split(`/${DOUBLESTAR}`)
      .join("(?:/.*)?");
  }
  const prefix = anchored || line.includes("/") ? "^" : "^(?:.*/)?";
  return { negate, dirOnly, regex: new RegExp(`${prefix}${body}$`) };
}

/**
 * Walks `root`, skipping VCS/dependency/worktree-admin directories, and
 * returns every file/dir's path relative to `root` (POSIX-separated,
 * directories carry a trailing "/"). Bounded: only called for patterns that
 * actually contain a wildcard — literal patterns use a direct existsSync
 * check instead (see resolveWorktreeIncludePaths).
 *
 * Skips `.claude/worktrees` specifically (walking into sibling worktrees
 * would be pointless and potentially expensive), NOT all of `.claude` — the
 * rest of `.claude/` (settings.local.json, hooks/, memory/, ...) stays
 * reachable so a wildcard pattern like `**\/*.local.json` can still match
 * `.claude/settings.local.json`, the exact file this harness's own
 * generated `.worktreeinclude` lists by default (via the separate literal-
 * path fast path in resolveWorktreeIncludePaths, which this walk doesn't
 * gate — but a hand-written wildcard pattern targeting `.claude/` should
 * work too, not just the literal default).
 * @param {string} root
 * @returns {string[]}
 */
function walkRelative(root) {
  const SKIP_NAMES = new Set(["node_modules", ".git", ".docker", "graphify-out"]);
  const SKIP_PATHS = new Set([path.join(".claude", "worktrees")]);
  /** @type {string[]} */
  const out = [];
  /** @param {string} dir */
  const recurse = (dir) => {
    /** @type {fs.Dirent[]} */
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (SKIP_NAMES.has(entry.name)) continue;
      const abs = path.join(dir, entry.name);
      const relOs = path.relative(root, abs);
      if (SKIP_PATHS.has(relOs)) continue;
      const rel = relOs.split(path.sep).join("/");
      out.push(entry.isDirectory() ? `${rel}/` : rel);
      if (entry.isDirectory()) recurse(abs);
    }
  };
  recurse(root);
  return out;
}

/**
 * Resolves every path under `root` that `.worktreeinclude`'s patterns select
 * (gitignore syntax subset — see compilePattern). Patterns with no wildcard
 * character use a direct existsSync check (fast path, matches every pattern
 * this harness's own renderWorktreeInclude() generator emits today). Later
 * lines override earlier ones (negation), matching git's own precedence.
 * Returns paths relative to `root` (POSIX-separated).
 * @param {string} root
 * @param {string[]} patterns
 * @returns {string[]}
 */
function resolveWorktreeIncludePaths(root, patterns) {
  /** @type {Set<string>} */
  const selected = new Set();
  /** @type {string[] | null} */
  let treeCache = null;
  const tree = () => (treeCache ??= walkRelative(root));

  for (const rawPattern of patterns) {
    const hasWildcard = rawPattern.replace(/^!/, "").includes("*");
    if (!hasWildcard) {
      const bare = rawPattern.replace(/^!/, "").replace(/^\//, "").replace(/\/$/, "");
      if (rawPattern.startsWith("!")) selected.delete(bare);
      else if (fs.existsSync(path.join(root, bare))) selected.add(bare);
      continue;
    }
    let compiled;
    try {
      compiled = compilePattern(rawPattern);
    } catch (err) {
      process.stderr.write(
        `worktree-seed: skipping invalid .worktreeinclude pattern "${rawPattern}": ${err instanceof Error ? err.message : String(err)}\n`,
      );
      continue;
    }
    if (!compiled) continue;
    for (const relEntry of tree()) {
      const isDir = relEntry.endsWith("/");
      const rel = isDir ? relEntry.slice(0, -1) : relEntry;
      if (compiled.dirOnly && !isDir) continue;
      if (!compiled.regex.test(rel)) continue;
      if (compiled.negate) selected.delete(rel);
      else selected.add(rel);
    }
  }
  return [...selected];
}

// .worktreeinclude: gitignore-syntax patterns (literal paths, `*`/`**`
// wildcards, leading `/` anchoring, leading `!` negation) for files/dirs to
// copy verbatim. Once WorktreeCreate is configured, Claude Code's native
// .worktreeinclude processing is disabled, so this hook must reimplement it.
// copyDereferencedAtomic (not fs.cpSync) for the same isolation reason as
// every copy above.
guardBlock(".worktreeinclude", () => {
  const includeFile = path.join(cwd, ".worktreeinclude");
  if (fs.existsSync(includeFile)) {
    const patterns = fs
      .readFileSync(includeFile, "utf8")
      .split("\n")
      .map((line) => line.replace(/#.*$/, "").trim())
      .filter(Boolean);
    const relPaths = resolveWorktreeIncludePaths(cwd, patterns);
    // Deliberately does NOT set `failed` on a per-`rel` catch: this loop
    // already tolerates one listed path failing while the rest still copy
    // (the loop continues, unlike node_modules/`.docker`/graphify-out,
    // where the catch IS the whole block) — the same "per-entry, don't
    // mark the seed failed" reasoning as a dangling symlink inside one
    // tree, just one level up (per included path instead of per file).
    for (const rel of relPaths) {
      const src = path.join(cwd, rel);
      const dest = path.join(dir, rel);
      if (fs.existsSync(dest) || !fs.existsSync(src)) continue;
      try {
        fs.mkdirSync(path.dirname(dest), { recursive: true });
        copyDereferencedAtomic(src, dest);
      } catch (err) {
        process.stderr.write(
          `worktree-seed: WARNING — .worktreeinclude copy of "${rel}" failed: ${err instanceof Error ? err.message : String(err)}\n`,
        );
      }
    }
  }
});

/**
 * Reads a pre-existing state file's `startedAt`, if present and valid.
 * @param {string} statePath
 * @returns {string | null}
 */
function readStartedAt(statePath) {
  try {
    const existing = JSON.parse(fs.readFileSync(statePath, "utf8"));
    return typeof existing?.startedAt === "string" ? existing.startedAt : null;
  } catch {
    return null; // missing file, unreadable, or invalid JSON — not fatal
  }
}

/**
 * Marks the state file final: {pid, status, startedAt, finishedAt}. status
 * is "done" only when nothing set `failed` above; "failed" otherwise — see
 * the top-level `failed` variable's own comment for exactly what counts.
 * startedAt is preserved from the existing file when readable, otherwise
 * falls back to now. A missing/unwritable statePath is logged, never fatal.
 * @param {string} statePath
 * @param {"done" | "failed"} status
 */
function writeStateFinal(statePath, status) {
  try {
    const startedAt = readStartedAt(statePath) ?? new Date().toISOString();
    fs.writeFileSync(
      statePath,
      JSON.stringify({
        pid: process.pid,
        status,
        startedAt,
        finishedAt: new Date().toISOString(),
      }),
    );
  } catch (err) {
    process.stderr.write(
      `worktree-seed: WARNING — could not write state file "${statePath}": ${err instanceof Error ? err.message : String(err)}\n`,
    );
  }
}

if (statePathArg) writeStateFinal(statePathArg, failed ? "failed" : "done");

process.exit(0);
