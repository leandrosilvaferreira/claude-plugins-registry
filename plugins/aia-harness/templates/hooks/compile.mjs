#!/usr/bin/env node
/**
 * SessionStart hook — vault knowledge compiler. Thin gate + detached spawn:
 * this hook does no LLM work itself. It cheaply decides whether any daily
 * note older than today is new or changed since the last successful compile,
 * then spawns compile-runner.mjs (a detached worker under .claude/scripts/,
 * NOT a hook — no stdin event, no stdout contract, no schema) to promote
 * anything durable from each pending note into the right PARA folder
 * (01-projects/02-areas/03-knowledge/04-resources) out of band, after this
 * hook has already exited.
 *
 * This hook never emits hookSpecificOutput — stdout is exactly "" on every
 * path, always.
 *
 * Gates, in order (any failure -> exit 0, no spawn):
 *   1. CLAUDE_INVOKED_BY set -> anti-recursion. The runner sets this on its
 *      spawned sub-session's env; without this guard, that sub-session's own
 *      SessionStart would re-enter this very pipeline.
 *   2. stdin invalid / non-object / literal null -> exit 0.
 *   3. <projectRoot>/.mcp.json missing/unparseable/no mcpServers.obsidian ->
 *      exit 0 (the runner cannot work without that server block). Checked
 *      before the pending-daily scan below because it is a single file read,
 *      while the scan hashes every daily note.
 *   4. no pending daily notes -> exit 0. "Pending" means: a filename under
 *      <projectRoot>/__OBSIDIAN_VAULT_DIR__/daily/ matching YYYY-MM-DD.md,
 *      older than today, whose sha256 (first 16 hex chars) does not match
 *      what's recorded for that filename in
 *      <projectRoot>/.claude/hooks/log/compile-state.json — see
 *      listPendingDailies() in vault-pipeline-shared.mjs. This replaces the
 *      old single-day yesterday() window, which permanently skipped any
 *      daily note whose next calendar day happened to start no session — a
 *      real gap, confirmed against this repo's own vault. Today's own daily
 *      is never eligible: session-log-runner.mjs is still appending to it,
 *      so compiling it would promote a half-written log. That state file is
 *      deliberately a project-level, CROSS-session cache — not
 *      sessionScratchDir — because its whole purpose is to survive across
 *      sessions and stop an unchanged daily note from being recompiled every
 *      time a new session starts. It is written only on success, and only by
 *      the runner (never by this hook), so a failed run retries next
 *      session.
 *   5. concurrency: the project-wide compile lock is already held by an
 *      in-flight runner -> exit 0. Gates 1-4 are all read-only checks against
 *      state gate 4 only writes when a run *succeeds*, so between them and
 *      that write sits a window as long as the runner's entire LLM
 *      sub-session. SessionStart is wired with no matcher, so it also fires
 *      on resume/clear/compact: a /clear mid-session, or a second parallel
 *      worktree session (compile-state.json is Purpose C — one file shared
 *      by every worktree of the project), re-runs gates 1-4 while the first
 *      runner is still working and every one of them opens again. Each
 *      opening would spawn another runner promoting the same pending dailies
 *      into the same PARA notes concurrently, which is how duplicate notes
 *      get written. The lock closes that window; it is taken here and
 *      released by the runner, so it must be the last gate, immediately
 *      before the spawn.
 *   6. spawn compile-runner.mjs detached, passing the project dir as argv
 *      (process.argv[2] on the runner side — see spawnDetachedRunner's
 *      caller below); env carries CLAUDE_INVOKED_BY. A failed spawn releases
 *      the lock right back. The runner re-derives the pending list itself
 *      rather than receiving it from this snapshot, since a full LLM
 *      sub-session of latency separates this gate from the runner's first
 *      write.
 *   7. exit 0, no stdout.
 *
 * Fails open on every I/O / parse / spawn error — a vault hook must never
 * block a session from starting.
 */
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseHookEvent, readStdinRaw } from "./hook-io.mjs";
import {
  exitIfInvokedBySelf,
  resolveProjectRootPurposeC,
  hasObsidianServer,
  runnerPathOverride,
  spawnDetachedRunner,
  acquireCompileLock,
  releaseCompileLock,
  listPendingDailies,
  readCompileState,
} from "./vault-pipeline-shared.mjs";

exitIfInvokedBySelf();

const event = parseHookEvent(readStdinRaw());
if (event === null) process.exit(0);

// Purpose C — see .claude/rules/hooks-cwd-resolution.md's Purpose C section —
// resolved by resolveProjectRootPurposeC, shared with session-log.mjs.
const projectRoot = resolveProjectRootPurposeC(event);

if (!hasObsidianServer(projectRoot)) process.exit(0);

// Every daily note older than today that has not been compiled at its current
// content hash. Replaces the previous single-day yesterday() window, which
// permanently skipped any daily whose next calendar day started no session.
const dailyDir = path.join(projectRoot, "__OBSIDIAN_VAULT_DIR__", "daily");
if (listPendingDailies(dailyDir, readCompileState(projectRoot)).length === 0) process.exit(0);

const runnerPath =
  runnerPathOverride(process.argv) ||
  path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "scripts", "compile-runner.mjs");

// Last gate, and the only one that mutates anything — see gate 6 in the doc
// comment above for why every read-only gate before it is insufficient on its
// own. Released by compile-runner.mjs when it finishes. The returned value is
// the lock's ownership nonce ("" when the lock was not won), used below so a
// failed spawn only ever releases the lock this process actually took.
const lockNonce = acquireCompileLock(projectRoot);
if (!lockNonce) process.exit(0);

// The runner re-derives the pending list itself rather than receiving it:
// a full LLM sub-session of latency separates this gate from its first write,
// so it must act on the state as of when it starts, not this snapshot.
if (!spawnDetachedRunner(runnerPath, [projectRoot], "compile")) {
  // Nothing will ever release it otherwise: the runner that would have is the
  // process that failed to start.
  releaseCompileLock(projectRoot, lockNonce);
}

process.exit(0);
