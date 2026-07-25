#!/usr/bin/env node
/**
 * Detached worker spawned by .claude/hooks/compile.mjs once that hook's own
 * gates pass. NOT a hook: no stdin event, no stdout contract, no output
 * schema to validate — compile.mjs has already exited by the time this
 * process runs, so nothing is listening on this process's stdout/exit code.
 * Every failure here must be swallowed; there is no caller to surface it to.
 *
 * argv: [dailyPath, dailyFilename, projectDir]
 *
 * 1. Reads mcpServers.obsidian from the project's .mcp.json.
 * 2. Calls query() from @anthropic-ai/claude-agent-sdk, scoped to the
 *    obsidian MCP server's read/search/create/update/list/template tools.
 *    settingSources:[] is required — without it the sub-session would load
 *    this repo's own .claude/settings.json (and every hook wired in it),
 *    firing UserPromptSubmit (vault-orient nudging a tool outside the
 *    allowlist) and SessionStart (re-entering this very pipeline). The
 *    CLAUDE_INVOKED_BY guard in compile.mjs is the second layer of that
 *    defense; neither layer alone is sufficient.
 * 3. The prompt instructs the sub-agent to read yesterday's daily note and
 *    promote only durable, general-purpose content into the right PARA
 *    folder (01-projects/02-areas/03-knowledge/04-resources), searching the
 *    whole vault first so it appends to an existing note rather than
 *    duplicating one; reply exactly "SKIP" if nothing qualifies.
 * 4. Records { [dailyFilename]: { hash, timestamp } } into
 *    .claude/hooks/log/compile-state.json ONLY when the SDK message stream
 *    shows real evidence of a write: a tool_use for create_note_tool or
 *    update_note_tool whose matching tool_result is not an error. A
 *    terminal `subtype === "success"` alone is NOT sufficient — the SDK
 *    reports "success" even when the model called no tool at all, or
 *    called one and it errored (see
 *    .claude/memory/sdk-subsession-mcp-tools.md, trap #3). A legitimate
 *    SKIP (nothing worth promoting) is therefore NOT cached either: it
 *    costs one extra LLM call per session-start for the rest of that
 *    calendar day — bounded, since "yesterday" rolls to a new filename
 *    every day — which is a far safer failure mode than silently caching a
 *    write that never happened, forever. Unlike session-log's transcript,
 *    the daily note itself is never deleted: deleting it would make the
 *    compile irreversible and lose the raw log, and the hash-based state
 *    is enough for idempotency.
 * 5. Appends one outcome line to .claude/hooks/log/compile.log,
 *    best-effort (create the dir if needed; never throw on a failed write).
 * 6. Releases the project-wide compile lock compile.mjs took before spawning
 *    this process — on every exit path, including a thrown main(). That hook
 *    holds the lock across this whole run precisely because the window it
 *    guards is this process's lifetime (see compile.mjs's gate 6); this is
 *    the only place that reliably ends it, so anything that returns without
 *    reaching the release leaves the pipeline waiting out the stale window.
 */
import fs from "node:fs";
import path from "node:path";
import { query } from "@anthropic-ai/claude-agent-sdk";
import {
  hashOf,
  hashOfIfExists,
  isWriteToolUse,
  isSuccessfulWriteResult,
  isErroredTrackedResult,
  readObsidianServerConfig,
  appendLog,
  isDestructiveUpdateNoteCall,
  isPathOutsideAllowedFolders,
  extractToolResultErrorText,
  isRetryBudgetExhausted,
  releaseCompileLock,
} from "../hooks/vault-pipeline-shared.mjs";
import { mergeIntoTemplate } from "../hooks/vault-note-merge.mjs";

