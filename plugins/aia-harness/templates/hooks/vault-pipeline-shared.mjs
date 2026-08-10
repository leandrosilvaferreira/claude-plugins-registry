/**
 * Shared logic for the vault-knowledge pipeline's hook/runner pairs:
 * compile.mjs + compile-runner.mjs (daily-note idempotency hash) and
 * session-log.mjs + session-log-runner.mjs (substantive-turn filter). Each
 * pair needs the *cheap* hook gate and the *detached runner* that does the
 * real work to agree exactly — a drift between two copies of the same
 * predicate means the hook's gate opens while the runner finds nothing to
 * act on, or (for the hash) that the runner's idempotency record never
 * matches what the hook checks next session. Not a hook itself — a shared
 * helper other hooks/scripts `import` by relative path, same pattern as
 * session-scratch.mjs.
 *
 * @module hooks/vault-pipeline-shared
 */
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { spawn } from "node:child_process";
import {
  unlinkBrokenWikilinks,
  consolidateRelatedSections,
  countNoteLines,
} from "./vault-note-merge.mjs";

/**
 * First 16 hex chars of the sha256 of a file's bytes. Used as the
 * idempotency key for compile.mjs / compile-runner.mjs: a daily note is
 * "already compiled" when this hash matches what's recorded in
 * compile-state.json.
 * @param {string} filePath
 * @returns {string}
 */
export function hashOf(filePath) {
  return crypto.createHash("sha256").update(fs.readFileSync(filePath)).digest("hex").slice(0, 16);
}

/**
 * Same as hashOf(), but returns null for a file that does not exist instead
 * of throwing — used to snapshot a note's "before" state when the note may
 * be brand new (nothing to hash yet is a valid, expected state, not an
 * error).
 * @param {string} filePath
 * @returns {string | null}
 */
export function hashOfIfExists(filePath) {
  try {
    return hashOf(filePath);
  } catch {
    return null;
  }
}

/**
 * Anti-recursion guard — must be called first, before reading stdin. Both
 * session-log-runner.mjs and compile-runner.mjs set CLAUDE_INVOKED_BY on the
 * sub-session they spawn; without this guard, that sub-session's own
 * SessionEnd/SessionStart hook invocation would spawn another runner, which
 * would spawn another sub-session, forever.
 */
export function exitIfInvokedBySelf() {
  if (process.env.CLAUDE_INVOKED_BY) process.exit(0);
}

/**
 * Purpose-C project-root resolution (see
 * .claude/rules/hooks-cwd-resolution.md): CLAUDE_PROJECT_DIR wins over
 * event.cwd, the opposite precedence of an operational directory, because
 * the vault/.mcp.json are project-wide resources that must be the SAME
 * across every worktree and a worktree's event.cwd almost never has its own
 * copy of a gitignored resource like .vault-obsidian/.
 * @param {any} event
 * @returns {string}
 */
export function resolveProjectRootPurposeC(event) {
  const cwdArg = typeof event?.cwd === "string" && event.cwd ? event.cwd : "";
  return process.env.CLAUDE_PROJECT_DIR || cwdArg || process.cwd();
}

/**
 * True when <projectRoot>/.mcp.json parses and declares mcpServers.obsidian.
 * @param {string} projectRoot
 * @returns {boolean}
 */
export function hasObsidianServer(projectRoot) {
  try {
    const parsed = JSON.parse(fs.readFileSync(path.join(projectRoot, ".mcp.json"), "utf8"));
    return !!(
      parsed &&
      typeof parsed === "object" &&
      parsed.mcpServers &&
      parsed.mcpServers.obsidian
    );
  } catch {
    return false;
  }
}

/**
 * Test-only override for which runner script gets spawned, read from argv as
 * `--runner=<path>` — never an env var (see either hook's own doc comment for
 * why: an ambient env var is reachable from anything in the inherited
 * environment, argv is not, in production Claude Code passes no extra argv).
 * @param {string[]} argv
 * @returns {string}
 */
export function runnerPathOverride(argv) {
  const arg = argv.find((a) => typeof a === "string" && a.startsWith("--runner="));
  return arg ? arg.slice("--runner=".length) : "";
}

/**
 * Spawns `runnerPath` detached with the given argv, tagging its env with
 * CLAUDE_INVOKED_BY so it never re-enters the hook that spawned it. Swallows
 * every spawn error — a hook must never block session start/end on this —
 * and reports whether the spawn was actually handed off, so a caller holding
 * a lock on the runner's behalf can release it instead of leaking it.
 * @param {string} runnerPath
 * @param {string[]} args
 * @param {string} invokedByValue
 * @returns {boolean} true when the child was spawned, false on a spawn error
 */
