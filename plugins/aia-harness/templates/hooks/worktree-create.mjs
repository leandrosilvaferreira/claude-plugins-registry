#!/usr/bin/env node
/**
 * Worktree seed hook — WorktreeCreate + PostToolUse:EnterWorktree.
 *
 * WorktreeCreate stdin (WorktreeCreateHookInput): {hook_event_name:"WorktreeCreate",
 * name, cwd, ...}. This is a "type":"command" hook — Claude Code's native
 * `git worktree add` is replaced entirely once this is wired; on success this
 * hook must print the absolute worktree path as a BARE string on stdout (no
 * JSON — that shape is only for "type":"http"/"callback" hooks, per the
 * WorktreeCreateHookSpecificOutput doc comment in the installed
 * @anthropic-ai/claude-agent-sdk sdk.d.ts).
 *
 * PostToolUse stdin with tool_name "EnterWorktree" (PostToolUseHookInput):
 * {hook_event_name:"PostToolUse", tool_input:{name|path}, cwd, ...} — fires on
 * every EnterWorktree call, including entry into a worktree that already
 * existed. Used here as an idempotent re-seed safety net. PostToolUse's
 * schema has no bare-path convention: this path stays silent (empty stdout)
 * once seeding is done or was never needed, and emits a JSON
 * additionalContext notice instead while a claimed seed is still running.
 */