const PROMPT_INSTRUCTIONS = [
  "You are reviewing yesterday's daily note in this project's Obsidian vault",
  "to decide whether anything in it is worth promoting into permanent",
  "knowledge notes.",
  "",
  "This vault is long-term memory — a different, more generous bar than this",
  "project's short-term memory system (.claude/memory/), which only saves",
  "'hard-won' facts (expensive to learn + likely to recur + not derivable",
  "from code). Here, also capture what merely surprised you, what",
  "contradicted a prior assumption, what wasn't obvious just from reading",
  "the code, or what cost real investigation effort — even with no",
  "guarantee it recurs. Err generous.",
  "",
  "Gate for promoting a Session block into its own note: promote it if AT",
  "LEAST ONE of these fields is non-empty in that Session block — Decisions,",
  "Problems, Consequences, Ideas, Context, or Takeaway. A Session block whose",
  "ONLY content is What I did — however long that list is — stays daily-only;",
  "it is activity log, not durable knowledge, and must NOT be promoted on",
  "its own.",
  "",
  "Never promote: content already covered by an existing note (search first",
  "and append instead — see the search step below).",
  "",
  "Steps:",
  "1. Read the daily note with mcp__obsidian__read_note_tool at path",
  '   "daily/<DAILY_FILENAME>".',
  "2. Choose the right destination folder for each candidate:",
  "   - 01-projects/ — active project work with a concrete end state.",
  "   - 02-areas/ — an ongoing responsibility with no end date.",
  "   - 03-knowledge/ — a consolidated, reusable lesson (the default choice",
  "     when nothing more specific fits).",
  "   - 04-resources/ — reference material (an article, a benchmark, an",
  "     external analysis).",
  "3. Search first, across the WHOLE vault (never scoped to your intended",
  "   folder) — call mcp__obsidian__search_notes_tool with one specific",
  "   keyword and context_length=20 to check whether an existing note",
  "   already covers the topic, in ANY folder.",
  "   - If a matching note exists anywhere, append to it with",
  "     mcp__obsidian__update_note_tool — even if that note lives in a",
  "     different folder than the one you'd otherwise have chosen. Never",
  "     create a second note for the same topic in a different folder.",
  "   - If no matching note exists, call",
  "     mcp__obsidian__get_note_template_tool for your chosen folder first",
  "     to get the exact required section headings (do not hardcode them —",
  "     they differ per folder), then create it with",
  "     mcp__obsidian__create_note_tool.",
  "4. If nothing in the daily note qualifies, call no tools and reply with",
  "   exactly the single word SKIP, nothing else.",
  "",
  "Rules:",
  "- Never use [[wikilinks]] to any note you have not confirmed exists in",
  "  this vault (e.g. via search_notes_tool or list_notes_tool) — wikilink",
  "  policy is strict, and a link to a nonexistent note is a hard error.",
  "- In the Related section, only link a note you confirmed exists via this",
  "  run's own search_notes_tool or list_notes_tool call — never a note you",
  "  merely assume exists. An empty Related section is better than a link",
  "  to the wrong note. Each link may carry a short relation annotation",
  '  after an em dash, e.g. "- [[slug]] — same retry strategy"; a relation',
  "  explains HOW the notes connect, not just that they do.",
  '- Write every section\'s content as "- " bulleted lines — one point per',
  "  bullet, even under Concept/Application/Insights or any other prose-shaped",
  '  heading. Never write a plain prose paragraph with no leading "- ". This',
  "  is not just a style preference: the content you submit is merged against",
  "  the note's existing body by an exact-match bullet comparison, and any",
  '  line that isn\'t a "- " bullet is silently DROPPED rather than merged —',
  "  a paragraph written without the bullet marker will be lost, not saved.",
  "- Do not call mcp__obsidian__delete_note_tool or",
  "  mcp__obsidian__move_note_tool — this pipeline only promotes and",
  "  appends, it never deletes or relocates.",
  "- Do not read the daily note more than once.",
  "- If a write tool call is rejected with an error, read the error message,",
  "  fix the specific problem it names, and retry that same call ONCE. If it",
  "  is rejected again, do not retry a third time — move on and note it",
  "  honestly in your final reply instead of claiming success or silently",
  "  dropping it.",
].join("\n");

const ALLOWED_TOOLS = [
  "mcp__obsidian__read_note_tool",
  "mcp__obsidian__search_notes_tool",
  "mcp__obsidian__create_note_tool",
  "mcp__obsidian__update_note_tool",
  "mcp__obsidian__list_notes_tool",
  "mcp__obsidian__get_note_template_tool",
];

// The only two tools that actually promote content (see PROMPT_INSTRUCTIONS
// step 3): create a new note in one of the four PARA folders, or append to
// an existing one. Evidence of one of these completing without error is
// what "a write happened" means for this pipeline — see main()'s
// message-stream loop.
const WRITE_TOOL_NAMES = new Set([
  "mcp__obsidian__create_note_tool",
  "mcp__obsidian__update_note_tool",
]);