export function spawnDetachedRunner(runnerPath, args, invokedByValue) {
  try {
    const child = spawn(process.execPath, [runnerPath, ...args], {
      detached: true,
      stdio: "ignore",
      windowsHide: true,
      env: { ...process.env, CLAUDE_INVOKED_BY: invokedByValue },
    });
    child.on("error", () => {});
    child.unref();
    return true;
  } catch {
    // never block the hook's own exit on a spawn failure
    return false;
  }
}

/**
 * How long the compile lock may sit before a later session treats it as
 * abandoned and takes it over. The lock is taken by compile.mjs and released
 * by the compile-runner.mjs process it spawns, so a runner killed outright
 * (machine sleep, reboot, SIGKILL) — or one whose module never finishes
 * loading, e.g. a missing SDK dependency — never removes its own lock. With
 * no takeover window the whole pipeline would then be dead permanently, which
 * is a worse failure than briefly serialising too eagerly. 30 minutes clears
 * the slowest realistic run of an LLM sub-session by a wide margin.
 */
const COMPILE_LOCK_STALE_MS = 30 * 60_000;

/**
 * @param {string} projectRoot
 * @returns {string}
 */
function compileLockPath(projectRoot) {
  return path.join(projectRoot, ".claude", "hooks", "log", "compile.lock");
}

/**
 * Takes the project-wide compile lock, returning false when another compile
 * is already in flight. Project-level (Purpose C, same path for every
 * worktree of the project) on purpose: it guards a project-wide resource —
 * one daily note being promoted into one set of PARA notes — so a
 * per-session key would let every parallel session hold its own lock and
 * guard nothing.
 *
 * This is a single global lock: exactly one compile runs per project at a
 * time. That ceiling is fine while the pipeline compiles one daily note per
 * session start; per-daily-file locks would only be worth it if several
 * different daily notes ever had to compile concurrently.
 *
 * Fails **closed** — an unwritable lock directory returns "" and skips
 * this session's compile rather than spawning unguarded. Skipping is free
 * (the next session retries, since the runner records success only when it
 * really wrote) and the hook still exits 0 either way, so a session is never
 * blocked; spawning unguarded is the actual bug this exists to prevent.
 *
 * Returns the **ownership nonce** written into the lock file, which
 * touchCompileLock/releaseCompileLock take to prove they still hold the lock
 * they are about to refresh or remove. Falsy ("") on failure, so a caller
 * that only ever tested this for truthiness keeps working unchanged.
 *
 * @param {string} projectRoot
 * @returns {string} the ownership nonce when the lock is now held, "" otherwise
 */
export function acquireCompileLock(projectRoot) {
  const lockPath = compileLockPath(projectRoot);
  const nonce = crypto.randomUUID();
  try {
    fs.mkdirSync(path.dirname(lockPath), { recursive: true });
  } catch {
    return "";
  }
  // Two attempts: the first can legitimately lose to a stale lock, which the
  // catch below clears; the second is the real one. Bounded on purpose —
  // losing twice means a live competitor, not a stale file.
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      // "wx" is create-or-fail in one syscall, which is the whole point: a
      // stat-then-write check is exactly the read-then-act race this guards
      // against, so two sessions arriving together cannot both win here.
      //
      // The contents are the ownership nonce, deliberately NOT the pid: the
      // pid here would be the short-lived *hook* process that took the lock,
      // which has already exited by the time the lock matters, while the
      // process actually holding it is the detached runner the hook spawned.
      // Liveness is still decided by the stale window above, never by probing
      // a pid — the nonce answers a different question: "is the lock at this
      // path still the one I took?", which is what stops a runner whose lock
      // was taken over mid-batch from refreshing, and then deleting, the
      // lock now belonging to somebody else.
      fs.writeFileSync(lockPath, nonce, { flag: "wx" });
      return nonce;
    } catch {
      try {
        if (Date.now() - fs.statSync(lockPath).mtimeMs < COMPILE_LOCK_STALE_MS) return "";
        fs.unlinkSync(lockPath);
      } catch {
        // Vanished or unreadable mid-check — treat the other side as the
        // winner rather than racing it for the takeover.
        return "";
      }
    }
  }
  return "";
}

