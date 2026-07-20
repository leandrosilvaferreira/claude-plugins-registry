#!/usr/bin/env node
/**
 * Detached worker spawned by .claude/hooks/session-log.mjs once that hook's
 * own gates pass. NOT a hook: no stdin event, no stdout contract, no output
 * schema to validate — session-log.mjs has already exited by the time this
 * process runs, so nothing is listening on this process's stdout/exit code.
 * Every failure here must be swallowed; there is no caller to surface it to.
 *
 * argv: [transcriptPath, sessionId, projectDir]
 *
 * 1. Reads the transcript JSONL, takes the last MAX_TURNS substantive
 *    user/assistant turns (real text, not synthetic tool_use/tool_result/
 *    thinking-only lines), renders them to a plain-text digest.
 * 2. Reads mcpServers.obsidian from the project's .mcp.json.
 * 3. Calls query() from @anthropic-ai/claude-agent-sdk, scoped to only the
 *    obsidian MCP server and only its add_daily_note_tool. settingSources:[]
 *    is required — without it the sub-session would load this repo's own
 *    .claude/settings.json (and every hook wired in it), firing
 *    UserPromptSubmit (vault-orient nudging a tool outside the allowlist)
 *    and SessionEnd (re-entering this very pipeline). The CLAUDE_INVOKED_BY
 *    guard in each hook is the second layer of that defense; neither layer
 *    alone is sufficient.
 * 4. The prompt instructs the sub-agent to judge whether the session is
 *    worth recording; reply exactly "SKIP" if not, otherwise call
 *    add_daily_note_tool exactly once with a templated Session block.
 * 5. Appends one outcome line to .claude/hooks/log/session-log.log,
 *    best-effort (create the dir if needed; never throw on a failed write).
 *    The outcome is derived from real message-stream evidence — a tool_use
 *    for add_daily_note_tool whose tool_result is not an error — never from
 *    `subtype === "success"` alone or from matching the model's own result
 *    text against "SKIP". A terminal success subtype does not mean a tool
 *    ran: the model can complete "successfully" having called nothing at
 *    all (see .claude/memory/sdk-subsession-mcp-tools.md, trap #3, and this
 *    file's own log at .claude/hooks/log/session-log.log for a real
 *    example — a control run named "notools" once logged "wrote daily
 *    note"). Unlike compile.mjs, this pipeline has no idempotency cache to
 *    poison, so a wrong outcome here was always just a misleading log line
 *    — but it's the same conflation, fixed the same way.
 */
import fs from "node:fs";
import path from "node:path";
import { query } from "@anthropic-ai/claude-agent-sdk";
import {
  isSubstantiveTurn,
  isWriteToolUse,
  isSuccessfulWriteResult,
  isErroredTrackedResult,
  readObsidianServerConfig,
  appendLog,
  extractToolResultErrorText,
  renderTypedContent,
  hashOfIfExists,
} from "../hooks/vault-pipeline-shared.mjs";

/**
 * Local-time YYYY-MM-DD for "today" — add_daily_note_tool always targets
 * today's file (see .claude/rules/obsidian.md), so this is the only path
 * the disk-confirmation snapshot needs to watch.
 * @returns {string}
 */