// This vault's current template contracts, confirmed live via
// mcp__obsidian__get_note_template_tool against this project's own vault —
// re-confirm if OBSIDIAN_FOLDER_TEMPLATES ever changes. Not this pipeline's
// own invention; the server already derives template type from folder
// deterministically, this is just this file's local copy of that mapping so
// the PreToolUse guard doesn't need to make its own MCP call mid-flight.
const PARA_TEMPLATE_HEADINGS = {
  "01-projects": ["Objective", "Status", "Decisions", "Architecture", "Next steps", "Related"],
  "02-areas": [
    "Overview",
    "Objectives & OKRs",
    "Key Metrics (KPIs)",
    "Ongoing Initiatives",
    "Stakeholders",
    "Risks & Dependencies",
    "Decision History",
    "Related",
  ],
  "03-knowledge": ["Concept", "Application", "Insights", "Related"],
  "04-resources": ["Type", "Source", "Summary", "Key Points", "Application", "Related"],
};

// Promotion destinations this pipeline may write to — derived from
// PARA_TEMPLATE_HEADINGS's own keys rather than a second, independent list.
// A whole-branch review noted the two were only an "array-parity
// coincidence" when kept separate — deriving one from the other makes them
// structurally impossible to desync instead of relying on both being
// updated together by hand.
const ALLOWED_PROMOTION_FOLDERS = Object.keys(PARA_TEMPLATE_HEADINGS);

/**
 * Merges { [dailyFilename]: { hash, timestamp } } into
 * .claude/hooks/log/compile-state.json. Best-effort: a failed write only
 * means the next session recompiles this same daily note again, never a
 * crash.
 * @param {string} projectDir
 * @param {string} dailyFilename
 * @param {string} hash
 */
function recordSuccess(projectDir, dailyFilename, hash) {
  try {
    const logDir = path.join(projectDir, ".claude", "hooks", "log");
    fs.mkdirSync(logDir, { recursive: true });
    const stateFile = path.join(logDir, "compile-state.json");
    let state = {};
    try {
      const parsed = JSON.parse(fs.readFileSync(stateFile, "utf8"));
      if (parsed && typeof parsed === "object") state = parsed;
    } catch {
      // missing or corrupt -> start fresh, never crash
    }
    state[dailyFilename] = { hash, timestamp: Date.now() };
    fs.writeFileSync(stateFile, JSON.stringify(state));
  } catch {
    // Best-effort; see doc comment above.
  }
}