/**
 * The ownership nonce currently in the lock file, or null when there is no
 * readable lock. The detached runner reads this once at startup: the hook
 * that took the lock on its behalf is a different, already-exited process, so
 * the nonce cannot be handed over in argv without changing the runner's argv
 * contract (which `commands/add-obsidian.md` Step 5a documents as a coupling
 * installers must adjudicate).
 *
 * Residual, stated honestly rather than papered over: a takeover in the window
 * between the hook's acquire and this first read hands the runner somebody
 * else's nonce, and it will then happily refresh and release that lock. The
 * window is milliseconds against a 30-minute stale threshold, and it is the
 * mid-batch takeover — minutes to hours wide — that actually bit the precedent
 * project. A lock file written by anything other than this acquire (e.g. the
 * pre-nonce pid format left by an older installed copy of these hooks) simply
 * never matches, so release becomes a no-op and the file is cleared by the
 * stale window instead of by release.
 * @param {string} projectRoot
 * @returns {string | null}
 */
export function readCompileLockNonce(projectRoot) {
  try {
    return fs.readFileSync(compileLockPath(projectRoot), "utf8");
  } catch {
    return null;
  }
}

/**
 * Releases the compile lock. Called by compile-runner.mjs when it finishes
 * (success or failure alike), and by compile.mjs when the spawn it took the
 * lock for never happened. Never throws — an already-absent lock is the
 * expected state after a stale takeover.
 *
 * With `nonce`, the file is removed only when it still holds that exact value;
 * a mismatch is a silent no-op, so a runner whose lock was taken over mid-batch
 * cannot delete the lock the new owner is relying on. Without `nonce` the
 * removal is unconditional, preserving the original behaviour for any caller
 * that has no nonce to offer.
 * @param {string} projectRoot
 * @param {string | null} [nonce]
 */
export function releaseCompileLock(projectRoot, nonce) {
  if (nonce != null && readCompileLockNonce(projectRoot) !== nonce) return;
  try {
    fs.unlinkSync(compileLockPath(projectRoot));
  } catch {
    // already gone (or never created) — nothing to undo
  }
}

/**
 * True for a transcript entry that represents a substantive turn: a real
 * human user message (text content) or an assistant reply containing actual
 * text — never a synthetic tool_result (user) or a tool_use/thinking-only
 * message (assistant). Without this distinction, one tool call yields ~4
 * raw user/assistant-typed lines (tool_use, tool_result, and the turns
 * around them), which would clear a turn-count gate on tool traffic alone
 * and pad a digest with noise instead of substance. Defensive by
 * construction: property access only, never throws on an unexpected shape —
 * an unrecognized shape simply doesn't count.
 * @param {any} parsed
 * @returns {boolean}
 */
export function isSubstantiveTurn(parsed) {
  if (!parsed || (parsed.type !== "user" && parsed.type !== "assistant")) return false;
  const content = parsed.message && parsed.message.content;
  if (typeof content === "string") return content.trim().length > 0;
  if (!Array.isArray(content)) return false;
  return content.some(
    (/** @type {any} */ block) =>
      block &&
      typeof block === "object" &&
      block.type === "text" &&
      typeof block.text === "string" &&
      block.text.trim().length > 0,
  );
}

/**
 * True for an assistant-message content block that is a tool_use call to one
 * of the tool names in `writeToolNames`. Shared between session-log-runner.mjs
 * (whose only write tool is add_daily_note_tool) and compile-runner.mjs
 * (create_note_tool / update_note_tool) — each passes its own allowed set.
 * @param {any} block
 * @param {Set<string>} writeToolNames
 * @returns {boolean}
 */
export function isWriteToolUse(block, writeToolNames) {
  return (
    !!block &&
    typeof block === "object" &&
    block.type === "tool_use" &&
    typeof block.name === "string" &&
    writeToolNames.has(block.name)
  );
}

/**
 * True for a user-message content block that is a non-error tool_result for
 * one of the tool_use ids in `pendingIds`. Identical for both runners — used
 * to confirm a tracked write tool_use actually came back without error before
 * counting it as a real write.
 * @param {any} block
 * @param {Set<string>} pendingIds
 * @returns {boolean}
 */
export function isSuccessfulWriteResult(block, pendingIds) {
  return (
    !!block &&
    typeof block === "object" &&
    block.type === "tool_result" &&
    typeof block.tool_use_id === "string" &&
    pendingIds.has(block.tool_use_id) &&
    block.is_error !== true
  );
}

