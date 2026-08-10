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
 *    Exemption (added 2026-08-04, user-approved): a command that is ENTIRELY
 *    made of `git add|status|diff|commit|push|log` invocations is let
 *    through even when it names a .vault-obsidian/ path. The vault is
 *    versioned in git like any other tracked directory (see
 *    .claude/rules/obsidian.md), and these six subcommands only stage,
 *    inspect, or publish content that already reached disk through the MCP
 *    tools (or the session-log/compile sub-sessions below) — they cannot
 *    introduce or rewrite note content themselves, so they don't bypass the
 *    template/wikilink/slug enforcement this hook exists to protect.
 *    Destructive or content-rewriting git plumbing (`checkout`/`restore`/
 *    `reset`/`rm`/`mv`/`clean`) is deliberately NOT on this list.
 *
 *    SAFETY MECHANISM (rewritten 2026-08-04 after a same-day security
 *    review caught the first version, then tightened same-day by a second
 *    review pass): reject the WHOLE raw command outright if it contains ANY
 *    shell metacharacter that can spawn a subprocess, expand a variable,
 *    redirect I/O, or cross a line boundary — backtick, ANY `$` (covers
 *    `$(command substitution)`, `${parameter expansion}`, and plain `$VAR`,
 *    which can silently leak an environment variable's value into whatever
 *    consumes the command's output), `<`, `>`, a LONE `&` (background/detach
 *    — `&&` itself stays legal, it is the segment separator this allowlist
 *    already splits on), a real backslash, or a newline/CR — before ever
 *    splitting it into segments. The first version tried to tell "safe data
 *    inside quotes" apart from "dangerous shell syntax" by erasing
 *    quoted/heredoc regions with regex before matching; that approach
 *    shipped with two real bugs on its first day: `git commit -m "$(cmd)"`
 *    matched the safe-subcommand pattern because the erasure treated the
 *    double-quoted region as inert data, when bash actually runs `cmd` first
 *    regardless of the surrounding quotes; and the segment splitter didn't
 *    treat a bare newline as a command separator the way bash does, so
 *    `git add x\ncat .vault-obsidian/secret.md` read as one single "git add"
 *    segment and passed. A flat denylist on the untouched raw string has no
 *    equivalent gap: none of these characters can ever legitimately appear
 *    in a plain `git add/status/diff/commit/push/log` invocation's OWN
 *    syntax, so rejecting on sight of one is always safe — at the cost of
 *    also rejecting some unusual-but-innocent commit messages (e.g. one
 *    containing a literal `<`, `&`, `$`, or backtick). Those still work via
 *    `git commit -F <file>`, with the message written to `<file>` through
 *    the Write tool instead of embedded in the Bash command string — and
 *    multi-line messages now require that path too, since a newline
 *    anywhere in the command is an unconditional reject. Checked against the
 *    RAW `input.command`, not the backslash-normalized `command` below —
 *    that normalization exists for Windows path matching (point 1) and
 *    would silently turn a real line-continuation backslash into `/`,
 *    hiding it from this check while the shell that actually executes the
 *    command still sees the original backslash.
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
 * point 2 above), and now carries one narrow, explicit allowlist (git
 * add/status/diff/commit/push/log — see point 2) for git plumbing over
 * already-materialized vault files. Any OTHER genuine need for direct
 * access means unwiring the hook, not widening this list.
 *
 * Wire in .claude/settings.json under PreToolUse with matcher
 * "Read|Grep|Glob|Write|Edit|MultiEdit|NotebookEdit|Bash|PowerShell". Fails open on any
 * I/O or parse error, including literal `null` on stdin (exit 0, no output)
 * — a vault hook must never block a session on its own plumbing failure.
 */
import path from "node:path";
import { parseHookEvent, readStdinRaw } from "./hook-io.mjs";

// Anti-recursion / sub-session exemption — same idiom as vault-orient.mjs.
if (process.env.CLAUDE_INVOKED_BY) process.exit(0);

const event = parseHookEvent(readStdinRaw());
if (event === null) process.exit(0);

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
// See file-level doc comment, point 2, "Exemption" and "SAFETY MECHANISM" —
// git plumbing that can only stage/inspect/publish, never write note
// content or spawn anything else, is let through even when it names a
// .vault-obsidian/ path.
//
// Reject outright on any shell metacharacter capable of spawning a
// subprocess, redirecting I/O, or crossing a line boundary — checked on the
// RAW, un-normalized command (see file-level comment for why). This must
// run BEFORE segment-splitting: `git commit -m "$(cmd)"` is one segment
// that matches SAFE_GIT_SUBCOMMAND_RE below on its face, so the dangerous-
// character check is what actually stops it, not the split. `&` is checked
// separately, below — `&&` (the segment separator) must stay legal, so it
// can't sit in this same blanket character class.
const DANGEROUS_CHAR_RE = /[`<>\\\n\r$]/;

// Strip an optional leading `rtk ` before matching: an rtk wrapper (this
// project's own `rtk-hook.mjs`, if installed via `/add-tools`, or a user's
// global RTK config) can transparently rewrite `git ...` into `rtk git ...`
// before this hook ever sees the command. Matching bare `git` only would
// deny every rewritten invocation, including the plain `git add`/`git
// commit` this allowlist exists to permit.
const SAFE_GIT_SUBCOMMAND_RE = /^\s*git\s+(add|status|diff|commit|push|log)\b/;
const RTK_PREFIX_RE = /^\s*rtk\s+/;

// Every `&&`/`;`/`|`-separated segment of the command must independently
// match — `git add .vault-obsidian/ && cat .vault-obsidian/x.md` stays
// blocked because its second segment doesn't (and would also be caught
// above: `cat` isn't in the safe-subcommand list even without a dangerous
// character in sight).
/**
 * @param {string} cmd
 * @returns {boolean}
 */
function isSafeGitPlumbing(cmd) {
  if (DANGEROUS_CHAR_RE.test(cmd)) return false;
  // A lone `&` backgrounds/detaches a command — dangerous, reject. `&&` is
  // the separator this allowlist itself relies on, so strip every `&&` pair
  // first; anything left over is a real single ampersand.
  if (cmd.replace(/&&/g, "").includes("&")) return false;
  const segments = cmd
    .split(/&&|;|\|/)
    .map((s) => s.trim().replace(RTK_PREFIX_RE, ""))
    .filter(Boolean);
  return segments.length > 0 && segments.every((s) => SAFE_GIT_SUBCOMMAND_RE.test(s));
}

const rawCommand = typeof input.command === "string" ? input.command : "";
const command = rawCommand.replace(/\\/g, "/");
const commandHit = command.includes("__OBSIDIAN_VAULT_DIR__/") && !isSafeGitPlumbing(rawCommand);

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
