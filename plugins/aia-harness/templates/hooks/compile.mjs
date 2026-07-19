#!/usr/bin/env node
/**
 * SessionStart hook — vault knowledge compiler. Thin gate + detached spawn:
 * this hook does no LLM work itself. It cheaply decides whether yesterday's
 * daily note is new or changed since the last successful compile, then
 * spawns compile-runner.mjs (a detached worker under .claude/scripts/, NOT a
 * hook — no stdin event, no stdout contract, no schema) to promote anything
 * durable from it into the right PARA folder (01-projects/02-areas/
 * 03-knowledge/04-resources) out of band, after this hook has already
 * exited. Runs at the *next* session's start so yesterday's daily note is
 * guaranteed complete before it is read.
 *
 * This hook never emits hookSpecificOutput — stdout is exactly "" on every
 * path, always.
 *
 * Gates, in order (any failure -> exit 0, no spawn):
 *   1. CLAUDE_INVOKED_BY set -> anti-recursion. The runner sets this on its
 *      spawned sub-session's env; without this guard, that sub-session's own
 *      SessionStart would re-enter this very pipeline.
 *   2. stdin invalid / non-object / literal null -> exit 0.
 *   3. <projectRoot>/.vault-obsidian/daily/<yesterday>.md does not exist ->
 *      exit 0. <yesterday> is local-time YYYY-MM-DD, computed as
 *      Date.now() - 86_400_000 — never today's still-open daily note.
 *   4. <projectRoot>/.mcp.json missing/unparseable/no mcpServers.obsidian ->
 *      exit 0 (the runner cannot work without that server block).
 *   5. idempotency: sha256 of the daily file's current bytes (first 16 hex
 *      chars) already recorded for this filename in
 *      <projectRoot>/.claude/hooks/log/compile-state.json -> exit 0. That
 *      state file is deliberately a project-level, CROSS-session cache —
 *      not sessionScratchDir — because its whole purpose is to survive
 *      across sessions and stop an unchanged daily note from being
 *      recompiled every time a new session starts. It is written only on
 *      success, and only by the runner (never by this hook), so a failed
 *      run retries next session.
 *   6. spawn compile-runner.mjs detached, passing the daily note's absolute
 *      path, its filename, and the project dir as argv; env carries
 *      CLAUDE_INVOKED_BY.
 *   7. exit 0, no stdout.
 *
 * Fails open on every I/O / parse / spawn error — a vault hook must never
 * block a session from starting.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  hashOf,
  exitIfInvokedBySelf,
  readStdinRaw,
  parseHookEvent,
  resolveProjectRootPurposeC,
  hasObsidianServer,
  runnerPathOverride,
  spawnDetachedRunner,
} from "./vault-pipeline-shared.mjs";

exitIfInvokedBySelf();

const event = parseHookEvent(readStdinRaw());
if (event === null) process.exit(0);

// Purpose C — see .claude/rules/hooks-cwd-resolution.md's Purpose C section —
// resolved by resolveProjectRootPurposeC, shared with session-log.mjs.
const projectRoot = resolveProjectRootPurposeC(event);

/**
 * Local-time YYYY-MM-DD for "yesterday". Deliberately NOT
 * `new Date(Date.now() - 86_400_000).toISOString().slice(0, 10)`, which is
 * UTC-based and would pick the wrong calendar date in the evening for any
 * timezone west of UTC.
 * @returns {string}
 */
function yesterday() {
  const d = new Date(Date.now() - 86_400_000);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

const dailyFilename = `${yesterday()}.md`;
const dailyPath = path.join(projectRoot, "__OBSIDIAN_VAULT_DIR__", "daily", dailyFilename);
// fs.existsSync never throws (Node swallows the stat error internally and
// returns false), so no try/catch is needed around it.
if (!fs.existsSync(dailyPath)) process.exit(0);

if (!hasObsidianServer(projectRoot)) process.exit(0);

/**
 * First 16 hex chars of the sha256 of the daily file's current bytes, or
 * null if the file can't be read. Fail-open: if identity can't be
 * established, skip rather than risk an infinite recompile loop or a crash.
 * Delegates the actual hashing to vault-pipeline-shared.mjs's hashOf(),
 * which compile-runner.mjs's own recordSuccess() call uses too — the two
 * must agree, or this idempotency gate never matches what gets recorded.
 * @returns {string|null}
 */
function currentHash() {
  try {
    return hashOf(dailyPath);
  } catch {
    return null;
  }
}
const hash = currentHash();
if (!hash) process.exit(0);

// Deliberately NOT sessionScratchDir(event.session_id) — see the doc
// comment above and .claude/rules/hooks-cwd-resolution.md's Purpose B
// section, which does not apply here: sessionScratchDir exists to avoid
// state colliding across parallel SESSIONS, but this file's entire job is
// to be shared ACROSS sessions (a project-level cache), so it is keyed by
// project dir, not by session id.
const stateFilePath = path.join(projectRoot, ".claude", "hooks", "log", "compile-state.json");

/** @returns {Record<string, {hash: string, timestamp: number}>} */
function readState() {
  try {
    const parsed = JSON.parse(fs.readFileSync(stateFilePath, "utf8"));
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {}; // missing or corrupt -> treated as empty, never crashes
  }
}
const recorded = readState()[dailyFilename];
if (recorded && typeof recorded === "object" && recorded.hash === hash) process.exit(0);

const runnerPath =
  runnerPathOverride(process.argv) ||
  path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "scripts", "compile-runner.mjs");

spawnDetachedRunner(runnerPath, [dailyPath, dailyFilename, projectRoot], "compile");

process.exit(0);
