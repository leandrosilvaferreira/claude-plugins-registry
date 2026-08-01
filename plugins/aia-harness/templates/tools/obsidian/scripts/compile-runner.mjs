#!/usr/bin/env node
// @ts-nocheck — this file is outside `tsc --checkJs`'s program today for two
// independent reasons, so the pragma changes nothing right now and is here to
// keep it that way if either reason lapses. (1) tsconfig.json's `exclude`
// deliberately lists templates/tools/obsidian/scripts, keeping it out of the
// root set. (2) tests/compile-runner.test.mjs reaches compileOne only through a
// dynamic `import()` of a runtime-computed path (a staged copy in a temp dir),
// which tsc cannot resolve, so nothing pulls this file in transitively either.
// Were it ever checked, the SDK's real hook/message types do not narrow cleanly
// against this file's dynamic tool-name dispatch — the friction the exclude
// entry exists to avoid. Runtime logic is untouched either way, and the
// exported functions still carry real JSDoc types for their callers.
/**
 * Detached worker spawned by .claude/hooks/compile.mjs once that hook's own
 * gates pass. NOT a hook: no stdin event, no stdout contract, no output
 * schema to validate — compile.mjs has already exited by the time this
 * process runs, so nothing is listening on this process's stdout/exit code.
 * Every failure here must be swallowed; there is no caller to surface it to.
 *
 * argv: [projectDir]
 *
 * main() reads mcpServers.obsidian from the project's .mcp.json once, then
 * loops the daily notes listPendingDailies() still finds pending, oldest
 * first and capped at MAX_DAILIES_PER_BATCH (the rest are picked up by the
 * next session, which re-derives the same oldest-first list), refreshing the
 * compile lock between each so a long batch is never mistaken for an abandoned
 * lock by a second session's hook (see touchCompileLock's own doc comment). A
 * refresh that finds the lock is no longer this run's stops the batch there.
 * compileOne() does the actual work for exactly one daily note:
 *
 * 1. Calls query() from @anthropic-ai/claude-agent-sdk, scoped to the
 *    obsidian MCP server's read/search/create/update/list/template tools.
 *    settingSources:[] is required — without it the sub-session would load
 *    this repo's own .claude/settings.json (and every hook wired in it),
 *    firing UserPromptSubmit (vault-orient nudging a tool outside the
 *    allowlist) and SessionStart (re-entering this very pipeline). The
 *    CLAUDE_INVOKED_BY guard in compile.mjs is the second layer of that
 *    defense; neither layer alone is sufficient.
 * 2. The prompt instructs the sub-agent to read the daily note and promote
 *    only durable, general-purpose content into the right PARA folder
 *    (01-projects/02-areas/03-knowledge/04-resources), searching the whole
 *    vault first so it appends to an existing note rather than duplicating
 *    one; reply exactly "SKIP" if nothing qualifies. A PreToolUse guard
 *    denies re-promoting any write whose content fingerprint (see
 *    fingerprintForWrite()/buildLearningFingerprint()) was already recorded
 *    for this daily on an earlier attempt — a deterministic denial, unlike
 *    printing hashes into the prompt for a model to match by eye.
 * 3. On a terminal success, runs the post-write guard (applyPostWriteGuard)
 *    over only the notes this run confirmed writing, records
 *    { [dailyFilename]: { hash, promoted, fingerprints, partial, timestamp } }
 *    (plus `attempts` on a partial entry) into
 *    .claude/hooks/log/compile-state.json, then deletes the daily note —
 *    the state record is what stops a reprocess, so the raw log no longer
 *    needs to survive once its content has actually landed elsewhere. A
 *    terminal `subtype === "success"` alone is NOT sufficient evidence of a
 *    write — the SDK reports "success" even when the model called no tool at
 *    all, or called one and it errored (see
 *    .claude/memory/sdk-subsession-mcp-tools.md, trap #3) — so both the
 *    record and the delete gate on real tool_result evidence, never the
 *    SDK's own verdict. A run that never reached a terminal success — an
 *    error, an exhausted turn budget, or a throw out of the message stream —
 *    records what landed (`partial: true`, so a retry's PreToolUse guard
 *    denies re-promoting it) plus an incremented `attempts`, without deleting
 *    the daily note, since the run never proved it finished reading. That
 *    record is written in a `finally`, so a throw cannot skip it. `attempts`
 *    is what eventually retires a daily that fails the same way every session
 *    (see MAX_COMPILE_ATTEMPTS); retiring is not deleting. A legitimate SKIP
 *    is NOT cached: it costs one extra LLM call the next time this daily is
 *    still pending, a far safer failure mode than silently caching a write
 *    that never happened.
 * 4. Appends one outcome line to .claude/hooks/log/compile.log,
 *    best-effort (create the dir if needed; never throw on a failed write).
 *
 * main()'s .finally() releases the project-wide compile lock compile.mjs
 * took before spawning this process — on every exit path, including a
 * thrown main(). That hook holds the lock across this whole run precisely
 * because the window it guards is this process's lifetime (see compile.mjs's
 * gate 6); this is the only place that reliably ends it, so anything that
 * returns without reaching the release leaves the pipeline waiting out the
 * stale window.
 */
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { query } from "@anthropic-ai/claude-agent-sdk";
import {
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
  readCompileLockNonce,
  listPendingDailies,
  readCompileState,
  compileStatePath,
  touchCompileLock,
  MAX_COMPILE_ATTEMPTS,
  buildLearningFingerprint,
  collectValidTargets,
  applyPostWriteGuard,
  MAX_NOTE_LINES,
  listVaultNotes,
} from "../hooks/vault-pipeline-shared.mjs";
import { mergeIntoTemplate, findDuplicateSlug } from "../hooks/vault-note-merge.mjs";

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
// what "a write happened" means for this pipeline — see compileOne()'s
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
 * `attempts` is present only on a `partial: true` entry — it counts the
 * consecutive non-terminal compiles of this daily at this exact content, and a
 * terminal success retires the daily outright, so carrying the counter onto
 * that entry would record a number nothing ever reads. Absent reads as 0.
 * @typedef {{ hash: string, promoted: number, fingerprints: string[], partial: boolean, attempts?: number }} CompileStateEntry
 */

