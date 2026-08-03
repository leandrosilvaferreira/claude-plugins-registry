#!/usr/bin/env node
/**
 * PreToolUse guard for the project's Obsidian vault. Denies any Read, Grep,
 * Glob, Write, Edit, MultiEdit, or NotebookEdit whose tool input references a
 * path under `.vault-obsidian/`, and any Bash command whose command string
 * contains a `.vault-obsidian/` segment — names the obsidian MCP tool to use
 * instead.
 *
 * Direct filesystem access bypasses the obsidian MCP server's template
 * enforcement, `strict` wikilink validation, and kebab slug normalization —
 * a hand-written note silently violates all three and only fails later, at
 * some unrelated write. `Write`/`Edit`/`MultiEdit`/`NotebookEdit` are guarded
 * alongside the read tools: writing a note by hand is strictly more damaging
 * than reading one, and for the structured-path tools it is the same code
 * path.
 *
 * Two distinct checks, two distinct guarantees:
 *
 * 1. Structured path fields — a HARD boundary. Every candidate path field
 *    present on the tool input (`file_path`, `path`, `pattern`, `glob`,
 *    `notebook_path`) is checked for a real `.vault-obsidian/` directory
 *    segment — not a loose substring, so e.g. `docs/about-vault-obsidian-setup.md`
 *    is left alone. `glob` is Grep's own file filter (e.g.
 *    `--glob ".vault-obsidian/**"`) — distinct from `path` (the dir Grep/Glob
 *    search under) and from `pattern` (Grep's search regex, not path-shaped
 *    at all, vs. Glob's own search pattern, which is). Without `glob` in
 *    this list, `{pattern:"secret", path:".", glob:".vault-obsidian/**"}`
 *    slips past every other candidate while still searching the vault.
 *    Backslash separators (Windows) are normalized to `/` before matching.
 *    For these tools there is no field-level escape hatch — any tool that
 *    carries one of these field names on its `tool_input` is caught as long
 *    as it is also listed in the settings.json matcher.
 *
 * 2. Bash `command` string — BEST EFFORT ONLY, not a security boundary. Bash
 *    has no structured path field: the vault path, if present at all, is
 *    embedded inside an arbitrary shell command string. This is a plain
 *    substring check (`.vault-obsidian/` anywhere in the command), which
 *    catches the accidental/casual case (`cat >> .vault-obsidian/x.md`,
 *    `sed -i ... .vault-obsidian/y.md`) but does NOT stop a determined
 *    bypass: variable indirection (`f=.vault-obsidian; cat >> "$f/x"`),
 *    base64/encoding, or `cd .vault-obsidian && cat >> x.md` all slip past a
 *    string match. See .claude/rules/obsidian.md for the documented ceiling.
 *
 * Carve-out: `.vault-obsidian/daily/` is exempt from the structured-path
 * check, but ONLY for the three read-only tools (`Read`, `Grep`, `Glob`) —
 * daily notes are auto-generated raw session logs, not curated knowledge,
 * and an agent legitimately needs to inspect the backlog directly
 * (list/grep/read) without an MCP round-trip per note.
 * `Write`/`Edit`/`MultiEdit`/`NotebookEdit` on `daily/` are still denied: the
 * MCP server's frontmatter/template/slug enforcement must still gate
 * anything actually written there. The Bash command-string check is
 * unaffected by this carve-out — it still denies any `.vault-obsidian/`
 * reference, `daily/` included, since a shell command can write as easily
 * as it can read.
 *
 * When no candidate path and no Bash command touches the vault — the
 * overwhelmingly common case, every Read in every session hits this hook —
 * it emits nothing at all.
 *
 * Exempt: `process.env.CLAUDE_INVOKED_BY` set. `.claude/scripts/session-log-runner.mjs`
 * and `.claude/scripts/compile-runner.mjs` set this on the Agent SDK
 * sub-sessions they spawn to legitimately read/write the vault (session
 * logging, daily -> 03-knowledge/ promotion); those calls must never be
 * denied.
 *
 * No escape hatch BY FIELD NAME: for the structured-path tools, with this
 * wired, editing the vault by hand from a Claude session through one of
 * those tools is impossible — that is the intent. A human editing the vault
 * in Obsidian itself is unaffected (hooks only see Claude Code tool calls).
 * The shell command-string check does not carry the same guarantee (see
 * point 2 above). If a genuine need for direct access ever appears, unwire
 * the hook rather than adding a config flag.
 *
 * Wire in .claude/settings.json under PreToolUse with matcher
 * "Read|Grep|Glob|Write|Edit|MultiEdit|NotebookEdit|Bash|PowerShell". Fails open on any
 * I/O or parse error, including literal `null` on stdin (exit 0, no output)
 * — a vault hook must never block a session on its own plumbing failure.
 */
