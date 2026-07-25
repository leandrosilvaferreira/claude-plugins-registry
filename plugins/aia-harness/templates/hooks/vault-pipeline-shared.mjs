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
 * Reads all of stdin as utf8, or "" if it can't be read (e.g. not connected
 * to a pipe). Never throws.
 * @returns {string}
 */
export function readStdinRaw() {
  try {
    return fs.readFileSync(0, "utf8");
  } catch {
    return "";
  }
}

/**
 * Parses a hook's stdin JSON, returning null for anything that isn't a
 * genuine object — including unparseable input AND the literal JSON value
 * `null` (valid JSON that parses without throwing, so `JSON.parse(x || "{}")`
 * alone does not catch it; see .claude/memory/hook-stdin-null-crash.md).
 * @param {string} raw
 * @returns {any | null}
 */
export function parseHookEvent(raw) {
  try {
    const event = JSON.parse(raw || "{}");
    return typeof event === "object" && event !== null ? event : null;
  } catch {
    return null;
  }
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
 * Fails **closed** — an unwritable lock directory returns false and skips
 * this session's compile rather than spawning unguarded. Skipping is free
 * (the next session retries, since the runner records success only when it
 * really wrote) and the hook still exits 0 either way, so a session is never
 * blocked; spawning unguarded is the actual bug this exists to prevent.
 *
 * @param {string} projectRoot
 * @returns {boolean} true when the lock is now held by this process
 */
export function acquireCompileLock(projectRoot) {
  const lockPath = compileLockPath(projectRoot);
  try {
    fs.mkdirSync(path.dirname(lockPath), { recursive: true });
  } catch {
    return false;
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
      // The contents are debugging breadcrumbs only, never read back by
      // anything — and note whose pid it is: the short-lived *hook* process
      // that took the lock, which has already exited by the time the lock
      // matters. The process actually holding it is the detached runner the
      // hook spawned, whose pid is deliberately not tracked (liveness is
      // decided by the stale window above, not by probing a pid). Don't
      // "fix" a stuck lock by looking this pid up — it is always dead.
      fs.writeFileSync(lockPath, String(process.pid), { flag: "wx" });
      return true;
    } catch {
      try {
        if (Date.now() - fs.statSync(lockPath).mtimeMs < COMPILE_LOCK_STALE_MS) return false;
        fs.unlinkSync(lockPath);
      } catch {
        // Vanished or unreadable mid-check — treat the other side as the
        // winner rather than racing it for the takeover.
        return false;
      }
    }
  }
  return false;
}

/**
 * Releases the compile lock. Called by compile-runner.mjs when it finishes
 * (success or failure alike), and by compile.mjs when the spawn it took the
 * lock for never happened. Never throws — an already-absent lock is the
 * expected state after a stale takeover.
 * @param {string} projectRoot
 */
export function releaseCompileLock(projectRoot) {
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
 * @param {unknown} notePath
 * @param {string[]} allowedFolderPrefixes
 * @returns {boolean}
 */
export function isPathOutsideAllowedFolders(notePath, allowedFolderPrefixes) {
  if (typeof notePath !== "string") return true;
  if (notePath.split("/").includes("..")) return true;
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