/**
 * Merges one entry into compile-state.json. Best-effort: a failed write only
 * means the next session recompiles this same daily note, never a crash.
 * @param {string} projectDir
 * @param {string} dailyFilename
 * @param {CompileStateEntry} entry
 */
function recordCompileState(projectDir, dailyFilename, entry) {
  try {
    const stateFile = compileStatePath(projectDir);
    fs.mkdirSync(path.dirname(stateFile), { recursive: true });
    let state = {};
    try {
      const parsed = JSON.parse(fs.readFileSync(stateFile, "utf8"));
      if (parsed && typeof parsed === "object") state = parsed;
    } catch {
      // missing or corrupt -> start fresh, never crash
    }
    state[dailyFilename] = { ...entry, timestamp: Date.now() };
    fs.writeFileSync(stateFile, JSON.stringify(state));
  } catch {
    // Best-effort; see doc comment above.
  }
}

/**
 * Renders the vault's existing promotion-destination notes as a prompt block,
 * so the sub-agent can see what already exists before deciding to create. The
 * prompt already tells it to search first; this removes the dependency on it
 * picking a keyword that happens to hit. Returns "" for an empty vault.
 * @param {{relPath: string, slug: string}[]} notes
 * @returns {string}
 */
function renderExistingNotesBlock(notes) {
  if (notes.length === 0) return "";
  return [
    "",
    "Notes that ALREADY EXIST in this vault — consult before creating anything:",
    ...notes.map((note) => `  - ${note.relPath}`),
    "",
    "If a learning belongs to one of these topics, append to that note with",
    "mcp__obsidian__update_note_tool — even if it sits in a different folder",
    "than the one you would otherwise have picked. Never create a second note",
    "for a topic already covered above under a slightly different name; a",
    "create whose slug looks like an existing one is denied automatically.",
  ].join("\n");
}

