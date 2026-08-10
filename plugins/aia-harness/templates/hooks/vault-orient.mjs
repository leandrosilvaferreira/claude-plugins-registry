#!/usr/bin/env node
/**
 * UserPromptSubmit orientation hook for the project's Obsidian vault. When
 * `.vault-obsidian/` exists as a directory, injects a short instruction
 * telling the model when to search it (via the obsidian MCP server) before
 * answering. No regex classification of the prompt — the model judges when
 * the instruction applies, the same "let the model decide" approach as
 * `graphify-orient.mjs`. Pure context injection: emits `additionalContext`
 * only, never a permission decision, so it never blocks a session.
 *
 * Inert (exit 0, no output) when `<projectRoot>/.vault-obsidian` does not
 * exist as a directory — same gate shape as `graphify-orient.mjs`'s
 * graph.json presence check. A plain file named `.vault-obsidian` (not a
 * directory) is also treated as absent.
 *
 * Cross-platform: plain Node (no shell), wired exec-form (`node <path>`) in
 * .claude/settings.json under UserPromptSubmit, no matcher (fires on every
 * prompt).
 *
 * Fails open on any I/O or parse error, including literal `null` on stdin
 * (exit 0, no output) — a vault hook must never block a session.
 */
import fs from "node:fs";
import path from "node:path";
import { parseHookEvent, readStdinRaw } from "./hook-io.mjs";

// Anti-recursion guard — this is sub-session pollution prevention, NOT
// infinite-recursion prevention (this hook never spawns anything itself).
// Later tasks (session-log, compile) spawn Agent SDK sub-sessions that,
// without a `settingSources` override, load this repo's .claude/settings.json
// by default — including this no-matcher UserPromptSubmit hook. Left
// unguarded, every sub-session prompt would receive the injected instruction
// below and be nudged to call an obsidian MCP tool outside its allowlist,
// wasting its turn budget. Those runners set CLAUDE_INVOKED_BY on the child
// process env; exit before touching stdin.
if (process.env.CLAUDE_INVOKED_BY) process.exit(0);

const VAULT_CONTEXT = [
  "MANDATORY: this project's long-term memory lives in the Obsidian vault at",
  "__OBSIDIAN_VAULT_DIR__/. It is NOT the same as reading code or grepping the repo —",
  'it holds the "why," not the "what": decisions made and their reasoning,',
  "approaches already tried and abandoned, conventions spanning multiple",
  "modules, and lessons learned the hard way.",
  "",
  'You MUST call mcp__obsidian__search_notes_tool(query="<one specific term>",',
  "context_length=20) BEFORE answering whenever ANY of these apply — check this",
  'list explicitly, don\'t rely on it "feeling" relevant:',
  "- The user references past work, a prior decision, or something already",
  '  done or already tried — even implicitly (a spec framed as "context for a',
  '  new session," a request to continue, or any task that could plausibly',
  "  have prior history in this repo).",
  "- You are about to design, plan, or implement something non-trivial —",
  "  search for prior art on the same topic BEFORE committing to an approach.",
  "- A convention, pattern, or gotcha might span multiple files or modules.",
  "- You are unsure whether something has already been tried.",
  "",
  "A request that is large, urgent, or looks self-contained is NOT a reason to",
  "skip this — that is exactly when missed prior context costs the most.",
  "",
  "03-knowledge/ = consolidated lessons. daily/ = per-session log.",
  "Never enumerate the vault. Never Read/Grep/Bash __OBSIDIAN_VAULT_DIR__/ directly —",
  "mcp__obsidian__* tools are the only correct access path (they enforce",
  "template, wikilink and slug rules that direct file access bypasses).",
].join("\n");

const event = parseHookEvent(readStdinRaw());
if (event === null) process.exit(0);

// Purpose C — project-wide, cross-worktree resource (see
// .claude/rules/hooks-cwd-resolution.md's Purpose C section): the vault must
// be the SAME vault from every worktree and must outlive the session, so
// this deliberately resolves CLAUDE_PROJECT_DIR before event.cwd — the
// opposite order of that rule's Purpose-A snippet. .vault-obsidian/ is
// gitignored, so a worktree's event.cwd almost never has its own copy;
// resolving cwd first would silently treat the vault as permanently absent
// in every worktree session.
const cwdArg = typeof event.cwd === "string" && event.cwd ? event.cwd : "";
const projectRoot = process.env.CLAUDE_PROJECT_DIR || cwdArg || process.cwd();
const vaultDir = path.join(projectRoot, "__OBSIDIAN_VAULT_DIR__");

let vaultIsDir = false;
try {
  vaultIsDir = fs.statSync(vaultDir).isDirectory();
} catch {
  vaultIsDir = false; // missing, unreadable, or any other stat error → treat as absent
}

if (!vaultIsDir) process.exit(0);

process.stdout.write(
  JSON.stringify({
    hookSpecificOutput: {
      hookEventName: "UserPromptSubmit",
      additionalContext: VAULT_CONTEXT,
    },
  }),
);

process.exit(0);
