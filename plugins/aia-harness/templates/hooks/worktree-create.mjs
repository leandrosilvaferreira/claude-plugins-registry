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
 * existed. Used here as an idempotent re-seed safety net. PostToolUse's schema
 * has no bare-path convention, so this path stays silent (empty stdout).
 */
import { execFileSync, spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

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
// PostToolUse has no such field and must stay silent (empty, valid stdout).
// Emitted here — as soon as the worktree itself exists, before the seeding
// steps below — rather than at the very end: node_modules seeding is a
// synchronous fs.cpSync that falls back to a full byte-copy (not a reflink)
// on filesystems without copy-on-write support (most Linux/Windows setups,
// i.e. ext4/NTFS), which can be slow enough to exceed this hook's timeout on
// a large node_modules. If the process gets killed mid-copy, the worktree it
// already created is still usable and its path was already delivered — the
// PostToolUse:EnterWorktree safety net re-runs this same seeding logic
// idempotently to finish the job. A killed process must not cost Claude Code
// the one thing it structurally cannot recover without: the path itself.
if (isCreate) process.stdout.write(dir);

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
      `worktree-create: WARNING — could not stat "${src}" (dangling symlink?), skipped: ${err instanceof Error ? err.message : String(err)}\n`,
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
        `worktree-create: WARNING — could not copy "${src}", skipped: ${err instanceof Error ? err.message : String(err)}\n`,
      );
    }
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
  const tmp = `${dest}.tmp-${process.pid}`;
  fs.rmSync(tmp, { recursive: true, force: true });
  copyDereferenced(src, tmp);
  fs.renameSync(tmp, dest);
}

// node_modules: isolated copy, never a symlink — gated on package.json so a
// non-Node project never attempts this block. Vitest/Vite write scratch state
// into node_modules/.vite-temp; a symlinked node_modules shares that dir
// between root and every worktree, so parallel test runs race on it (one
// process removes/renames it while another reads/writes). Trade-off
// accepted: root `npm install` no longer propagates to already-live
// worktrees — run it inside the worktree itself for a new dependency.
// copyDereferencedAtomic (not fs.cpSync) — see its own doc comment for why.
if (fs.existsSync(path.join(cwd, "package.json"))) {
  const rootModules = path.join(cwd, "node_modules");
  const wtModules = path.join(dir, "node_modules");
  if (fs.existsSync(rootModules)) {
    if (!fs.existsSync(wtModules)) {
      try {
        copyDereferencedAtomic(rootModules, wtModules);
      } catch (err) {
        process.stderr.write(
          `worktree-create: WARNING — node_modules copy failed: ${err instanceof Error ? err.message : String(err)}\n`,
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
        `worktree-create: WARNING — background ${cmd} install failed to start: ${err.message}\n`,
      );
    });
    child.unref();
  }
}

// .husky/_: Husky's generated shim (from `npm run prepare`/`husky`), ignored via
// its own .husky/_/.gitignore — git worktree only materializes tracked content,
// so a new worktree never inherits it. Gated on the root .husky dir existing at
// all, so a project that doesn't use Husky never triggers this block or its
// warning. Without the shim, core.hooksPath points at an empty dir and git
// silently skips pre-commit/pre-push there. Never symlink: a shared inode means
// one worktree regenerating it (via `npm install`/`prepare`) can race with
// another mid-commit/push.
if (fs.existsSync(path.join(cwd, ".husky"))) {
  const wtHuskyShim = path.join(dir, ".husky", "_");
  if (!fs.existsSync(wtHuskyShim)) {
    const rootHuskyShim = path.join(cwd, ".husky", "_");
    if (fs.existsSync(rootHuskyShim)) {
      try {
        copyDereferencedAtomic(rootHuskyShim, wtHuskyShim);
      } catch {
        /* checked below */
      }
    } else if (fs.existsSync(path.join(dir, ".husky"))) {
      // Invoke husky's JS entrypoint directly via node — never `npx` as the
      // spawn command (npx is a .cmd shim on Windows, not directly
      // executable without a shell). Missing bin.js (e.g. a Husky major
      // version with a different entry) falls through to the warning below,
      // same as any other regen failure.
      try {
        const huskyBin = path.join(dir, "node_modules", "husky", "bin.js");
        if (fs.existsSync(huskyBin)) {
          execFileSync("node", [huskyBin], { cwd: dir, stdio: "ignore", windowsHide: true });
        }
      } catch {
        /* checked below */
      }
    }
  }
  if (!fs.existsSync(wtHuskyShim)) {
    process.stderr.write(
      "worktree-create: WARNING — .husky/_ missing; native git hooks (pre-commit, pre-push) " +
        "will be INACTIVE and SILENT in this worktree.\n",
    );
  }
}

// .docker: isolated copy of any local Docker volumes/state at the repo root, if
// present. Never symlink — a worktree needs its own independent volume state
// (e.g. a local DB). copyDereferencedAtomic (not fs.cpSync) — see its doc comment.
const rootDocker = path.join(cwd, ".docker");
const wtDocker = path.join(dir, ".docker");
if (fs.existsSync(rootDocker) && !fs.existsSync(wtDocker)) {
  try {
    copyDereferencedAtomic(rootDocker, wtDocker);
  } catch (err) {
    process.stderr.write(
      `worktree-create: WARNING — .docker copy failed: ${err instanceof Error ? err.message : String(err)}\n`,
    );
  }
}

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
        `worktree-create: WARNING — background graphify update failed to start: ${err.message}\n`,
      );
    });
    child.unref();
  } catch (err) {
    process.stderr.write(
      `worktree-create: WARNING — graphify-out copy failed: ${err instanceof Error ? err.message : String(err)}\n`,
    );
  }
}

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
        `worktree-create: skipping invalid .worktreeinclude pattern "${rawPattern}": ${err instanceof Error ? err.message : String(err)}\n`,
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
const includeFile = path.join(cwd, ".worktreeinclude");
if (fs.existsSync(includeFile)) {
  const patterns = fs
    .readFileSync(includeFile, "utf8")
    .split("\n")
    .map((line) => line.replace(/#.*$/, "").trim())
    .filter(Boolean);
  const relPaths = resolveWorktreeIncludePaths(cwd, patterns);
  for (const rel of relPaths) {
    const src = path.join(cwd, rel);
    const dest = path.join(dir, rel);
    if (fs.existsSync(dest) || !fs.existsSync(src)) continue;
    try {
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      copyDereferencedAtomic(src, dest);
    } catch (err) {
      process.stderr.write(
        `worktree-create: WARNING — .worktreeinclude copy of "${rel}" failed: ${err instanceof Error ? err.message : String(err)}\n`,
      );
    }
  }
}

process.exit(0);