async function main() {
  const [, , dailyPath, dailyFilename, projectDir] = process.argv;
  if (!dailyPath || !dailyFilename || !projectDir) return;

  const hash = hashOf(dailyPath);

  const serverConfig = readObsidianServerConfig(projectDir);
  if (!serverConfig) return;

  const prompt = PROMPT_INSTRUCTIONS.replace(/<DAILY_FILENAME>/g, dailyFilename);

  // Declared before `options` (not after query()) — the PreToolUse callback
  // below closes over retryCountByTarget/MAX_RETRIES_PER_TARGET/
  // confirmedSlugs, and a `const` referenced by a closure that outlives its
  // own declaration is a TDZ hazard the moment anything async gets inserted
  // between building `options` and reaching these lines.
  // vaultRoot/pendingWriteToolUses/writeErrors/pendingSearchToolUseIds/
  // SEARCH_TOOL_NAMES join the same block for consistency — they're read by
  // the message-stream loop built off this same `options` below, not by the
  // closure itself.
  const vaultRoot = path.join(projectDir, "__OBSIDIAN_VAULT_DIR__");
  /** @type {Map<string, {name: string, path: unknown, beforeHash: string | null}>} */
  const pendingWriteToolUses = new Map();
  /** @type {string[]} */
  const writeErrors = [];
  /** @type {Map<string, number>} */
  const retryCountByTarget = new Map();
  const MAX_RETRIES_PER_TARGET = 1;
  const SEARCH_TOOL_NAMES = new Set([
    "mcp__obsidian__search_notes_tool",
    "mcp__obsidian__list_notes_tool",
  ]);
  /** @type {Set<string>} */
  const pendingSearchToolUseIds = new Set();
  /** @type {Set<string>} */
  const confirmedSlugs = new Set();

  /** @type {import("@anthropic-ai/claude-agent-sdk").Options} */
  const options = {
    // Pin the sub-session to Sonnet: this unattended promote job must not
    // silently run on whatever model the host CLI defaults to (could be Opus).
    model: "sonnet",
    mcpServers: { obsidian: serverConfig },
    strictMcpConfig: true,
    // allowedTools and tools are complementary, NOT redundant — do not
    // collapse them (see session-log-runner.mjs's identical comment and
    // .claude/memory/sdk-subsession-mcp-tools.md for the full rationale).
    // allowedTools only suppresses permission prompting (moot here under
    // bypassPermissions) and MAY legitimately list MCP tool names.
    allowedTools: ALLOWED_TOOLS,
    // `tools` governs ONLY the built-in toolset (Bash, Write, Edit,
    // WebFetch, ...) — per its own docstring in sdk.d.ts, "Specify the base
    // set of available built-in tools" — and never restricts MCP tools no
    // matter what is listed here. `[]` disables every built-in outright,
    // which is what this sub-session — fed content from a daily note, an
    // untrusted-content surface — needs. The MCP surface (mcp__obsidian__*)
    // is governed entirely by `disallowedTools` below, never by this field.
    tools: [],
    // Every mcp__obsidian__* tool stays registered regardless of `tools`
    // above; `disallowedTools` is what actually trims the MCP surface. This
    // pipeline promotes and appends only (via create_note_tool/
    // update_note_tool, both gated by the PreToolUse guard below), so every
    // other destructive, relocating, or bulk-mutating tool is explicitly
    // denied here — a whole-branch review flagged that the previous shorter
    // list (delete/move only) left tools like edit_note_section_tool
    // (destructive section replace) and rename_note_tool reachable and
    // completely unguarded by the PreToolUse checks below, which only ever
    // branch on create_note_tool/update_note_tool. A prompt-injected daily
    // note steering the sub-agent to one of these would defeat this file's
    // own data-loss protections through a side door. The remaining
    // read/search/list/template tools stay reachable (harmless, read-only).
    disallowedTools: [
      "mcp__obsidian__delete_note_tool",
      "mcp__obsidian__move_note_tool",
      "mcp__obsidian__rename_note_tool",
      "mcp__obsidian__edit_note_section_tool",
      "mcp__obsidian__add_daily_note_tool",
      "mcp__obsidian__batch_update_properties_tool",
      "mcp__obsidian__add_tags_tool",
      "mcp__obsidian__update_tags_tool",
      "mcp__obsidian__remove_tags_tool",
      "mcp__obsidian__create_folder_tool",
      "mcp__obsidian__move_folder_tool",
    ],
    // Pre-execution write guard. canUseTool is NOT used here — confirmed
    // empirically that permissionMode:"bypassPermissions" auto-approves every
    // tool call before canUseTool would ever be consulted (the SDK itself
    // warns [CLAUDE_SDK_CAN_USE_TOOL_SHADOWED] when a canUseTool callback is
    // set alongside it). An in-process PreToolUse hook is the mechanism that
    // actually fires under bypassPermissions and can deny a call before the
    // MCP server executes it — verified live: a denial here means the note
    // is never touched, not just logged as a failure afterward.
    hooks: {
      PreToolUse: [
        {
          hooks: [
            async (input) => {
              if (
                input.tool_name === "mcp__obsidian__update_note_tool" ||
                input.tool_name === "mcp__obsidian__create_note_tool"
              ) {
                const target = `${input.tool_name}:${JSON.stringify(/** @type {{path?: unknown}} */ (input.tool_input)?.path)}`;
                if (isRetryBudgetExhausted(retryCountByTarget, target, MAX_RETRIES_PER_TARGET)) {
                  return {
                    hookSpecificOutput: {
                      hookEventName: "PreToolUse",
                      permissionDecision: "deny",
                      permissionDecisionReason: `Already retried this exact write once and it was rejected again — no further retries for ${target}. Report this as a failure instead.`,
                    },
                  };
                }
                retryCountByTarget.set(target, (retryCountByTarget.get(target) ?? 0) + 1);
              }
              // Folder/traversal boundary check runs BEFORE the merge branch
              // below, for both create and update — a whole-branch review
              // found that the merge branch's own early `allow` return
              // (computed from `notePath.split("/")[0]` alone) let a ".."
              // segment anywhere later in the path escape this check
              // entirely, silently reopening the traversal hole
              // isPathOutsideAllowedFolders was added to close. Running this
              // check first makes "no create/update to a disallowed or
              // traversing path ever reaches the merge or an allow" an
              // explicit, order-independent invariant instead of one that
              // depended on which early-return happened to be written last.
              if (
                (input.tool_name === "mcp__obsidian__create_note_tool" ||
                  input.tool_name === "mcp__obsidian__update_note_tool") &&
                isPathOutsideAllowedFolders(
                  /** @type {{path?: unknown}} */ (input.tool_input)?.path,
                  ALLOWED_PROMOTION_FOLDERS,
                )
              ) {
                return {
                  hookSpecificOutput: {
                    hookEventName: "PreToolUse",
                    permissionDecision: "deny",
                    permissionDecisionReason: `This pipeline may only write under: ${ALLOWED_PROMOTION_FOLDERS.join(", ")}. Retry with a path under one of those folders.`,
                  },
                };
              }
              if (input.tool_name === "mcp__obsidian__update_note_tool") {
                const notePath = /** @type {{path?: unknown, content?: unknown}} */ (
                  input.tool_input
                )?.path;
                const proposedContent = /** @type {{content?: unknown}} */ (input.tool_input)
                  ?.content;
                if (typeof notePath === "string" && typeof proposedContent === "string") {
                  const folder = notePath.split("/")[0];
                  const templateOrder = PARA_TEMPLATE_HEADINGS[folder];
                  let currentContent = "";
                  try {
                    currentContent = fs.readFileSync(path.join(vaultRoot, notePath), "utf8");
                  } catch {
                    currentContent = "";
                  }
                  if (templateOrder && currentContent) {
                    const mergedContent = mergeIntoTemplate(
                      currentContent,
                      proposedContent,
                      templateOrder,
                      [...confirmedSlugs],
                    );
                    return {
                      hookSpecificOutput: {
                        hookEventName: "PreToolUse",
                        permissionDecision: "allow",
                        updatedInput: {
                          ...input.tool_input,
                          content: mergedContent,
                          merge_strategy: undefined,
                        },
                      },
                    };
                  }
                }
                // Fallback: a merge could not be safely computed — either
                // notePath/proposedContent weren't plain strings, the target
                // folder has no known template order, or (most likely in
                // practice) currentContent is empty because the target file
                // does not actually exist yet (update_note_tool on a
                // nonexistent path is itself a model error — create_note_tool
                // is the right call for a genuinely new note). Do NOT let
                // this fall through to an unguarded full-replace: fall back
                // to the original safety net (deny unless the model's own
                // call already asked for a safe append). Without this
                // fallback, removing isDestructiveUpdateNoteCall as the
                // primary guard would silently reopen exactly the destructive
                // full-replace bug this plan's safety half (Task 1) closed.
                if (isDestructiveUpdateNoteCall(input.tool_input)) {
                  return {
                    hookSpecificOutput: {
                      hookEventName: "PreToolUse",
                      permissionDecision: "deny",
                      permissionDecisionReason:
                        'Could not safely merge this update (unknown target folder, or the target note does not exist yet — use create_note_tool for a new note). Retry with merge_strategy="append" if you are certain the target exists.',
                    },
                  };
                }
              }
              return {};
            },
          ],
        },
      ],
    },
    permissionMode: "bypassPermissions",
    // Mandatory companion to permissionMode:"bypassPermissions" — the SDK
    // requires this explicit second flag as a safety measure against
    // accidental blanket permission bypass.
    allowDangerouslySkipPermissions: true,
    maxTurns: 20,
    cwd: projectDir,
    env: { ...process.env, CLAUDE_INVOKED_BY: "compile" },
    extraArgs: { "no-session-persistence": null },
    settingSources: [],
  };

  const q = query({ prompt, options });

  let outcome = "no result message";
  let succeeded = false;
  let wroteSomething = false;

  for await (const message of q) {
    // Evidence gathering: track write tool_use blocks from the assistant,
    // then confirm each one's tool_result (surfaced on the following
    // "user" message) did not come back as an error. Neither a
    // `subtype:"success"` result alone, nor a bare tool_use with no
    // confirmed result, counts as a real write — see this file's own doc
    // comment above and .claude/memory/sdk-subsession-mcp-tools.md.
    if (message.type === "assistant" && Array.isArray(message.message?.content)) {
      for (const block of message.message.content) {
        if (isWriteToolUse(block, WRITE_TOOL_NAMES)) {
          const notePath = /** @type {{path?: unknown}} */ (block.input)?.path;
          const absolutePath = typeof notePath === "string" ? path.join(vaultRoot, notePath) : null;
          pendingWriteToolUses.set(block.id, {
            name: block.name,
            path: notePath,
            beforeHash: absolutePath ? hashOfIfExists(absolutePath) : null,
          });
        }
        if (isWriteToolUse(block, SEARCH_TOOL_NAMES)) pendingSearchToolUseIds.add(block.id);
      }
      continue;
    }
    if (message.type === "user" && Array.isArray(message.message?.content)) {
      const pendingIds = new Set(pendingWriteToolUses.keys());
      for (const block of message.message.content) {
        if (isSuccessfulWriteResult(block, pendingIds)) {
          const pending = pendingWriteToolUses.get(block.tool_use_id);
          const absolutePath =
            pending && typeof pending.path === "string" ? path.join(vaultRoot, pending.path) : null;
          const afterHash = absolutePath ? hashOfIfExists(absolutePath) : null;
          if (absolutePath && afterHash !== null && afterHash !== pending?.beforeHash) {
            wroteSomething = true;
          } else {
            writeErrors.push(
              `${pending?.name} path=${JSON.stringify(pending?.path)}: tool_result reported success but the file's content did not change on disk (unconfirmed)`,
            );
          }
        } else if (isErroredTrackedResult(block, pendingIds)) {
          const pending = pendingWriteToolUses.get(block.tool_use_id);
          const errorText = extractToolResultErrorText(block);
          writeErrors.push(`${pending?.name} path=${JSON.stringify(pending?.path)}: ${errorText}`);
        }
        if (
          block?.type === "tool_result" &&
          block.is_error !== true &&
          typeof block.tool_use_id === "string" &&
          pendingSearchToolUseIds.has(block.tool_use_id)
        ) {
          const text =
            typeof block.content === "string"
              ? block.content
              : Array.isArray(block.content)
                ? block.content.map((/** @type {any} */ c) => c?.text || "").join(" ")
                : "";
          for (const match of text.matchAll(/"(?:path|name)"\s*:\s*"([^"]+)"/g)) {
            const raw = match[1].split("/").pop() || "";
            confirmedSlugs.add(raw.replace(/\.md$/, ""));
          }
        }
      }
      continue;
    }
    if (message.type !== "result") continue;
    if (message.subtype !== "success") {
      outcome = `error: ${message.subtype}`;
      continue;
    }
    succeeded = wroteSomething;
    outcome = wroteSomething
      ? "promoted"
      : message.result.trim() === "SKIP"
        ? "skipped (nothing to promote, not cached)"
        : writeErrors.length > 0
          ? `write rejected (not cached): ${writeErrors.join(" | ")}`
          : "completed without a write (not cached)";
  }

  if (succeeded) recordSuccess(projectDir, dailyFilename, hash);
  appendLog(projectDir, "compile.log", "daily", dailyFilename, outcome);
}

main()
  .catch(() => {
    // Swallow every error — this is a detached background worker with no
    // caller waiting on it and nothing to report a failure to.
  })
  .finally(() => {
    // Release the lock compile.mjs took on this process's behalf before
    // spawning it, on every exit path — a failed run must still let the next
    // session retry, and only a *crashed* runner should ever have to wait out
    // the stale window. Read from argv rather than threaded out of main(),
    // which returns early on several paths; skipped when argv is missing,
    // since then no hook took a lock and the relative path would resolve
    // against an unrelated directory.
    const projectDir = process.argv[4];
    if (projectDir) releaseCompileLock(projectDir);
    process.exit(0);
  });