import fs from "node:fs";
import path from "node:path";

// Anti-recursion / sub-session exemption — same idiom as vault-orient.mjs.
if (process.env.CLAUDE_INVOKED_BY) process.exit(0);

/** @returns {string} */
function readStdin() {
  try {
    return fs.readFileSync(0, "utf8");
  } catch {
    return "";
  }
}

/** @type {any} */
let event;
try {
  event = JSON.parse(readStdin() || "{}");
} catch {
  process.exit(0);
}

// Literal `null` is valid JSON and parses without throwing — the repo-wide
// `JSON.parse(x || "{}")` idiom alone does not catch it. Guard explicitly
// (see .claude/memory/hook-stdin-null-crash.md).
if (typeof event !== "object" || event === null) process.exit(0);

const input = event.tool_input ?? {};

// Each candidate is tested on its own, never concatenated into one blob:
// a joined "fileA pathB patternC" string would put a literal space before
// pathB whenever fileA is empty, so the "start of string" anchor below would
// never line up with pathB's own boundary.
// path.posix.normalize collapses "." / ".." segments (e.g.
// "__OBSIDIAN_VAULT_DIR__/daily/../03-knowledge/x.md" -> "__OBSIDIAN_VAULT_DIR__/03-knowledge/x.md")
// BEFORE either regex runs below — without it, a "daily/.." prefix resolves
// outside daily/ on the real filesystem while still text-matching
// DAILY_SEGMENT_RE, defeating the read-only carve-out for the whole vault.
const candidates = [input.file_path, input.path, input.pattern, input.glob, input.notebook_path]
  .filter((v) => typeof v === "string")
  .map((v) => path.posix.normalize(v.replace(/\\/g, "/")));

// Directory-segment match only: the vault segment must be preceded by "/" or
// string-start, and followed by "/" or string-end. A loose substring match
// (e.g. matching on "vault-obsidian" alone) would wrongly deny
// docs/about-vault-obsidian-setup.md, which lives nowhere near the vault.
const VAULT_SEGMENT_RE = /(^|\/)__OBSIDIAN_VAULT_DIR__(\/|$)/;

// Read-only carve-out (see file-level doc comment): Read/Grep/Glob may target
// __OBSIDIAN_VAULT_DIR__/daily/ directly. Same segment-boundary discipline as
// VAULT_SEGMENT_RE, so "daily-backup" or "dailyfoo" are never mistaken for it.
const DAILY_SEGMENT_RE = /(^|\/)__OBSIDIAN_VAULT_DIR__\/daily(\/|$)/;
const READ_ONLY_TOOLS = new Set(["Read", "Grep", "Glob"]);
const toolName = typeof event.tool_name === "string" ? event.tool_name : "";
const dailyReadExempt = READ_ONLY_TOOLS.has(toolName);

const pathHit = candidates.some(
  (c) => VAULT_SEGMENT_RE.test(c) && !(dailyReadExempt && DAILY_SEGMENT_RE.test(c)),
);

// Shell tools (Bash, PowerShell) have no structured path field, so the vault
// path (if present at all) is embedded inside an arbitrary command string — a
// plain substring check, not the anchored directory-segment regex above (that
// regex assumes a standalone path; a command string usually has a space or
// shell operator, not "/", right before the segment, e.g.
// "cat >> .vault-obsidian/x.md"). Keyed on the `command` field rather than on
// the tool name, so it covers every shell tool in the matcher uniformly.
// Best-effort only — see the file-level doc comment for what this does not
// cover (variable indirection, encoding, `cd` then a relative path).
const command = typeof input.command === "string" ? input.command.replace(/\\/g, "/") : "";
const commandHit = command.includes("__OBSIDIAN_VAULT_DIR__/");

if (!pathHit && !commandHit) process.exit(0);

const REASON = [
  "__OBSIDIAN_VAULT_DIR__/ is served by the obsidian MCP server — direct file access bypasses",
  "its template, wikilink and slug enforcement. Use the MCP tools instead:",
  "  read a note      -> mcp__obsidian__read_note_tool",
  "  find notes       -> mcp__obsidian__search_notes_tool",
  "  list a folder    -> mcp__obsidian__list_notes_tool",
  "  create a note    -> mcp__obsidian__create_note_tool",
  "  edit a section   -> mcp__obsidian__edit_note_section_tool",
  "  append to daily  -> mcp__obsidian__add_daily_note_tool",
].join("\n");

process.stdout.write(
  JSON.stringify({
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      permissionDecision: "deny",
      permissionDecisionReason: REASON,
    },
  }),
);

process.exit(0);
