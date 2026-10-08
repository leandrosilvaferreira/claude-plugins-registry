#!/usr/bin/env node
/**
 * UserPromptSubmit hook that injects a standing "orchestration mode"
 * directive on every prompt: run the session as orchestrator, delegate
 * exploration/implementation to subagents, set `model` explicitly per
 * dispatch, and parallelize independent work. Delivered as a hook rather
 * than CLAUDE.md content because CLAUDE.md loses attention over a long
 * session — re-injecting it on every turn keeps the directive live
 * regardless of session length or context compaction.
 *
 * Injection is unconditional: no filesystem check, no project-type gating,
 * no caching, no session flag. Pure context injection (additionalContext
 * only, never a permission decision), so it never blocks a session.
 *
 * Cross-platform: plain Node (no shell), wired exec-form (`node <path>`) in
 * .claude/settings.json under UserPromptSubmit, no matcher (fires on every
 * prompt).
 *
 * Fails open on any I/O or parse error, including literal `null` on stdin
 * (exit 0, no output) — this hook must never block a session.
 */
import { parseHookEvent, readStdinRaw } from "./hook-io.mjs";

// Anti-recursion guard — sub-session pollution prevention. Runners that spawn
// Agent SDK sub-sessions set CLAUDE_INVOKED_BY on the child process env;
// without this guard every sub-session prompt would also receive the
// orchestration directive, prompting it to delegate further and risking a
// recursive delegation storm.
if (process.env.CLAUDE_INVOKED_BY) process.exit(0);

const ORCHESTRATION_CONTEXT = `ORCHESTRATION MODE — MANDATORY

Run this session as orchestrator: plan, decompose, sequence, delegate, adjudicate, answer.
Delegate exploration and implementation to specialist subagents (Agent tool).
Work inline only when delegating costs more than the work itself: trivial single-file
edits, one-line answers, and the final synthesis of subagent reports.

Set \`model\` explicitly on every dispatch: it wins over the agent's frontmatter \`model\`,
and the agent's \`effort:\` frontmatter applies either way. A project agent or generic dispatch
without a model is forced to sonnet by a hook, but a plugin-namespaced agent (\`plugin:name\`)
is not rewritten and would run on this session's model.
  haiku  — closed scope, checkable result: locate code, grep sweeps, read-only surveys,
           docs, config and mechanical edits with a complete spec, even across files.
  sonnet — judgment inside the code: domain logic, integration, tests, review, debugging.
  opus   — planning, cross-domain orchestration, final review of a money, security or
           irreversible change; never an implementer.
Start with the cheapest tier that fits. Verify every haiku result on disk before you rely on it.
This session keeps the model the user selected — never downgrade it.

Dispatch independent subagents in parallel: multiple Agent calls in ONE message.
Sequence only on real conflict — same files written, or one needs another's output.
Read-only investigation parallelizes by default.

Every dispatch carries its own complete context. Subagents inherit nothing from this
conversation: state the task, exact paths, constraints, and the expected return.`;

const event = parseHookEvent(readStdinRaw());
if (event === null) process.exit(0);

process.stdout.write(
  JSON.stringify({
    hookSpecificOutput: {
      hookEventName: "UserPromptSubmit",
      additionalContext: ORCHESTRATION_CONTEXT,
    },
  }),
);

process.exit(0);