function todayFilename() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}.md`;
}

const MAX_TURNS = 30;

const PROMPT_INSTRUCTIONS = [
  "You are reviewing a coding session transcript to decide whether it is worth",
  "recording in this project's Obsidian vault.",
  "",
  "This vault is long-term memory — a different, more generous bar than this",
  "project's short-term memory system (.claude/memory/), which only saves",
  "'hard-won' facts (expensive to learn + likely to recur + not derivable",
  "from code). Here, also capture what merely surprised you, what",
  "contradicted a prior assumption, what wasn't obvious just from reading",
  "the code, or what cost real investigation effort — even with no",
  "guarantee it recurs. Err generous.",
  "",
  "Judge whether the session produced anything worth recording: a decision, a",
  "bug found or fixed, a completed piece of work, a non-obvious lesson, an",
  "open follow-up, or anything meeting the resonance bar above. A read-only,",
  "exploratory, or trivial session with no outcome is NOT worth recording.",
  "",
  "If NOT worth recording: call no tools and reply with exactly the single",
  "word SKIP, nothing else.",
  "",
  "If worth recording: call mcp__obsidian__add_daily_note_tool EXACTLY ONCE.",
  "Its `content` argument must be shaped exactly like this template (fill in",
  "the current time for HH:MM, replace every placeholder, and OMIT any",
  "subsection that has no real content — never invent content to fill one):",
  "",
  "## Session — HH:MM — <topic, <=60 chars>",
  "",
  "### Context",
  "<ONE sentence, <=200 chars — the problem or constraint that forced the",
  "decisions below. This is a SINGLE sentence of prose — never a bulleted",
  "list. Omit this whole subsection if there is no real context to give.>",
  "",
  "### What I did",
  "- <past-tense, <=120 chars each>",
  "",
  "### Decisions",
  "- <decision + rationale>",
  "",
  "### Problems",
  "- <bug or obstacle already hit during this session — past tense>",
  "",
  "### Consequences",
  "- <what becomes forbidden, what breaks if a decision above is violated,",
  "  or what it costs going forward — future-facing, distinct from Problems",
  "  (a bug already hit) by tense and direction>",
  "",
  "### Ideas",
  "- <TODO / follow-up>",
  "",
  "### Takeaway",
  "<ONE sentence — the single atomic durable claim from this session. This",
  "is a SINGLE sentence of prose — never a bulleted list. Omit this whole",
  "subsection if nothing rises to a durable claim.>",
  "",
  "Rules:",
  "- Never use [[wikilinks]] to dates or to any note you have not confirmed",
  "  exists in this vault — wikilink policy is strict, and a link to a",
  "  nonexistent note is a hard error.",
  "- Do not call any tool other than mcp__obsidian__add_daily_note_tool.",
  "- Do not call it more than once.",
].join("\n");

// The only tool this pipeline ever legitimately calls. Evidence of it
// completing without error is what "wrote daily note" means below — see
// main()'s message-stream loop.
const WRITE_TOOL_NAMES = new Set(["mcp__obsidian__add_daily_note_tool"]);

/**
 * Reads the transcript JSONL and renders the last MAX_TURNS substantive
 * user/assistant turns (see isSubstantiveTurn) to a plain-text digest, one
 * line per turn.
 * @param {string} transcriptPath
 * @returns {string}
 */
function readDigest(transcriptPath) {
  const raw = fs.readFileSync(transcriptPath, "utf8");
  /** @type {any[]} */
  const turns = [];
  for (const line of raw.split("\n")) {
    if (!line.trim()) continue;
    let parsed;
    try {
      parsed = JSON.parse(line);
    } catch {
      continue;
    }
    if (isSubstantiveTurn(parsed)) turns.push(parsed);
  }
  return turns
    .slice(-MAX_TURNS)
    .map((entry) => {
      const role = entry.type === "user" ? "USER" : "ASSISTANT";
      const text = renderTypedContent(entry?.message?.content);
      return text ? `${role}: ${text}` : "";
    })
    .filter(Boolean)
    .join("\n\n");
}

/**
 * Best-effort write of {sessionId, transcriptPath, digest, outcome, failedAt}
 * to <projectDir>/.claude/hooks/log/pending/<sessionId>.json — written via a
 * temp file + rename so a crash mid-write never leaves a half-written file.
 * Recovery is manual/forensic by design: nothing in this pipeline sweeps or
 * reprocesses this folder automatically.
 * @param {string} projectDir
 * @param {string} sessionId
 * @param {string} transcriptPath
 * @param {string} digest
 * @param {string} outcome
 */
function preservePending(projectDir, sessionId, transcriptPath, digest, outcome) {
  try {
    const pendingDir = path.join(projectDir, ".claude", "hooks", "log", "pending");
    fs.mkdirSync(pendingDir, { recursive: true });
    const finalPath = path.join(pendingDir, `${sessionId}.json`);
    const tmpPath = `${finalPath}.tmp-${process.pid}`;
    fs.writeFileSync(
      tmpPath,
      JSON.stringify({
        sessionId,
        transcriptPath,
        digest,
        outcome,
        failedAt: new Date().toISOString(),
      }),
    );
    fs.renameSync(tmpPath, finalPath);
  } catch {
    // Best-effort — see appendLog's identical rationale; this is a recovery
    // aid, not a guarantee, and must never itself become a point of failure.
  }
}

async function main() {
  const [, , transcriptPath, sessionId, projectDir] = process.argv;
  if (!transcriptPath || !projectDir) return;

  const dailyDir = path.join(projectDir, "__OBSIDIAN_VAULT_DIR__", "daily");
  const todayPath = path.join(dailyDir, todayFilename());
  const beforeHash = hashOfIfExists(todayPath);

  const digest = readDigest(transcriptPath);
  if (!digest) return;

  const serverConfig = readObsidianServerConfig(projectDir);
  if (!serverConfig) return;

  const prompt = `${PROMPT_INSTRUCTIONS}\n\n--- Session transcript (last ${MAX_TURNS} turns) ---\n${digest}`;

  /** @type {import("@anthropic-ai/claude-agent-sdk").Options} */
  const options = {
    // Pin the sub-session to Sonnet: this unattended digest job must not
    // silently run on whatever model the host CLI defaults to (could be Opus).
    model: "sonnet",
    mcpServers: { obsidian: serverConfig },
    strictMcpConfig: true,
    // allowedTools and tools are complementary, NOT redundant — do not
    // collapse them. Per node_modules/@anthropic-ai/claude-agent-sdk/sdk.d.ts:
    // allowedTools is "List of tool names that are auto-allowed without
    // prompting for permission... To restrict which tools are available,
    // use the `tools` option instead." and MAY legitimately list MCP tool
    // names; Options.tools ("Specify the base set of available built-in
    // tools") governs ONLY the built-in toolset (Bash, Read, Write, Edit,
    // WebFetch, ...) and NEVER MCP tools, no matter what is listed here —
    // `[]` disables every built-in outright. With permissionMode:
    // "bypassPermissions" nothing ever prompts, so allowedTools alone gates
    // nothing — without `tools: []` this detached sub-session (fed a digest
    // built from prior transcript content, i.e. an untrusted-content
    // surface) would inherit the full built-in toolset. Confirmed live via
    // the SDKSystemMessage init event: `tools:[]` in that event — zero
    // built-ins registered. The MCP surface (all ~30 obsidian tools) is
    // governed entirely by `disallowedTools` below, never by this field —
    // confirmed live: the init event's `tools` array lists every
    // mcp__obsidian__* tool regardless of what's listed here. Which of
    // those the model actually calls beyond what disallowedTools blocks is
    // still governed by the plain-English prompt instruction below, not a
    // technical gate. Locking that down further (e.g. a canUseTool
    // allowlist callback) is a follow-up, not part of this fix.
    allowedTools: ["mcp__obsidian__add_daily_note_tool"],
    tools: [],
    // This pipeline only ever needs to append the daily note
    // (add_daily_note_tool); disallow the destructive/structural tools
    // explicitly rather than relying on the prompt's "Do not call any tool
    // other than add_daily_note_tool" sentence alone — this runner is fed a
    // digest built from prior transcript content (an untrusted-content
    // surface), so a prompt-injected instruction could try to steer it into
    // one of these instead. The remaining unlisted obsidian tools (search,
    // read, tags, ...) stay reachable — same residual scope accepted in
    // compile-runner.mjs — narrowing that further (e.g. a canUseTool
    // allowlist callback) is a follow-up, not part of this fix.
    disallowedTools: [
      "mcp__obsidian__delete_note_tool",
      "mcp__obsidian__move_note_tool",
      "mcp__obsidian__rename_note_tool",
      "mcp__obsidian__update_note_tool",
    ],
    permissionMode: "bypassPermissions",
    // Mandatory companion to permissionMode:"bypassPermissions" — the SDK
    // requires this explicit second flag as a safety measure against
    // accidental blanket permission bypass.
    allowDangerouslySkipPermissions: true,
    maxTurns: 6,
    cwd: projectDir,
    env: { ...process.env, CLAUDE_INVOKED_BY: "session_log" },
    extraArgs: { "no-session-persistence": null },
    settingSources: [],
  };

  const q = query({ prompt, options });

  let outcome = "no result message";
  let wroteSomething = false;
  const pendingWriteToolUseIds = new Set();
  /** @type {string[]} */
  const writeErrors = [];

  for await (const message of q) {
    // Evidence gathering: track add_daily_note_tool tool_use blocks from
    // the assistant, then confirm each one's tool_result (surfaced on the
    // following "user" message) did not come back as an error. Neither a
    // `subtype:"success"` result alone, nor a bare tool_use with no
    // confirmed result, counts as a real write — see this file's own doc
    // comment above.
    if (message.type === "assistant" && Array.isArray(message.message?.content)) {
      for (const block of message.message.content) {
        if (isWriteToolUse(block, WRITE_TOOL_NAMES)) pendingWriteToolUseIds.add(block.id);
      }
      continue;
    }
    if (message.type === "user" && Array.isArray(message.message?.content)) {
      for (const block of message.message.content) {
        if (isSuccessfulWriteResult(block, pendingWriteToolUseIds)) {
          wroteSomething = true;
        } else if (isErroredTrackedResult(block, pendingWriteToolUseIds)) {
          writeErrors.push(extractToolResultErrorText(block));
        }
      }
      continue;
    }
    if (message.type !== "result") continue;
    if (message.subtype !== "success") {
      outcome = `error: ${message.subtype}`;
      continue;
    }
    const afterHash = hashOfIfExists(todayPath);
    const diskConfirmed = wroteSomething && afterHash !== null && afterHash !== beforeHash;
    outcome = diskConfirmed
      ? "wrote daily note"
      : wroteSomething
        ? "tool_result reported success but daily note content did not change on disk (unconfirmed)"
        : message.result.trim() === "SKIP"
          ? "skipped (no meaningful content)"
          : writeErrors.length > 0
            ? `write rejected: ${writeErrors.join(" | ")}`
            : "completed without a write";
  }

  appendLog(projectDir, "session-log.log", "session", sessionId, outcome);
  if (outcome !== "wrote daily note" && outcome !== "skipped (no meaningful content)") {
    preservePending(projectDir, sessionId, transcriptPath, digest, outcome);
  }
}

main()
  .catch((err) => {
    // Still nothing to report a synchronous failure to (see doc comment at
    // the top of this file) — but an uncaught exception is exactly the
    // failure mode Task 7 exists to make recoverable, so best-effort persist
    // what we can reconstruct from argv alone (main() may have thrown before
    // computing `digest`).
    try {
      const [, , transcriptPath, sessionId, projectDir] = process.argv;
      if (transcriptPath && sessionId && projectDir) {
        preservePending(
          projectDir,
          sessionId,
          transcriptPath,
          "",
          `crashed: ${err?.message || err}`,
        );
      }
    } catch {
      // Best-effort on top of best-effort — never throw out of a catch handler.
    }
  })
  .finally(() => process.exit(0));
