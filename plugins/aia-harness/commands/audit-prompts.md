---
description: Review CLAUDE.md files, rules, skills, agents and commands for prompt text written for older Claude models and propose a diff fitted to the models the project pins — nothing is written until you approve.
argument-hint: "[path]"
allowed-tools:
  - Bash
  - Read
  - Grep
  - Edit
  - AskUserQuestion
  - Agent
  - Skill
---

# /aia-harness:audit-prompts

Target directory: `$1` if provided, else `$CLAUDE_PROJECT_DIR`. If the path arrives wrapped in double quotes, drop them: the quotes are not part of the path.

<!-- aia-harness:target-dir-resolution -->
Resolve this **once**, at the
start of this command, into a concrete literal absolute path. `$CLAUDE_PROJECT_DIR` is documented
as available "when hooks are executed" but is not guaranteed inside the general-purpose Bash tool
used to run these instructions — it can silently expand empty there, and the CLI then falls back
to the shell's *current* working directory, which is wrong if the agent has since `cd`'d elsewhere
(e.g. into the scratchpad for intermediate file work). Reuse that one resolved literal path in
every subsequent invocation below, never re-expand a bare `$CLAUDE_PROJECT_DIR` in a later,
separately-issued Bash call, since each Bash tool call is a fresh shell (only cwd persists, not
exported variables) and an earlier `cd` silently redirects any later bare-env-var fallback to the
wrong place.

<!-- aia-harness:version-check -->
## Before anything else — plugin version check

```bash
node "${CLAUDE_PLUGIN_ROOT}/bin/harness.mjs" version-check --json
```

Read `status` from the JSON:

- `"stale"` — report `running` → `latest`, then `AskUserQuestion`: **Update now** (run the
  returned `updateCommand`, then stop and tell the user to run `/reload-plugins` or start a new
  session and re-issue this command — a running plugin copy cannot hot-swap itself) or
  **Continue on the current version** (go straight to the next step).
- `"current"` or `"unknown"` — say nothing, continue.

This check never blocks: it exits 0 even when it cannot reach the registry, and `"unknown"`
means the answer is unavailable, not that something is wrong.
<!-- /aia-harness:version-check -->

Current Claude models follow instructions more literally than the models most harnesses were first written for. Prompt text tuned for those older models — shouting emphasis, step-by-step scripts for judgment work, scaffolds that an API feature has since replaced, examples that freeze old behaviour, files that contradict each other — no longer helps and can steer a current model wrong. This command finds that text and proposes fixes. It does not shorten prompts for size; `/aia-harness:condense-harness-prompts` does that.

The audit itself is the `prompt-audit` subcommand of the `claude-api` skill that ships with Claude Code. It reads every prompt file, so it can take ten minutes or more and uses real tokens. This command adds what that skill cannot know: which models the project pins, which files are third-party copies, and an approval gate before any edit.

## 1. Find the target models

Use `Grep` on `.claude/settings.json` in the target directory for the three keys `"model"`, `ANTHROPIC_DEFAULT_OPUS_MODEL` and `ANTHROPIC_DEFAULT_SONNET_MODEL`, and read only the matching lines. Never read `.claude/settings.local.json`: it can hold credentials.

Every value that is a full model id (it starts with `claude-`) is a target model. Tell the user which ids you found; they go into the audit prompt as `<target models>`. When there is no such id, or no `settings.json`, `<target models>` is the sentence "the newest Opus and Sonnet that the Current Models table of the `claude-api` skill you loaded lists as current", and you tell the user the audit will name those models in its report. If a matching line holds more than one setting (a minified file), ignore it as if no id were found.

## 2. Run the audit in a subagent

The skill is large and its working notes do not belong in this conversation, so run it in one subagent: `Agent` with `subagent_type: "general-purpose"` and `model: "sonnet"`. Fill `<target directory>` with the resolved target directory and `<target models>` as step 1 says:

> Audit the prompt surface of the project at `<target directory>` for text written for older Claude models.
>
> 1. Call the `Skill` tool with `skill: "claude-api"` and `args: "prompt-audit"`, then follow the instructions it loads, in order. If there is no `claude-api` skill, the call fails, or the loaded instructions are not the `prompt-audit` procedure (it ends in an audit report and a proposed diff), reply with exactly `SKILL_UNAVAILABLE` and stop.
> 2. This settles the scope and the target models, so do not ask. Scope: every CLAUDE.md file in `<target directory>` and everything under its `.claude/rules`, `.claude/skills`, `.claude/agents` and `.claude/commands`. Skip every file whose first 20 lines contain the text `<!-- Vendored from`, and everything under `<target directory>/.claude/skills/graphify`: those are third-party copies fixed upstream, so list them as skipped instead of auditing them. Do not read any settings file.
> 3. Target models: `<target models>`. Audit each file against all of them, except a file that pins its own `model:`, which you audit against that model. Name the target models in the report's assumptions.
> 4. Propose only. Do not create, edit or delete any file.
> 5. Reply with the skill's two deliverables in full. Number the findings in the report. Give the proposed diff as one hunk per finding, each hunk headed `#<number> | <file:line> | <confidence> | <pattern row>`. After them, list the skipped files. Make the last line of your reply exactly `END_OF_AUDIT`. If the surface is clean, say so in one line that names the target models, then list the skipped files, then the last line.

## 3. Present the result

Check the reply in this order:

- `SKILL_UNAVAILABLE`: tell the user this command needs a recent Claude Code whose `claude-api` skill has the `prompt-audit` subcommand, suggest updating Claude Code, and stop. Nothing was changed.
- No `END_OF_AUDIT` last line: the reply was cut off, or the subagent failed. Tell the user and ask with `AskUserQuestion` whether to run the audit again once per location (five audits in parallel, each about as long and as costly as the first) or to stop. To run again, dispatch the five in one message, one per location: the CLAUDE.md files, `.claude/rules`, `.claude/skills`, `.claude/agents`, `.claude/commands`. Keep the prompt as it is and narrow only the scope sentence in item 2 to that location. Merge the replies and renumber the findings and hunk headings 1 to N. Report a location whose reply is cut off again as not audited.
- A clean surface: say so, name the target models the audit used, give the number of skipped files, and stop. An audit that finds nothing changes nothing.
- Otherwise show, in this order: the assumptions (scope and target models), the summary (top findings in prose, counts per group), the findings table (number, `file:line`, pattern, action, confidence), then every proposed hunk as a diff, grouped by file. The user must see each diff before deciding. Say that the skipped files are third-party copies, fixed upstream and not by editing the copy.

Findings whose action is `flag`, and every low-confidence finding, are report-only and never get a hunk. When there is no hunk at all, stop here.

## 4. Ask what to apply

Use `AskUserQuestion`:

- **Apply the high-confidence hunks (Recommended)** — every high-confidence hunk except those under the skill's stale-fact rows ("Volatile specifics") and its contradiction rows ("Instruction files that contradict each other"): those rest on other files and are asked one by one.
- **Choose hunk by hunk** — one Apply / Skip question per hunk, medium-confidence hunks included, up to four hunks per `AskUserQuestion` call, each quoting the hunk's removed and added lines.
- **Apply nothing** — keep the report only.

For each approved hunk, `Read` the file, confirm the old text is still there, then apply the hunk with `Edit`. Never rewrite a file wholesale. A hunk that `Edit` cannot express, such as deleting or moving a file, is listed for the user to apply by hand. If the old text no longer matches, skip that hunk and say so.

Tell the user that a file aia-harness generated (agents, rules, CLAUDE.md sections) will show up as a conflict at the next `/aia-harness:patch`, because it now differs from the generated version; there they can keep their version.

## 5. Report

State how many hunks were applied and in how many files, how many were skipped or left for the user to apply by hand, how many findings were report-only, and how many files were skipped as third-party copies. When any hunk was applied, add that a removed instruction is a hypothesis: run the project's evals or a quick check of the affected prompts, and if behaviour regresses, put the instruction back in its minimal form.