/**
 * Reads mcpServers.obsidian from the project's .mcp.json and forces
 * alwaysLoad:true. Required: without it, the SDK's default non-blocking MCP
 * startup can build turn 1 before a `uvx` cold/warm-started obsidian server
 * has finished connecting, so its tools are never offered to the model and it
 * completes having called nothing at all (see
 * .claude/memory/sdk-subsession-mcp-tools.md).
 * @param {string} projectDir
 * @returns {import("@anthropic-ai/claude-agent-sdk").McpServerConfig | null}
 */
export function readObsidianServerConfig(projectDir) {
  const raw = fs.readFileSync(path.join(projectDir, ".mcp.json"), "utf8");
  const parsed = JSON.parse(raw);
  const server = parsed?.mcpServers?.obsidian;
  if (!server || typeof server !== "object") return null;
  return { ...server, alwaysLoad: true };
}

/**
 * Appends one best-effort outcome line to
 * <projectDir>/.claude/hooks/log/<logFilename>, shaped
 * `<ISO timestamp> <fieldName>=<value> outcome=<outcome>`. Never throws —
 * logging must never itself be a point of failure. `fieldValue` and
 * `outcome` are sanitized (CR/LF stripped) so a value containing a newline
 * (e.g. an adversarial session_id, or model-controlled outcome text) cannot
 * inject a second, fabricated log line.
 * @param {string} projectDir
 * @param {string} logFilename
 * @param {string} fieldName
 * @param {string} fieldValue
 * @param {string} outcome
 */
export function appendLog(projectDir, logFilename, fieldName, fieldValue, outcome) {
  try {
    const logDir = path.join(projectDir, ".claude", "hooks", "log");
    fs.mkdirSync(logDir, { recursive: true });
    const safeValue = String(fieldValue).replace(/[\r\n]/g, " ");
    const safeOutcome = String(outcome).replace(/[\r\n]/g, " ");
    const line = `${new Date().toISOString()} ${fieldName}=${safeValue} outcome=${safeOutcome}\n`;
    fs.appendFileSync(path.join(logDir, logFilename), line);
  } catch {
    // Fail silently — logging is best-effort, never itself a point of failure.
  }
}

/**
 * True when `toolInput` for an mcp__obsidian__update_note_tool call would
 * replace the whole note instead of appending to it — i.e. `merge_strategy`
 * is anything other than the literal string "append". update_note_tool
 * defaults to a full replace (see .claude/rules/obsidian.md's Write-tool
 * traps section), so a call reaching the server without this exact value
 * would silently destroy the note's existing content. Defensive by
 * construction: a non-object `toolInput` counts as destructive rather than
 * throwing.
 * @param {unknown} toolInput
 * @returns {boolean}
 */
export function isDestructiveUpdateNoteCall(toolInput) {
  if (!toolInput || typeof toolInput !== "object") return true;
  return /** @type {{merge_strategy?: unknown}} */ (toolInput).merge_strategy !== "append";
}

/**
 * True when `notePath` does not fall under any of `allowedFolderPrefixes`.
 * Each prefix matches a full path segment — "03-knowledge" matches
 * "03-knowledge/foo.md" but not "03-knowledge-evil/foo.md". A `..` segment
 * anywhere in the path counts as outside unconditionally — a naive prefix
 * check alone would accept "03-knowledge/../../secrets.md" (it does start
 * with "03-knowledge/"), letting a traversal segment escape the allowed
 * folder despite passing the check. Defensive: a non-string `notePath`
 * counts as outside rather than throwing.
 *
 * A backslash anywhere is rejected outright: vault paths are forward-slashed
 * by contract (the MCP server's own path convention), so a backslash is never
 * legitimate here — and on Windows "03-knowledge/..\\..\\evil.md" resolves
 * outside the vault while splitting on "/" alone sees one long, innocuous
 * filename segment and reports "not outside". Confirmed with path.win32.join,
 * not theorised. The segment split below tolerates both separators too, so
 * the traversal check keeps working even if this earlier reject is ever
 * loosened.
 * @param {unknown} notePath
 * @param {string[]} allowedFolderPrefixes
 * @returns {boolean}
 */
export function isPathOutsideAllowedFolders(notePath, allowedFolderPrefixes) {
  if (typeof notePath !== "string") return true;
  if (notePath.includes("\\")) return true;
  if (notePath.split(/[\\/]/).includes("..")) return true;
  return !allowedFolderPrefixes.some(
    (prefix) => notePath === prefix || notePath.startsWith(`${prefix}/`),
  );
}