/**
 * Adds a note this run just created to the in-session duplicate-slug
 * inventory, in place. Idempotent — a path already inventoried is ignored, so
 * repeated confirmations of the same note (an update after a create) never
 * duplicate an entry.
 * @param {{relPath: string, slug: string}[]} existingNotes
 * @param {string[]} existingSlugs
 * @param {string} notePath vault-relative, forward-slashed
 */
function registerExistingNote(existingNotes, existingSlugs, notePath) {
  if (existingNotes.some((note) => note.relPath === notePath)) return;
  const slug = (notePath.split("/").pop() || "").replace(/\.md$/, "");
  if (!slug) return;
  existingNotes.push({ relPath: notePath, slug });
  existingSlugs.push(slug);
}

/**
 * Fingerprint of a proposed write, derived from the tool name, the note path,
 * and the content the model actually submitted.
 * @param {string} toolName
 * @param {string} notePath vault-relative, forward-slashed
 * @param {unknown} toolInput
 * @returns {string}
 */
function fingerprintForWrite(toolName, notePath, toolInput) {
  const folder = notePath.split("/")[0];
  const slug = (notePath.split("/").pop() || "").replace(/\.md$/, "");
  const action = toolName === "mcp__obsidian__create_note_tool" ? "created" : "updated";
  return buildLearningFingerprint(
    folder,
    slug,
    action,
    /** @type {{content?: unknown}} */ (toolInput)?.content,
  );
}

/**
 * Compiles exactly one daily note: one LLM sub-session, then the post-write
 * guard, then state + delete. Returns nothing; every outcome is recorded in
 * compile-state.json and compile.log.
 * @param {{projectDir: string, vaultRoot: string, dailyDir: string, dailyFilename: string, serverConfig: any, blockedFingerprints: Set<string>, queryFn?: (params: {prompt: string, options: any}) => AsyncIterable<any>}} ctx
 *   `queryFn` defaults to the real SDK `query` — exposed only so a test can
 *   inject a scripted async-iterable in place of a real sub-session; main()
 *   never passes it, so production always uses the real import. Typed as the
 *   minimal shape this function actually consumes (a function returning an
 *   async iterable of messages) rather than the SDK's full `Query` return
 *   type, which adds imperative control methods (interrupt,
 *   setPermissionMode, ...) never called here — requiring a test's scripted
 *   queryFn to stub two dozen unused methods just to satisfy the type
 *   checker would be busywork, not correctness.
 */