import { execFileSync, spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/** @returns {string} */
function readStdin() {
  try {
    return fs.readFileSync(0, "utf8");
  } catch {
    return "";
  }
}

/** @type {any} */
let event = {};
try {
  event = JSON.parse(readStdin() || "{}");
} catch {
  process.exit(0);
}

// Both git() and gitOk() cap at 5s. remoteDefaultBranch()/tryFetchFreshBase()
// below call these for network operations (git ls-remote, git fetch) that
// would otherwise block indefinitely against a configured-but-unreachable
// origin (offline, VPN down) — a common condition, not an edge case, since
// "fresh" is the default baseRef. execFileSync throws on timeout, which the
// existing catch already converts to a safe "" / false fallback, so a slow
// or dead origin degrades to local-HEAD branching instead of exhausting this
// hook's own creation timeout before the worktree path is ever reported.

/**
 * @param {string} cwd
 * @param {string[]} args
 * @returns {string}
 */
function git(cwd, args) {
  try {
    return execFileSync("git", args, {
      cwd,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
      windowsHide: true,
      timeout: 5000,
    }).trim();
  } catch {
    return "";
  }
}

/**
 * @param {string} cwd
 * @param {string[]} args
 * @returns {boolean}
 */
function gitOk(cwd, args) {
  try {
    execFileSync("git", args, { cwd, stdio: "ignore", windowsHide: true, timeout: 5000 });
    return true;
  } catch {
    return false;
  }
}

/**
 * Reads worktree.baseRef from .claude/settings.json — "head" or "fresh"
 * (default, matches EnterWorktree's own documented default). Any read/parse
 * failure (missing file, malformed JSON, no worktree key) defaults to "fresh".
 * @param {string} cwd
 * @returns {"head"|"fresh"}
 */
function detectBaseRef(cwd) {
  try {
    const raw = fs.readFileSync(path.join(cwd, ".claude", "settings.json"), "utf8");
    const settings = JSON.parse(raw);
    return settings?.worktree?.baseRef === "head" ? "head" : "fresh";
  } catch {
    return "fresh";
  }
}

/**
 * Resolves the remote's default branch name via `git ls-remote --symref
 * origin HEAD` (a single network round-trip, no local state required, no
 * dependency on refs/remotes/origin/HEAD being set locally — which is
 * frequently stale or unset on real clones). Returns "" on any failure (no
 * origin remote, network unavailable, etc).
 * @param {string} cwd
 * @returns {string}
 */
function remoteDefaultBranch(cwd) {
  const out = git(cwd, ["ls-remote", "--symref", "origin", "HEAD"]);
  const m = out.match(/^ref:\s+refs\/heads\/(\S+)\s+HEAD/m);
  return m ? m[1] : "";
}

/**
 * Attempts to fetch the remote's default branch so a new worktree can branch
 * from FETCH_HEAD instead of local HEAD, matching baseRef:"fresh" semantics
 * (branch from origin/<default-branch>, not a possibly-stale local
 * checkout). Returns true only on a fully successful lookup + fetch; any
 * failure at any step (no remote, offline, fetch error) returns false and
 * the caller falls back to branching from local HEAD — the same, still-
 * correct-for-"head"-mode behavior as before this fix.
 * @param {string} cwd
 * @returns {boolean}
 */
function tryFetchFreshBase(cwd) {
  const defaultBranch = remoteDefaultBranch(cwd);
  if (!defaultBranch) return false; // no origin configured — normal, stay silent
  const ok = gitOk(cwd, ["fetch", "origin", defaultBranch]);
  if (!ok) {
    // Origin exists but the fetch itself failed (unreachable, slow, timed
    // out at the 5s cap on git()/gitOk()) — this is the case worth a
    // heads-up: creation still succeeds, but silently from local HEAD
    // instead of the "fresh" the default setting asked for.
    process.stderr.write(
      "worktree-create: WARNING — could not fetch origin's default branch " +
        '(worktree.baseRef:"fresh"); branching from local HEAD instead.\n',
    );
  }
  return ok;
}

const isCreate = event.hook_event_name === "WorktreeCreate";

// WorktreeCreate gives {name}; PostToolUse:EnterWorktree gives {tool_input:{name|path}}.
let name = typeof event.name === "string" ? event.name : "";
let wtPathInput = "";
if (!name) {
  const ti = event.tool_input ?? {};
  name = typeof ti.name === "string" ? ti.name : "";
  wtPathInput = typeof ti.path === "string" ? ti.path : "";
}

// Purpose A (operational directory): prefer event.cwd, then CLAUDE_PROJECT_DIR,
// then process.cwd() — see .claude/rules/hooks-cwd-resolution.md.
const cwdArg = typeof event.cwd === "string" && event.cwd ? event.cwd : "";
let cwd = cwdArg || process.env.CLAUDE_PROJECT_DIR || process.cwd();

// If cwd is already inside a worktree (PostToolUse can fire after EnterWorktree's
// own cwd switch), the real repo root is the prefix before the marker.
const insideWorktree = cwd.match(/^(.+?)[/\\]\.claude[/\\]worktrees[/\\]/);
if (insideWorktree) cwd = insideWorktree[1];

// An explicit path (from PostToolUse:EnterWorktree) wins for root+name.
// EnterWorktree can pass a RELATIVE path — resolve it before matching.
if (wtPathInput) {
  const abs = path.isAbsolute(wtPathInput) ? wtPathInput : path.resolve(cwd, wtPathInput);
  const m = abs.match(/^(.+?)[/\\]\.claude[/\\]worktrees[/\\]([^/\\]+)[/\\]?$/);
  if (m) {
    cwd = m[1];
    if (!name) name = m[2];
  }
}

if (!name) process.exit(0);
const dir = path.join(cwd, ".claude", "worktrees", name);

// Worktree already on disk (EnterWorktree entering an existing local worktree) → skip git creation.
if (!fs.existsSync(dir)) {
  git(cwd, ["worktree", "prune"]);
  // worktree.baseRef:"fresh" (the default) branches from the remote's
  // default branch, matching native WorktreeCreate semantics — never from a
  // possibly-stale local HEAD. "head" explicitly opts into local HEAD. Any
  // failure in the fresh path (no settings, no origin, offline) falls back
  // to local HEAD, exactly like "head" mode — never blocks creation.
  const useFresh = detectBaseRef(cwd) === "fresh" && tryFetchFreshBase(cwd);
  const addArgs = useFresh
    ? ["worktree", "add", dir, "-b", name, "FETCH_HEAD"]
    : ["worktree", "add", dir, "-b", name];
  try {
    execFileSync("git", addArgs, {
      cwd,
      stdio: "ignore",
      windowsHide: true,
    });
  } catch {
    try {
      execFileSync("git", ["worktree", "add", dir, name], {
        cwd,
        stdio: "ignore",
        windowsHide: true,
      });
    } catch {
      /* checked below */
    }
  }
}

if (!fs.existsSync(dir)) {
  process.stderr.write(`worktree-create: failed to create ${dir}\n`);
  process.exit(2);
}

// Command-hook contract: WorktreeCreate must print the bare path on stdout;
// PostToolUse has no such field and stays silent once seeding is done (or
// was never needed) — while a claimed seed is still running, it emits an
// additionalContext notice instead (see below). Emitted here, immediately
// after the worktree itself exists: everything below this line — claiming
// the seed and spawning worktree-seed.mjs — hands the potentially-slow copy
// work (node_modules, .husky/_, .docker, graphify-out, .worktreeinclude) off
// to a detached child with no timeout of its own, so this hook returns well
// under a second regardless of project size instead of racing a synchronous
// copy against its own timeout the way it used to.
if (isCreate) process.stdout.write(dir);

// Seed state: <worktree's own git-dir>/aia-seed.{json,log} — resolved via
// `git rev-parse --git-dir` run WITH cwd = the worktree, which lands under
// <root>/.git/worktrees/<name>/ (correct too when the root is itself a
// worktree, where <root>/.git is a file, not a directory). A location there
// is invisible to `git status` and outlives this process, unlike anything
// inside the worktree itself.
//
// `git rev-parse` failing here should be rare (the worktree was just
// verified to exist above), but an empty result must never fall through
// straight to an UNCOORDINATED spawn: WorktreeCreate followed immediately
// by PostToolUse:EnterWorktree would then spawn two seeders with no claim
// file to arbitrate between them at all. First try the deterministic path
// git's own convention would have produced for a normal (non-nested)
// worktree — `<root>/.git/worktrees/<name>` is exactly the value
// `rev-parse --git-dir` returns in that case — so this costs nothing extra
// when it's right, and it is never written INTO the worktree's own working
// tree (which would show up in `git status`).
//
// The guess is NOT trustworthy by name alone: git deduplicates colliding
// worktree admin-dir basenames (confirmed empirically) — if some OTHER
// worktree elsewhere in this repo already has a directory basename of
// `name`, THAT one keeps the plain `<root>/.git/worktrees/<name>` and ours
// gets a numeric suffix (`<name>1`, `<name>2`, ...) instead. Using the guess
// unvalidated in that case would read/write a STRANGER's admin directory —
// including its aia-seed.json, silently skipping seeding if it happens to
// read `status:"done"` there. Every worktree admin dir carries its own
// `gitdir` file (git's own bookkeeping) naming the exact worktree `.git`
// file it belongs to; only trust the guess once that file confirms it
// points back at THIS worktree's own `.git`. A mismatch, or a missing/
// unreadable `gitdir` file, means the guess is unusable.
//
// Only when NEITHER the primary lookup nor the validated fallback resolves
// does this degrade to spawning unconditionally with no state file — safe
// now that copyDereferencedAtomic's orphan sweep (worktree-seed.mjs) no
// longer deletes a live sibling's tmp dir out from under it, so an
// uncoordinated double-spawn is wasteful, never corrupting.
let gitDirRaw = git(dir, ["rev-parse", "--git-dir"]);
if (!gitDirRaw) {
  const fallbackGitDir = path.join(cwd, ".git", "worktrees", name);
  try {
    const claimedGitFile = fs.readFileSync(path.join(fallbackGitDir, "gitdir"), "utf8").trim();
    // Both sides must be reduced to ONE canonical spelling of the same file
    // before comparing, because git and Node genuinely disagree about how to
    // spell it — differently on each platform, and a purely lexical compare
    // rejects a perfectly valid match on both:
    //   macOS   — git records the FULLY RESOLVED path, so its `gitdir` file
    //             says /private/var/..., while `dir` was built from the
    //             un-resolved /var/... side of that symlink.
    //   Windows — git records the LONG-NAME path (Git for Windows' own getcwd
    //             runs GetLongPathNameW), so its `gitdir` file says
    //             C:/Users/runneradmin/..., while `dir` was built from
    //             `event.cwd`/`os.tmpdir()`, which on a GitHub Actions runner
    //             is literally C:\Users\RUNNER~1\... — an 8.3 short name.
    // `.native`, not plain `fs.realpathSync`, is what covers BOTH. Plain
    // `fs.realpathSync` is Node's own JS reimplementation of POSIX realpath:
    // it resolves symlinks and nothing else, so on Windows it hands RUNNER~1
    // straight back and the comparison fails. Measured on windows-latest —
    // that mismatch is exactly what silently disabled this fallback there,
    // degrading every EnterWorktree into an uncoordinated second seeder.
    // `fs.realpathSync.native` goes through libuv's uv_fs_realpath:
    // GetFinalPathNameByHandleW(FILE_NAME_NORMALIZED | VOLUME_NAME_DOS) on
    // Windows (long-name, true-case, no \\?\ prefix — libuv strips it) and
    // realpath(3) on POSIX, so both sides converge on every platform.
    // Deliberately still a STRICT equality: a different worktree's admin dir
    // must never be accepted, which is the whole reason this check exists.
    if (fs.realpathSync.native(claimedGitFile) === fs.realpathSync.native(path.join(dir, ".git"))) {
      gitDirRaw = fallbackGitDir;
    }
  } catch {
    /* fallbackGitDir doesn't exist, its gitdir file is missing/unreadable, or a path in the
       comparison doesn't resolve — fallback unavailable */
  }
}
/** @type {string | null} */
let statePath = null;
/** @type {string | null} */
let logPath = null;
if (gitDirRaw) {
  const gitDir = path.isAbsolute(gitDirRaw) ? gitDirRaw : path.resolve(dir, gitDirRaw);
  statePath = path.join(gitDir, "aia-seed.json");
  logPath = path.join(gitDir, "aia-seed.log");
}

/**
 * True if `pid` is a positive integer identifying a currently-running
 * process. Guards `Number.isInteger(pid) && pid > 0` before calling
 * `process.kill(pid, 0)` — the standard cross-platform "does this pid exist"
 * probe, which throws ESRCH (never actually signals) once it's gone —
 * because pid 0 and negative pids address process GROUPS on POSIX:
 * `process.kill(0, 0)` and `process.kill(-1, 0)` both succeed as long as ANY
 * process in that group exists (confirmed empirically, Node v24.17.0), which
 * would otherwise misread a corrupt `pid:0` in the state file as a live
 * claim and block seeding forever.
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
 * Atomically claims ownership of seeding this worktree. Returns true when
 * the caller now owns seeding and must spawn worktree-seed.mjs; false when
 * someone else already owns it — a completed run, or one whose pid is still
 * verifiably alive — and no child should be spawned.
 * @param {string | null} statePathArg
 * @returns {boolean}
 */
function claimSeed(statePathArg) {
  if (!statePathArg) return true; // no git-dir resolved (primary or fallback) — spawn unconditionally

  /** @returns {string} */
  const freshClaim = () =>
    JSON.stringify({ pid: process.pid, status: "running", startedAt: new Date().toISOString() });

  try {
    // "wx": create-or-fail, atomically — the primitive that makes this safe
    // against two hook invocations racing each other (e.g. WorktreeCreate
    // immediately followed by PostToolUse:EnterWorktree). A read-then-write
    // check here would not be atomic and could let both spawn a seeder.
    fs.writeFileSync(statePathArg, freshClaim(), { flag: "wx" });
    return true;
  } catch (err) {
    if (!(err instanceof Error) || /** @type {NodeJS.ErrnoException} */ (err).code !== "EEXIST") {
      return true; // any other fs error — fail open: seeding twice is recoverable, never seeding is not
    }
  }

  // EEXIST: someone already claimed this worktree — inspect what they left.
  /** @type {any} */
  let existing = null;
  try {
    existing = JSON.parse(fs.readFileSync(statePathArg, "utf8"));
  } catch {
    existing = null; // unreadable/unparseable — treated as a dead run below
  }

  if (existing?.status === "done") return false;
  // A verifiably live pid always wins — no staleness override. startedAt is
  // preserved in the file purely as diagnostics; it has no say in this
  // decision. A seeder can legitimately still be mid-copy well past any
  // "should be done by now" guess: a multi-GB node_modules with no reflink
  // support (ext4, NTFS — the whole reason detached seeding exists) is a
  // plausible multi-minute-plus runtime, not a pathological one, and
  // retaking a real, still-running seeder's claim would let a second one
  // start racing it on the very same files. Only a dead, missing,
  // non-integer, non-positive, or unparseable pid retakes.
  if (existing?.status === "running") {
    if (isAlivePid(existing.pid)) return false;
    // The pid probe is a SECOND sample, taken microseconds after the status
    // read above — and a seeder that finishes in that gap writes
    // status:"done" and only THEN exits, so "the file said running" plus
    // "the pid is gone" does not add up to "the run died". Re-read before
    // retaking. Without this, a seeder caught mid-exit loses its claim to a
    // redundant second seeder whose competing "running" write also lands on
    // top of the seeder's in-flight "done" write, leaving a torn state file
    // that every later reader then treats as a dead run too. Observed on
    // ubuntu-latest in CI (JSON.parse: "Unexpected non-whitespace character
    // after JSON at position 70" — a complete 70-byte "done" record with the
    // 3-byte tail of a 73-byte "running" record still stuck to the end).
    try {
      existing = JSON.parse(fs.readFileSync(statePathArg, "utf8"));
    } catch {
      existing = null;
    }
    if (existing?.status === "done") return false;
  }

  // Dead pid, unparseable state, an explicit status:"failed" (worktree-
  // seed.mjs's own signal that a block-level copy attempt threw — see its
  // header comment), or any other unrecognized status — the previous run
  // died or gave up before finishing (or never validly claimed at all).
  // Retake the claim (no "wx" this time — we already own the only copy of
  // this file that matters) and let the caller spawn a fresh seeder. No
  // separate handling needed for "failed" specifically: it already falls
  // through this same catch-all, exactly like a dead pid would.
  try {
    fs.writeFileSync(statePathArg, freshClaim());
    return true;
  } catch {
    return true; // fail open, same reasoning as above
  }
}

// Tracks whether THIS invocation's own spawn attempt below is known to
// have failed — distinct from the state FILE, which claimSeed already
// wrote "running" into before the spawn was even attempted (the wx/retake
// claim has to land before we know whether the process will actually
// start). Used only to suppress the PostToolUse notice for THIS
// invocation (see below); the state file itself is deliberately left
// alone — the placeholder pid this invocation wrote dies with it, so the
// NEXT claimSeed call already retakes it correctly with no further
// bookkeeping here.
let spawnFailed = false;

if (claimSeed(statePath)) {
  const seedScript = path.join(path.dirname(fileURLToPath(import.meta.url)), "worktree-seed.mjs");

  let logFd = -1;
  if (logPath) {
    try {
      logFd = fs.openSync(logPath, "a");
    } catch (err) {
      process.stderr.write(
        `worktree-create: WARNING — could not open seed log "${logPath}": ${err instanceof Error ? err.message : String(err)}\n`,
      );
    }
  }

  try {
    // process.execPath (never the string "node") so the child uses the same
    // runtime regardless of PATH, and never needs a shell to launch it.
    // spawn() does not throw for most failure modes — a missing/broken
    // executable, EMFILE, EAGAIN, ENOMEM, etc. leave `.pid` undefined and
    // queue an async "error" event instead (checked below) — but it CAN
    // throw synchronously for others (an invalid `cwd`, confirmed
    // empirically: ENOTDIR). This try/catch is what keeps either kind from
    // becoming an uncaught exception that would exit this script with an
    // uncontrolled code instead of the required 0.
    const child = spawn(process.execPath, [seedScript, cwd, dir, statePath ?? ""], {
      cwd: dir,
      detached: true,
      stdio: logFd === -1 ? "ignore" : ["ignore", logFd, logFd],
      windowsHide: true,
    });
    if (typeof child.pid !== "number") {
      // The common spawn-failure shape (ENOENT, EMFILE, EAGAIN, ENOMEM,
      // ...): spawn() doesn't throw, it leaves `.pid` undefined and queues
      // an async "error" event for later. This script calls process.exit(0)
      // almost immediately after this block, before that event ever gets a
      // turn — confirmed empirically (Node v24.17.0) that the listener
      // below never fires in time — so THIS synchronous check is what
      // actually reports the failure.
      spawnFailed = true;
      process.stderr.write(
        "worktree-create: WARNING — background seeder failed to spawn; node_modules " +
          "and other seeded content will be missing until the worktree is re-entered.\n",
      );
    }
    child.on("error", (err) => {
      // Kept as a backstop, not the primary report (see above): an
      // unhandled "error" event on an EventEmitter throws and would crash
      // this script with an uncontrolled exit code if nothing were
      // listening, for the rare case something downstream ever keeps this
      // process alive long enough for the event to actually fire.
      process.stderr.write(
        `worktree-create: WARNING — failed to spawn background seeder: ${err.message}\n`,
      );
    });
    child.unref();

    // claimSeed() had to write THIS hook's own pid as a placeholder to win
    // the atomic "wx" race before the seeder existed to give us a real
    // one — this hook exits right after this line, so a later invocation's
    // liveness check (isAlivePid, above) must see the long-running CHILD's
    // pid, not this already-exiting one. Overwrite it now, preserving the
    // original claim's startedAt. Guarded on the claim still reading
    // "running": a trivial/no-op seed can finish (and write status:"done")
    // before this line runs, and blindly overwriting that back to "running"
    // would make an already-complete seed look unfinished to a later
    // PostToolUse check.
    if (statePath && typeof child.pid === "number") {
      try {
        const claimed = JSON.parse(fs.readFileSync(statePath, "utf8"));
        if (claimed?.status === "running") {
          fs.writeFileSync(
            statePath,
            JSON.stringify({ pid: child.pid, status: "running", startedAt: claimed.startedAt }),
          );
        }
      } catch {
        /* not fatal — worst case a later invocation sees this pid already gone and retakes harmlessly */
      }
    }
  } catch (err) {
    // The worktree itself already exists and (for WorktreeCreate) its path
    // was already printed above — that is the one thing Claude Code cannot
    // recover on its own, so a failed spawn here is a warning, never exit 2.
    spawnFailed = true;
    process.stderr.write(
      `worktree-create: WARNING — failed to spawn background seeder: ${err instanceof Error ? err.message : String(err)}\n`,
    );
  }
  if (logFd !== -1) fs.closeSync(logFd);
}

// PostToolUse notice: while a claimed seed is still running (just spawned
// above, or a live earlier invocation's), tell Claude Code so a partially
// copied node_modules doesn't read as a broken install. WorktreeCreate's
// stdout contract is the bare path only, so this is gated on !isCreate; once
// seeding is done, or there is no state file to check, stdout stays empty
// (never "{}"). Also suppressed when THIS invocation just claimed the seed
// and then failed to spawn it (spawnFailed, above): the state file can
// still read "running" at this point (claimSeed had to write that before
// the spawn attempt even happened), but advertising a seeder that never
// started would tell Claude Code to "wait and retry" a copy nothing is
// doing — a silent stdout is correct instead, since the dying placeholder
// pid means the next EnterWorktree's claimSeed retakes it anyway.
if (!isCreate && statePath && !spawnFailed) {
  /** @type {any} */
  let state = null;
  try {
    state = JSON.parse(fs.readFileSync(statePath, "utf8"));
  } catch {
    state = null;
  }
  if (state?.status === "running") {
    const additionalContext =
      "This worktree's dependencies are still being copied in the background " +
      "(node_modules and related directories may be incomplete for a short while). " +
      "Wait and retry rather than reinstalling or reporting a broken setup.";
    process.stdout.write(
      JSON.stringify({ hookSpecificOutput: { hookEventName: "PostToolUse", additionalContext } }),
    );
  }
}

process.exit(0);