/**
 * Best-effort text extraction from a content value that is either a plain
 * string or an array of typed content blocks — only `{type:"text", text}`
 * blocks are rendered; tool_use/tool_result/thinking blocks or any
 * unrecognized shape are dropped rather than rendered as noise. Shared
 * between session-log-runner.mjs's transcript-digest rendering and this
 * module's own extractToolResultErrorText — both need the identical rule for
 * what counts as renderable text, not two silently-drifting copies of it.
 * @param {unknown} content
 * @returns {string}
 */
export function renderTypedContent(content) {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .map((/** @type {any} */ block) =>
      block && typeof block === "object" && block.type === "text" && typeof block.text === "string"
        ? block.text
        : "",
    )
    .filter(Boolean)
    .join(" ");
}

/**
 * Extracts the error text from an error tool_result content block via
 * renderTypedContent. Returns "" for a non-error result or any unrecognized
 * shape, never throws.
 * @param {any} block
 * @returns {string}
 */
export function extractToolResultErrorText(block) {
  if (
    !block ||
    typeof block !== "object" ||
    block.type !== "tool_result" ||
    block.is_error !== true
  ) {
    return "";
  }
  return renderTypedContent(block.content);
}

/**
 * True for a user-message content block that is an ERROR tool_result for one
 * of the tool_use ids in `pendingIds` — the mirror image of
 * isSuccessfulWriteResult, used to correlate a tracked write's failure back
 * to its ToolError text.
 * @param {any} block
 * @param {Set<string>} pendingIds
 * @returns {boolean}
 */
export function isErroredTrackedResult(block, pendingIds) {
  return (
    !!block &&
    typeof block === "object" &&
    block.type === "tool_result" &&
    typeof block.tool_use_id === "string" &&
    pendingIds.has(block.tool_use_id) &&
    block.is_error === true
  );
}

/**
 * True when `target` has already been attempted more than `maxRetries`
 * times, per `retryCountByTarget` (a target never attempted before reads as
 * 0 prior attempts). Pure decision only — does not itself increment the
 * counter; the caller increments after this returns false, so a call that
 * ends up denied for a different reason still consumes an attempt slot
 * (matching this pipeline's intent: a merge_strategy-denied-then-corrected
 * retry consumes exactly the one legitimate retry budget).
 * @param {Map<string, number>} retryCountByTarget
 * @param {string} target
 * @param {number} maxRetries
 * @returns {boolean}
 */
export function isRetryBudgetExhausted(retryCountByTarget, target, maxRetries) {
  return (retryCountByTarget.get(target) ?? 0) > maxRetries;
}

/**
 * Local-time YYYY-MM-DD for "today". Deliberately NOT
 * `new Date().toISOString().slice(0, 10)`, which is UTC-based and would name
 * tomorrow's date in the evening for any timezone west of UTC — the same trap
 * documented on compile.mjs's former yesterday() helper.
 * @returns {string}
 */