export async function compileOne(ctx) {
  const {
    projectDir,
    vaultRoot,
    dailyDir,
    dailyFilename,
    serverConfig,
    blockedFingerprints,
    queryFn = query,
  } = ctx;
  const dailyPath = path.join(dailyDir, dailyFilename);
  const hash = hashOfIfExists(dailyPath);
  if (hash === null) return; // vanished between the scan and now

  // This daily's own prior fingerprints (if any), used below to compute this
  // run's own fingerprint list without re-storing the whole cross-daily
  // corpus. A legacy {hash, timestamp} entry (no fingerprints array) reads as
  // no prior fingerprints rather than crashing.
  const priorEntry = readCompileState(projectDir)[dailyFilename];
  const priorFingerprints = Array.isArray(priorEntry?.fingerprints) ? priorEntry.fingerprints : [];
  // Attempts carry over only while the daily's bytes are unchanged: an edited
  // daily is a different compile problem and deserves a fresh budget, and that
  // is also the documented way for a user to revive a daily this runner gave up
  // on. A missing/legacy `attempts` reads as 0 (full budget), never as retired.
  const priorAttempts =
    priorEntry?.hash === hash && typeof priorEntry?.attempts === "number" ? priorEntry.attempts : 0;

  const existingNotes = listVaultNotes(vaultRoot, ALLOWED_PROMOTION_FOLDERS);
  const existingSlugs = existingNotes.map((note) => note.slug);
  const prompt =
    PROMPT_INSTRUCTIONS.replace(/<DAILY_FILENAME>/g, dailyFilename) +
    renderExistingNotesBlock(existingNotes);

  // Declared before `options` (not after query()) — the PreToolUse callback
  // below closes over retryCountByTarget/MAX_RETRIES_PER_TARGET/
  // confirmedSlugs, and a `const` referenced by a closure that outlives its
  // own declaration is a TDZ hazard the moment anything async gets inserted
  // between building `options` and reaching these lines.
  // pendingWriteToolUses/writeErrors/pendingSearchToolUseIds/
  // SEARCH_TOOL_NAMES join the same block for consistency — they're read by
  // the message-stream loop built off this same `options` below, not by the
  // closure itself. vaultRoot is already in scope via the ctx destructure
  // above, ahead of all of these — no separate declaration needed here.
  /** @type {Map<string, {name: string, path: unknown, beforeHash: string | null, fingerprint: string | null}>} */
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
  /** @type {Set<string>} */
  const touchedNotePaths = new Set();
  /** @type {Set<string>} */
  const confirmedFingerprints = new Set();
  /** @type {Set<string>} */
  const deniedDuplicateSlugs = new Set();

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
              // Unconditional, permanent, and FIRST — every other branch below
              // is conditional or first-attempt-only, and none of them looks at
              // `overwrite`. create_note_tool defaults it to false, but a
              // server "already exists" rejection plus this prompt's own
              // "fix the specific problem it names and retry once" instruction
              // is a direct invitation to set it to true, and the duplicate-slug
              // denial below even ends with "retry this exact create and it will
              // be allowed". Under bypassPermissions this callback is the only
              // thing standing between a daily note's (untrusted) content and a
              // destroyed knowledge note — confirmed empirically, a real note in
              // 03-knowledge/ was overwritten on the second attempt. Placed
              // ahead of the retry-budget accounting below so a denial here does
              // not spend the one budgeted retry the model needs to correct
              // itself.
              if (
                input.tool_name === "mcp__obsidian__create_note_tool" &&
                /** @type {{overwrite?: unknown}} */ (input.tool_input)?.overwrite
              ) {
                return {
                  hookSpecificOutput: {
                    hookEventName: "PreToolUse",
                    permissionDecision: "deny",
                    permissionDecisionReason:
                      "This pipeline never overwrites an existing note. Append to it with update_note_tool instead.",
                  },
                };
              }
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
              // Deterministic replay guard. A previous attempt at this same
              // daily note may have written some of its learnings before
              // dying; re-promoting them would duplicate content. The
              // fingerprint is computed from the real proposed content, so
              // this is a hard denial, not a prompt-level request — unlike the
              // swapo precedent, which printed raw hashes into the prompt and
              // expected a language model to match SHA-256 by eye.
              if (
                input.tool_name === "mcp__obsidian__create_note_tool" ||
                input.tool_name === "mcp__obsidian__update_note_tool"
              ) {
                const notePath = /** @type {{path?: unknown}} */ (input.tool_input)?.path;
                if (typeof notePath === "string") {
                  const fingerprint = fingerprintForWrite(
                    input.tool_name,
                    notePath,
                    input.tool_input,
                  );
                  if (blockedFingerprints.has(fingerprint)) {
                    return {
                      hookSpecificOutput: {
                        hookEventName: "PreToolUse",
                        permissionDecision: "deny",
                        permissionDecisionReason: `This exact content was already promoted to ${notePath} from this same daily note on an earlier attempt. Skip it and move on to the next learning.`,
                      },
                    };
                  }
                }
              }
              // Duplicate-topic guard. A batch replays old dailies whose
              // learnings may already have become notes, so a create for a
              // topic that already exists is the expected failure mode, not an
              // exotic one.
              //
              // Deliberately denies only the FIRST attempt at a given slug: if
              // the model reconsiders and appends to the named note, the
              // duplicate is avoided; if it insists on the same slug a second
              // time, the write goes through. A permanent denial would be
              // worse than a duplicate here — a false positive would silently
              // discard a real learning, and the daily note gets deleted on
              // terminal success either way.
              //
              // "The second attempt is allowed" depends on
              // MAX_RETRIES_PER_TARGET being 1: the budget check above admits
              // two attempts per target (it denies only once the recorded count
              // *exceeds* the max) and runs first. Lower that constant to 0 and
              // the retry this message explicitly promises is denied instead —
              // by the budget guard, with an unrelated "already retried" reason.
              // The two constants are coupled; change one, re-read the other.
              if (input.tool_name === "mcp__obsidian__create_note_tool") {
                const notePath = /** @type {{path?: unknown}} */ (input.tool_input)?.path;
                if (typeof notePath === "string") {
                  const slug = (notePath.split("/").pop() || "").replace(/\.md$/, "");
                  const collision = findDuplicateSlug(slug, existingSlugs);
                  if (collision && !deniedDuplicateSlugs.has(slug)) {
                    deniedDuplicateSlugs.add(slug);
                    const existing = existingNotes.find((note) => note.slug === collision);
                    return {
                      hookSpecificOutput: {
                        hookEventName: "PreToolUse",
                        permissionDecision: "deny",
                        permissionDecisionReason: `A note on this topic already exists at ${existing ? existing.relPath : collision}. Read it with mcp__obsidian__read_note_tool and append there with mcp__obsidian__update_note_tool instead. If it genuinely covers a different topic, retry this exact create and it will be allowed.`,
                      },
                    };
                  }
                }
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

  const q = queryFn({ prompt, options });

  let outcome = "no result message";
  let terminalSuccess = false;
  let wroteSomething = false;
  let streamThrew = false;
  /** @type {string[]} */
  let ownFingerprints = [];

  // Everything that PERSISTS progress lives in the finally below, never after
  // the loop: the SDK's async iterable can throw at any point (a dropped
  // connection, an MCP server crash, or this loop's own message.result.trim()
  // on a malformed terminal message), and a throw that skipped the fingerprint
  // seeding and the partial record would leave the daily pending with no record
  // of what already landed — so the next session re-promotes it. That is
  // precisely the duplication the partial-progress feature exists to prevent.
  try {
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
            const absolutePath =
              typeof notePath === "string" ? path.join(vaultRoot, notePath) : null;
            pendingWriteToolUses.set(block.id, {
              name: block.name,
              path: notePath,
              beforeHash: absolutePath ? hashOfIfExists(absolutePath) : null,
              fingerprint:
                typeof notePath === "string"
                  ? fingerprintForWrite(block.name, notePath, block.input)
                  : null,
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
              pending && typeof pending.path === "string"
                ? path.join(vaultRoot, pending.path)
                : null;
            const afterHash = absolutePath ? hashOfIfExists(absolutePath) : null;
            if (absolutePath && afterHash !== null && afterHash !== pending?.beforeHash) {
              wroteSomething = true;
              if (typeof pending?.path === "string") {
                touchedNotePaths.add(pending.path);
                // Keep the duplicate-slug guard's inventory current within this
                // sub-session. existingNotes/existingSlugs are snapshotted once
                // per daily (deliberately — the inventory the prompt shows must
                // match what the model was told), so without this a note created
                // a few turns ago is invisible to the guard and a second,
                // near-identical create for the same topic sails straight past it.
                registerExistingNote(existingNotes, existingSlugs, pending.path);
              }
              if (pending?.fingerprint) confirmedFingerprints.add(pending.fingerprint);
            } else {
              writeErrors.push(
                `${pending?.name} path=${JSON.stringify(pending?.path)}: tool_result reported success but the file's content did not change on disk (unconfirmed)`,
              );
            }
          } else if (isErroredTrackedResult(block, pendingIds)) {
            const pending = pendingWriteToolUses.get(block.tool_use_id);
            const errorText = extractToolResultErrorText(block);
            writeErrors.push(
              `${pending?.name} path=${JSON.stringify(pending?.path)}: ${errorText}`,
            );
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
      terminalSuccess = true;
      // write rejected / completed without a write: terminalSuccess is still
      // true here (the sub-agent reached its own conclusion; it just didn't
      // land a write), so the delete below fires exactly the same as it does
      // for a promotion — deliberate parity with the precedent this ports
      // from, not narrowed by this change. The suffix exists only so
      // compile.log — the sole surviving record once the daily is gone — makes
      // that plain instead of leaving it to be inferred.
      outcome = wroteSomething
        ? `promoted ${touchedNotePaths.size} note(s)`
        : message.result.trim() === "SKIP"
          ? "skipped (nothing to promote)"
          : writeErrors.length > 0
            ? `write rejected: ${writeErrors.join(" | ")} (daily deleted anyway)`
            : "completed without a write (daily deleted anyway)";
    }
  } catch (error) {
    // Recorded so the finally's log line names what actually happened instead
    // of the stale "no result message" default, then rethrown unchanged —
    // main()'s per-iteration catch is what keeps one bad daily from starving
    // the rest of the batch, and it can only do that if this still propagates.
    streamThrew = true;
    const detail = error instanceof Error ? error.message : String(error);
    outcome = `error: sub-session threw: ${detail.slice(0, 200)}`;
    throw error;
  } finally {
    // Seed the live in-batch set on EVERY path, not just the successful one. A
    // confirmed write is confirmed by the on-disk hash diff, so a run that later
    // errored still promoted that content — and a subsequent daily in this same
    // batch carrying the same learning must still be denied. Persisting to state
    // alone is not enough: that only takes effect next session. First in this
    // block because it is the cheapest and the only step that cannot fail.
    for (const fingerprint of confirmedFingerprints) blockedFingerprints.add(fingerprint);

    // This daily's OWN fingerprints only. main() unions every entry at load, so
    // storing the global union here would re-store the whole corpus in every
    // entry and grow compile-state.json quadratically.
    ownFingerprints = [...new Set([...priorFingerprints, ...confirmedFingerprints])].sort();

    // Partial progress, recorded whenever the terminal-success branch below
    // will NOT run — a throw counts even if the terminal result had already
    // arrived, because the delete never happened and the daily stays pending.
    // Records what landed so the next attempt's PreToolUse guard denies
    // re-promoting it, and keeps the daily note: the run never proved it
    // finished reading, so there may be more to extract.
    //
    // Recorded even when NOTHING landed, unlike before — that entry carries no
    // fingerprints, so it changes nothing about what may be promoted next time;
    // its whole job is the `attempts` counter. A daily that fails this way
    // failed for a reason that will most likely repeat, and with the batch
    // capped and ordered oldest-first it would otherwise consume a slot every
    // session forever, ahead of every newer daily behind it.
    if (streamThrew || !terminalSuccess) {
      const attempts = priorAttempts + 1;
      recordCompileState(projectDir, dailyFilename, {
        hash,
        promoted: touchedNotePaths.size,
        fingerprints: ownFingerprints,
        partial: true,
        attempts,
      });
      if (attempts >= MAX_COMPILE_ATTEMPTS) {
        appendLog(
          projectDir,
          "compile.log",
          "daily",
          dailyFilename,
          `ABANDONED after ${attempts} attempts that never reached a terminal conclusion — this daily will no longer be compiled and its content was NOT promoted. It is still on disk: edit it (which changes its hash) or clear its entry from compile-state.json to retry.`,
        );
      }
    }

    // Deterministic sanitisation of what the sub-agent wrote — scoped to the
    // notes this run confirmed on disk, never a vault-wide sweep. After the
    // state record above on purpose: this is cosmetic repair, that is the
    // durable anti-duplication record.
    let guardSummary = "";
    if (touchedNotePaths.size > 0) {
      const guard = applyPostWriteGuard(
        vaultRoot,
        touchedNotePaths,
        collectValidTargets(vaultRoot),
      );
      const parts = [];
      if (guard.unlinked > 0) parts.push(`${guard.unlinked} broken wikilink(s) unlinked`);
      if (guard.consolidated > 0)
        parts.push(`${guard.consolidated} duplicate Related section(s) merged`);
      for (const note of guard.oversized) {
        parts.push(
          `${note.path} at ${note.lines} lines exceeds ${MAX_NOTE_LINES} — split it manually`,
        );
      }
      if (parts.length > 0) guardSummary = ` | guard: ${parts.join("; ")}`;
    }
    if (deniedDuplicateSlugs.size > 0) {
      guardSummary += ` | duplicate-slug denied once: ${[...deniedDuplicateSlugs].join(", ")}`;
    }

    appendLog(projectDir, "compile.log", "daily", dailyFilename, `${outcome}${guardSummary}`);
  }

  // Terminal success only, and deliberately OUTSIDE the finally: a throw must
  // never delete the daily note. The sub-agent reached a conclusion about it —
  // a promotion or a deliberate skip — so it has been consumed: record it and
  // remove it. A run that errored or ran out of turns never gets here, even if
  // it wrote something, because it may not have finished reading.
  if (terminalSuccess) {
    recordCompileState(projectDir, dailyFilename, {
      hash,
      promoted: touchedNotePaths.size,
      fingerprints: ownFingerprints,
      partial: false,
    });
    try {
      fs.unlinkSync(dailyPath);
    } catch {
      // Already gone, or read-only — the state record above is what stops a
      // reprocess, so a failed delete costs clutter, never a retry loop.
    }
  }
}

/**
 * How many daily notes one run may compile. Each costs a full LLM sub-session
 * and the whole batch holds the project-wide compile lock, so an uncapped
 * backlog (this repo has seen dozens) is hours of serialized work during which
 * no other session's compile can start. The remainder is not lost: the list is
 * oldest-first and re-derived every session, so the next session picks up
 * exactly where this one stopped.
 */
const MAX_DAILIES_PER_BATCH = 5;

/**
 * The compile lock's ownership nonce as read at the start of main(), kept at
 * module scope only so the entrypoint's `.finally()` — which cannot see main()'s
 * locals, and must run even when main() returns early — can release the lock
 * this process actually holds instead of whatever lock happens to be at the path
 * by then. Null until main() reads it, and null forever when there is no lock.
 * @type {string | null}
 */
let heldLockNonce = null;

/**
 * Reads mcpServers.obsidian once, then compiles every pending daily note
 * listPendingDailies() still finds pending, oldest first (capped at
 * MAX_DAILIES_PER_BATCH), one LLM sub-session each.
 *
 * Both parameters exist only so a test can drive this loop — the batch cap and
 * the lock-ownership stop below are decisions main() alone makes, and neither is
 * reachable through compileOne. The entrypoint calls `main()` with neither, so
 * production reads argv and uses the real SDK `query`, exactly as before.
 * @param {string} [projectDir] defaults to argv: [projectDir]
 * @param {(params: {prompt: string, options: any}) => AsyncIterable<any>} [queryFn]
 */
export async function main(projectDir = process.argv[2], queryFn = query) {
  if (!projectDir) return;

  const serverConfig = readObsidianServerConfig(projectDir);
  if (!serverConfig) return;

  const vaultRoot = path.join(projectDir, "__OBSIDIAN_VAULT_DIR__");
  const dailyDir = path.join(vaultRoot, "daily");
  const state = readCompileState(projectDir);

  // Every pending daily, oldest first, one LLM sub-session each. The hook only
  // decided that at least one exists; the list is derived here so it reflects
  // the state as of when this process actually starts.
  // Fingerprints from EVERY recorded daily, not just the one being compiled.
  // A batch replays days whose learnings may already have been promoted from
  // an adjacent day's note, so cross-daily blocking is the point: scoping this
  // per-daily would let identical content land twice.
  const blockedFingerprints = new Set();
  for (const entry of Object.values(state)) {
    if (Array.isArray(entry?.fingerprints)) {
      for (const fingerprint of entry.fingerprints) blockedFingerprints.add(fingerprint);
    }
  }

  // The nonce of the lock compile.mjs took on this process's behalf, read once
  // (see readCompileLockNonce for why it cannot be handed over in argv, and for
  // the residual window this leaves). Null when there is no lock at all — a
  // manual `node compile-runner.mjs <dir>` run — which keeps the pre-nonce
  // behaviour of proceeding unguarded rather than refusing to do anything.
  heldLockNonce = readCompileLockNonce(projectDir);

  const pending = listPendingDailies(dailyDir, state);
  const batch = pending.slice(0, MAX_DAILIES_PER_BATCH);
  if (batch.length < pending.length) {
    // Say so explicitly: a silent cap is indistinguishable in the log from
    // "there was nothing else to do".
    appendLog(
      projectDir,
      "compile.log",
      "batch",
      `${batch.length}/${pending.length}`,
      `capped at ${MAX_DAILIES_PER_BATCH} dailies per run — ${pending.length - batch.length} deferred to the next session (oldest first, so they are next in line)`,
    );
  }

  for (const dailyFilename of batch) {
    // The compile lock's stale window was sized for a single sub-session.
    // Refresh it per daily so a long batch is never mistaken for an abandoned
    // lock by a second session's hook — and stop the batch outright if that
    // refresh finds the lock is no longer ours, because from that point on a
    // second runner is working the same vault and every further daily this
    // process compiles risks duplicating its notes.
    const stillOwned = touchCompileLock(projectDir, heldLockNonce);
    if (heldLockNonce !== null && !stillOwned) {
      appendLog(
        projectDir,
        "compile.log",
        "batch",
        dailyFilename,
        "stopped: this run no longer holds the compile lock (taken over as stale, or released) — the remaining dailies stay pending for the next session",
      );
      break;
    }
    try {
      await compileOne({
        projectDir,
        vaultRoot,
        dailyDir,
        dailyFilename,
        serverConfig,
        blockedFingerprints,
        queryFn,
      });
    } catch {
      // One daily's failure must never starve the rest of the batch. The order
      // is oldest-first, so an uncontained throw here would make the same daily
      // fail first every session and block every newer one behind it forever.
      appendLog(projectDir, "compile.log", "daily", dailyFilename, "error: runner threw");
    }
  }
}

// Entrypoint guard: run (and exit) only when this file is the process's own
// entry script — i.e. spawned directly via `node compile-runner.mjs
// <projectDir>`, exactly how spawnDetachedRunner's caller in compile.mjs
// invokes it. Without this guard, merely `import`-ing this module (as
// tests/compile-runner.test.mjs does, to reach compileOne directly) would
// still run main() and hit the unconditional process.exit(0) in .finally()
// below, killing the importing process. Comparing
// pathToFileURL(process.argv[1]).href against import.meta.url, rather than a
// raw string path, is required for correctness on Windows (backslash vs.
// forward-slash and drive-letter casing would break a raw comparison).
if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  main()
    .catch(() => {
      // Swallow every error — this is a detached background worker with no
      // caller waiting on it and nothing to report a failure to.
    })
    .finally(() => {
      // Release the lock compile.mjs took on this process's behalf before
      // spawning it, on every exit path — a failed run must still let the next
      // session retry, and only a *crashed* runner should ever have to wait out
      // the stale window. Read from argv rather than threaded out of main()
      // (which returns early on several paths) — argv: [projectDir], the same
      // single positional argument main() itself reads at process.argv[2].
      // Skipped when argv is missing, since then no hook took a lock.
      //
      // Passing the nonce makes this release conditional on still owning the
      // lock: a runner whose lock was taken over mid-batch (it stopped, see
      // main()) must not delete the lock its successor is now relying on.
      const projectDir = process.argv[2];
      if (projectDir) releaseCompileLock(projectDir, heldLockNonce);
      process.exit(0);
    });
}
