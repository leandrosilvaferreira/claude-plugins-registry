#!/usr/bin/env node
/**
 * SessionEnd hook — vault session logger. Thin gate + detached spawn: this
 * hook does no LLM work itself. It cheaply decides whether a session is
 * worth summarizing, then spawns session-log-runner.mjs (a detached worker
 * under .claude/scripts/, NOT a hook — no stdin event, no stdout contract,
 * no schema) to do the actual summarization + Obsidian write out of band,
 * after this hook has already exited.
 *
 * SessionEnd emits no hookSpecificOutput (standard-only event per the schema
 * table) — this hook writes nothing to stdout on any path, ever.
 *
 * Gates, in order (any failure -> exit 0, no spawn):
 *   1. CLAUDE_INVOKED_BY set -> anti-recursion. The runner sets this on its
 *      spawned sub-session's env; without this guard, that sub-session's own
 *      SessionEnd would re-enter this very pipeline.
 *   2. stdin invalid / non-object / literal null -> exit 0.
 *   3. event.transcript_path missing, or the file doesn't exist -> exit 0.
 *   4. <projectRoot>/.vault-obsidian is not a directory -> exit 0.
 *   5. <projectRoot>/.mcp.json missing/unparseable/no mcpServers.obsidian ->
 *      exit 0 (the runner cannot work without that server block).
 *   6. transcript has fewer than MIN_TURNS substantive user/assistant turns
 *      (real text, not synthetic tool_use/tool_result/thinking-only lines)
 *      -> exit 0. Cheap deterministic guard so trivial sessions never pay
 *      for an LLM call.
 *   7. dedup: sessionScratchDir(session_id)/session-log-state.json already
 *      records this session_id within DEDUP_WINDOW_MS -> exit 0. Otherwise
 *      write the record and continue.
 *   8. spawn session-log-runner.mjs detached, passing transcript path,
 *      session id, and project dir as argv; env carries CLAUDE_INVOKED_BY.
 *   9. exit 0, no stdout.
 *
 * Fails open on every I/O / parse / spawn error — a vault hook must never
 * block a session from ending.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { sessionScratchDir } from "./session-scratch.mjs";
import {
  isSubstantiveTurn,
  exitIfInvokedBySelf,
  readStdinRaw,
  parseHookEvent,
  resolveProjectRootPurposeC,
  hasObsidianServer,
  runnerPathOverride,
  spawnDetachedRunner,
} from "./vault-pipeline-shared.mjs";

exitIfInvokedBySelf();

const MIN_TURNS = 4;
const DEDUP_WINDOW_MS = 60_000;

const event = parseHookEvent(readStdinRaw());
if (event === null) process.exit(0);

const transcriptPath = typeof event.transcript_path === "string" ? event.transcript_path : "";
// fs.existsSync never throws (Node swallows the stat error internally and
// returns false), so no try/catch is needed around it.
if (!transcriptPath || !fs.existsSync(transcriptPath)) process.exit(0);

// Purpose C — project-wide, cross-worktree resource (see
// .claude/rules/hooks-cwd-resolution.md's Purpose C section) — resolved by
// resolveProjectRootPurposeC, shared with compile.mjs.
const projectRoot = resolveProjectRootPurposeC(event);

let vaultIsDir = false;
try {
  vaultIsDir = fs.statSync(path.join(projectRoot, "__OBSIDIAN_VAULT_DIR__")).isDirectory();
} catch {
  vaultIsDir = false; // missing, unreadable, or any other stat error -> treat as absent
}
if (!vaultIsDir) process.exit(0);

if (!hasObsidianServer(projectRoot)) process.exit(0);

/**
 * Counts transcript lines that are substantive user/assistant turns (see
 * isSubstantiveTurn). Stops early once MIN_TURNS is reached — this is a
 * cheap gate, not a precise count, so a long transcript never needs to be
 * fully parsed just to prove it clears the bar.
 * @returns {number}
 */
function countTurns() {
  let raw;
  try {
    raw = fs.readFileSync(transcriptPath, "utf8");
  } catch {
    return 0;
  }
  let n = 0;
  for (const line of raw.split("\n")) {
    if (!line.trim()) continue;
    let parsed;
    try {
      parsed = JSON.parse(line);
    } catch {
      continue; // skip malformed lines
    }
    if (isSubstantiveTurn(parsed)) n++;
    if (n >= MIN_TURNS) break;
  }
  return n;
}
if (countTurns() < MIN_TURNS) process.exit(0);

const sessionId =
  typeof event.session_id === "string" && event.session_id ? event.session_id : "nosession";
const stateFile = path.join(sessionScratchDir(sessionId), "session-log-state.json");

/** @returns {boolean} true if this session was already logged within the dedup window */
function isDeduped() {
  try {
    const parsed = JSON.parse(fs.readFileSync(stateFile, "utf8"));
    return (
      parsed &&
      typeof parsed === "object" &&
      parsed.session_id === sessionId &&
      typeof parsed.loggedAt === "number" &&
      Date.now() - parsed.loggedAt < DEDUP_WINDOW_MS
    );
  } catch {
    return false;
  }
}
// TOCTOU: this read and the writeFileSync below are not atomic. Two truly
// concurrent SessionEnd dispatches for the same session_id could both read
// "not deduped" before either write lands, and both spawn. Bounded worst
// case is a duplicate sub-session / duplicate daily-note entry — never
// corruption — so this is left as a plain read-then-write rather than
// reworked into a lock or atomic rename.
if (isDeduped()) process.exit(0);

try {
  fs.writeFileSync(stateFile, JSON.stringify({ session_id: sessionId, loggedAt: Date.now() }));
} catch {
  // Best-effort; a failed write only risks a duplicate spawn later, never a crash.
}

const runnerPath =
  runnerPathOverride(process.argv) ||
  path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    "..",
    "scripts",
    "session-log-runner.mjs",
  );

spawnDetachedRunner(runnerPath, [transcriptPath, sessionId, projectRoot], "session_log");

process.exit(0);