export function todayLocal() {
  const d = new Date();
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${month}-${day}`;
}

/**
 * Path of the project-level, CROSS-session compile cache. Deliberately not a
 * session scratch dir (see .claude/rules/hooks-cwd-resolution.md, Purpose C):
 * its whole job is to survive across sessions so an unchanged daily note is
 * not recompiled on every session start.
 * @param {string} projectRoot
 * @returns {string}
 */
export function compileStatePath(projectRoot) {
  return path.join(projectRoot, ".claude", "hooks", "log", "compile-state.json");
}

/**
 * Reads compile-state.json. Missing or corrupt reads as {} — never throws,
 * because a corrupt cache must degrade into "recompile" rather than into a
 * crashed hook.
 * @param {string} projectRoot
 * @returns {Record<string, any>}
 */
export function readCompileState(projectRoot) {
  try {
    const parsed = JSON.parse(fs.readFileSync(compileStatePath(projectRoot), "utf8"));
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

/**
 * How many times one daily note may end a compile without reaching a terminal
 * conclusion before it is abandoned. Each attempt costs a full LLM sub-session
 * and — since the batch is capped and ordered oldest-first — occupies a slot
 * every session, ahead of every newer daily behind it, so an unbounded retry is
 * how one poisoned note starves the whole pipeline. Abandoning is not deleting:
 * the daily stays on disk, the runner logs why it gave up, and editing the file
 * (which changes its hash) restores it to pending with a fresh budget.
 */
export const MAX_COMPILE_ATTEMPTS = 3;

/**
 * A state entry's recorded attempt count. Missing/non-numeric reads as 0, so an
 * entry written before this field existed starts with a full budget rather than
 * being retired on sight.
 * @param {any} entry
 * @returns {number}
 */
function readAttempts(entry) {
  return typeof entry?.attempts === "number" && entry.attempts > 0 ? entry.attempts : 0;
}

/**
 * Daily notes still awaiting compilation, oldest first.
 *
 * Replaces the old single-day `yesterday()` window, which permanently skipped
 * any daily note whose next calendar day happened to start no session — a gap
 * confirmed against this repo's own vault, not theorised.
 *
 * Today's daily is always excluded: session-log-runner.mjs is still appending
 * to it, so compiling it would promote a half-written log. Comparison is
 * lexicographic, which is equivalent to date order for fixed-width YYYY-MM-DD.
 *
 * A recorded entry with `partial: true` never retires its daily, even when its
 * hash still matches the current content: that run never proved it finished
 * reading the daily, so it stays pending by design until a future attempt
 * reaches a terminal success. The recorded fingerprints on that entry are what
 * stop the retry from re-promoting what already landed — see the PreToolUse
 * guard in compile-runner.mjs — not this exclusion.
 *
 * That retry is bounded by `attempts` (see MAX_COMPILE_ATTEMPTS): a daily whose
 * content is unchanged since its last failure and that has already burned its
 * attempt budget is retired, so a permanently-failing daily cannot occupy a
 * batch slot every session forever, ahead of every newer daily behind it. It is
 * only ever retired, never deleted — and editing the daily changes its hash,
 * which restores it to pending with a fresh budget.
 *
 * `dailyDir` is a parameter rather than derived here on purpose — this module
 * must stay free of the vault directory name so its template copy needs no
 * __OBSIDIAN_VAULT_DIR__ placeholder.
 *
 * @param {string} dailyDir absolute path to the vault's daily/ directory
 * @param {Record<string, any>} state parsed compile-state.json
 * @returns {string[]} filenames (not paths), ascending
 */
export function listPendingDailies(dailyDir, state) {
  /** @type {string[]} */
  let entries = [];
  try {
    entries = fs.readdirSync(dailyDir);
  } catch {
    return []; // missing or unreadable directory -> nothing pending
  }
  const today = todayLocal();
  /** @type {string[]} */
  const pending = [];
  for (const name of entries) {
    const match = /^(\d{4}-\d{2}-\d{2})\.md$/.exec(name);
    if (!match) continue;
    if (match[1] >= today) continue;
    // A directory named like a daily note, or a file that vanished mid-scan,
    // hashes to null and is skipped rather than crashing the gate.
    const current = hashOfIfExists(path.join(dailyDir, name));
    if (current === null) continue;
    const recorded = state?.[name];
    if (recorded && typeof recorded === "object" && recorded.hash === current) {
      // Compiled to a terminal conclusion at this exact content.
      if (recorded.partial !== true) continue;
      // Still partial, but out of attempts at this content — abandoned.
      if (readAttempts(recorded) >= MAX_COMPILE_ATTEMPTS) continue;
    }
    pending.push(name);
  }
  return pending.sort();
}

/**
 * Moves the compile lock's mtime to now. acquireCompileLock treats a lock
 * older than COMPILE_LOCK_STALE_MS as abandoned; that window was sized for a
 * single LLM sub-session, but the runner now processes every pending daily in
 * one batch and can legitimately outlive it. Without this refresh a second
 * session steals the lock mid-batch and both runners promote the same dailies
 * concurrently — the precise failure the swapo precedent hit (49 concurrent
 * executions, 40 duplicated notes). Never throws: a lock already taken over is
 * the expected state, not an error.
 *
 * With `nonce`, the refresh happens only when the lock file still holds that
 * exact value, and the return value reports whether it did. The heartbeat only
 * fires between dailies, so a sub-session that outlives the stale window loses
 * the lock mid-daily; without this check the displaced runner would keep the
 * *new* owner's lock alive while running unguarded beside it. A `false` return
 * is the caller's signal to stop, not something to retry. Without `nonce` the
 * refresh is unconditional, preserving the original behaviour.
 * @param {string} projectRoot
 * @param {string | null} [nonce]
 * @returns {boolean} true when the lock was refreshed (i.e. still owned)
 */
export function touchCompileLock(projectRoot, nonce) {
  if (nonce != null && readCompileLockNonce(projectRoot) !== nonce) return false;
  try {
    const now = new Date();
    fs.utimesSync(compileLockPath(projectRoot), now, now);
    return true;
  } catch {
    // gone or unwritable — nothing to refresh
    return false;
  }
}

/**
 * Normalizes note content for fingerprint comparison: drops a leading YAML
 * frontmatter block, drops ATX heading lines, collapses blank-line runs,
 * trims, lowercases. Ported from swapo's _dedup.py `_normalize_content`.
 *
 * The frontmatter regex intentionally has NO `m` flag — the Python omits
 * MULTILINE so only a block at offset 0 is stripped; adding `m` would eat any
 * `---` fence mid-document and silently change every fingerprint.
 *
 * toLowerCase(), never toLocaleLowerCase(): the latter is locale-dependent
 * (Turkish dotted/dotless I) and would make a hash machine-dependent.
 *
 * @param {unknown} text
 * @returns {string}
 */
export function normalizeNoteContent(text) {
  if (typeof text !== "string") return "";
  return text
    .replace(/^---\n[\s\S]*?\n---\n/, "")
    .replace(/^#{1,6}\s+.*$/gm, "")
    .replace(/\n{2,}/g, "\n")
    .trim()
    .toLowerCase();
}

/**
 * Identity of one promoted learning, used to stop a retry of a partially
 * failed compile from re-promoting what already landed.
 *
 * Truncation happens BEFORE normalization, matching the Python — reversing the
 * order changes every hash. Only the content is normalized; folder, slug and
 * action are concatenated verbatim, so callers must pass a stable lowercase
 * action ("created" / "updated").
 *
 * @param {string} folder first path segment, e.g. "03-knowledge"
 * @param {string} slug   basename without ".md"
 * @param {string} action "created" | "updated"
 * @param {unknown} contentSnippet the write's proposed content
 * @returns {string} 16 hex chars
 */
export function buildLearningFingerprint(folder, slug, action, contentSnippet) {
  const snippet = typeof contentSnippet === "string" ? contentSnippet.slice(0, 200) : "";
  const raw = `${folder}|${slug}|${action}|${normalizeNoteContent(snippet)}`;
  return crypto.createHash("sha256").update(raw, "utf8").digest("hex").slice(0, 16);
}

/**
 * Line ceiling a promoted note should stay under. Mirrors this vault's
 * OBSIDIAN_MAX_NOTE_LINES. The server's size policy is "warn", so it writes an
 * oversized note anyway and returns a warning to a caller that discards it —
 * which is why the guard below has to measure this itself.
 */
export const MAX_NOTE_LINES = 500;

/**
 * Every wikilink target that resolves in this vault: for each note, both its
 * basename and its vault-relative path, each without the ".md" suffix — the
 * server resolves either form.
 *
 * The exclusion list is deliberately NARROWER than a "content notes" scan:
 * daily/ and templates/ notes are perfectly valid link targets even though
 * they are never promotion destinations.
 *
 * Relative paths are joined with "/" explicitly rather than path.join, so a
 * Windows run produces the same target strings as a POSIX one.
 *
 * @param {string} vaultRoot
 * @returns {Set<string>}
 */
export function collectValidTargets(vaultRoot) {
  const skipTopLevel = new Set(["_meta", ".obsidian", ".trash", ".git"]);
  /** @type {Set<string>} */
  const targets = new Set();
  /**
   * @param {string} dir
   * @param {string} rel
   */
  const walk = (dir, rel) => {
    /** @type {import("node:fs").Dirent[]} */
    let entries = [];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return; // unreadable subtree — skip it, never fail the whole scan
    }
    for (const entry of entries) {
      if (entry.isDirectory()) {
        if (rel === "" && skipTopLevel.has(entry.name)) continue;
        walk(path.join(dir, entry.name), rel ? `${rel}/${entry.name}` : entry.name);
      } else if (entry.isFile() && entry.name.endsWith(".md")) {
        const stem = entry.name.slice(0, -3);
        targets.add(stem);
        targets.add(rel ? `${rel}/${stem}` : stem);
      }
    }
  };
  walk(vaultRoot, "");
  return targets;
}

/**
 * The absolute path of `relPath` inside `vaultRoot`, or null when it does not
 * actually land inside the vault. An exported write primitive must not depend
 * on its caller having pre-validated the paths it is handed: `..` segments and
 * (on Windows) backslash separators both escape a plain join, and the caller
 * here is fed note paths a language model chose. Resolve-then-contain rather
 * than pattern-matching the input, so normalisation is the platform's own.
 * @param {string} vaultRoot
 * @param {string} relPath vault-relative, forward-slashed
 * @returns {string | null}
 */
function resolveInsideVault(vaultRoot, relPath) {
  if (typeof relPath !== "string" || relPath.includes("\\")) return null;
  const root = path.resolve(vaultRoot);
  const absolute = path.resolve(root, ...relPath.split("/"));
  return absolute === root || absolute.startsWith(root + path.sep) ? absolute : null;
}

/**
 * Deterministic sanitisation of the notes a compile just wrote. The prompt
 * asks the sub-agent not to invent links or duplicate a Related section; this
 * guarantees it. Scoped to `notePaths` — the notes this run actually wrote and
 * confirmed on disk — so a pre-existing problem elsewhere in the vault is
 * never silently rewritten by an unrelated compile.
 *
 * Oversized notes are reported, never split: splitting would cost a second LLM
 * sub-session per note.
 *
 * Every per-note failure is swallowed. This runs after the promotion already
 * succeeded; a guard that could fail the compile would be worse than the
 * cosmetic problems it fixes.
 *
 * @param {string} vaultRoot
 * @param {Iterable<string>} notePaths vault-relative, forward-slashed
 * @param {Set<string>} validTargets from collectValidTargets
 * @param {number} [maxNoteLines]
 * @returns {{ unlinked: number, consolidated: number, oversized: {path: string, lines: number}[] }}
 */
export function applyPostWriteGuard(
  vaultRoot,
  notePaths,
  validTargets,
  maxNoteLines = MAX_NOTE_LINES,
) {
  let unlinked = 0;
  let consolidated = 0;
  /** @type {{path: string, lines: number}[]} */
  const oversized = [];
  for (const notePath of notePaths) {
    const absolute = resolveInsideVault(vaultRoot, notePath);
    if (absolute === null) continue; // escapes the vault — never read, never write
    let original = "";
    try {
      original = fs.readFileSync(absolute, "utf8");
    } catch {
      continue; // vanished or unreadable — nothing to sanitise
    }
    const unlinkResult = unlinkBrokenWikilinks(original, validTargets);
    const relatedResult = consolidateRelatedSections(unlinkResult.text);
    if (relatedResult.text !== original) {
      try {
        fs.writeFileSync(absolute, relatedResult.text);
      } catch {
        continue; // could not persist the fix — report nothing further for this note
      }
      // Counted only after the write actually landed: these numbers are the
      // sole record of what the guard did in compile.log, so incrementing
      // before the write over-reports a fix that never reached disk.
      unlinked += unlinkResult.count;
      consolidated += relatedResult.removed;
    }
    const lines = countNoteLines(relatedResult.text);
    if (lines > maxNoteLines) oversized.push({ path: notePath, lines });
  }
  return { unlinked, consolidated, oversized };
}

/**
 * Every note under the given vault folders, as {relPath, slug}. Scoped to the
 * promotion destinations rather than the whole vault: only a note the pipeline
 * could itself create is a duplication candidate, so daily/ and templates/ are
 * irrelevant here (unlike collectValidTargets, where they are valid link
 * targets and must be included).
 *
 * Paths are forward-slashed regardless of platform, since they are compared
 * and rendered into a prompt.
 *
 * @param {string} vaultRoot
 * @param {string[]} folders top-level folder names, e.g. the PARA four
 * @returns {{relPath: string, slug: string}[]} sorted by relPath
 */
export function listVaultNotes(vaultRoot, folders) {
  /** @type {{relPath: string, slug: string}[]} */
  const notes = [];
  /**
   * @param {string} dir
   * @param {string} rel
   */
  const walk = (dir, rel) => {
    /** @type {import("node:fs").Dirent[]} */
    let entries = [];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return; // folder absent or unreadable — nothing to inventory
    }
    for (const entry of entries) {
      if (entry.isDirectory()) {
        walk(path.join(dir, entry.name), `${rel}/${entry.name}`);
      } else if (entry.isFile() && entry.name.endsWith(".md")) {
        notes.push({ relPath: `${rel}/${entry.name}`, slug: entry.name.slice(0, -3) });
      }
    }
  };
  for (const folder of folders) walk(path.join(vaultRoot, folder), folder);
  return notes.sort((a, b) => (a.relPath < b.relPath ? -1 : a.relPath > b.relPath ? 1 : 0));
}
