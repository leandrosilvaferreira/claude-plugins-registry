# Best Practices — Agents (`.claude/agents/`)

> Reference for compressing agent files. Apply these rules when condensing — preserve what matters, compress what is prose.

## Frontmatter fields

| Field | Required | Compression: rule |
|-------|----------|-------------------|
| `name` | **YES** | Preserve exact — it is the unique identifier; hooks receive it via `agent_type` |
| `description` | **YES** | Compress prose BUT preserve all delegation triggers (see below) |
| `tools` | no | Preserve exact — defines the tool allowlist; omitting it = inherits everything |
| `disallowedTools` | no | Preserve exact — it is a security denylist |
| `model` | no | Preserve exact — `sonnet`/`opus`/`haiku`/`fable`/full-id/`inherit` |
| `permissionMode` | no | Preserve exact — `default`/`acceptEdits`/`auto`/`dontAsk`/`bypassPermissions`/`plan` |
| `maxTurns` | no | Preserve exact — agentic turn limit |
| `skills` | no | Preserve exact — skills preloaded into the subagent context |
| `mcpServers` | no | Preserve exact — MCP servers available to the subagent |
| `hooks` | no | Preserve exact — hooks scoped to the subagent |
| `memory` | no | Preserve exact — `user`/`project`/`local` |
| `background` | no | Preserve exact |
| `effort` | no | Preserve exact — `low`/`medium`/`high`/`xhigh`/`max` |
| `isolation` | no | Preserve exact — `worktree` for an isolated git copy |
| `color` | no | Preserve exact |

**Golden rule for agent frontmatter:** All fields are semantic (they control real behavior). Never compress or remove existing fields — only the value of the `description` field admits prose condensation.

## Compressing `description`

`description` is the most critical field: Claude uses it to decide when to delegate. Compress prose but **mandatory to preserve**:

- "Use when..." / "Use proactively after..." / "Triggers on..." patterns — these are the delegation triggers
- Mentions of specific tools, commands, workflows
- File names, extensions, events mentioned as activation context
- Concrete examples of when to invoke

**Compress:** redundancies, articles, hedging, obvious explanations of what the agent does (not when)

```yaml
# BAD (too verbose):
description: This is a specialized agent that reviews code for quality issues, best practices, security vulnerabilities, and maintainability concerns. Use it when you need to review code or check the quality of any source file.

# GOOD (triggers preserved, prose condensed):
description: Reviews code for quality, security, maintainability. Use when reviewing code, checking PRs, or analyzing source files after changes.
```

## Compressing the body (system prompt)

The agent body is its system prompt — it is the ONLY context the subagent receives (it does not inherit Claude Code's system prompt).

**Compress aggressively:**
- Introductory/explanatory prose
- Repetition of rules already stated
- Hedging, pleasantries, fillers

**Mandatory to preserve:**
- Every rule, restriction, or specific behavior
- Concrete input/output examples
- Tool names, bash commands, specific paths
- Numeric thresholds and boolean conditions
- Explicit prohibitions ("NEVER X", "ALWAYS Y")

## Body quality standard

The ideal body is concise and imperative:

```markdown
# BAD (verbose):
You are a code reviewer. Your job is to analyze code that is provided to you and give feedback about the quality. When you receive code, you should look at it carefully and think about potential issues...

# GOOD (imperative):
Review code for:
1. Correctness: logic errors, edge cases, null handling
2. Security: injection, auth bypass, data exposure
3. Maintainability: naming, complexity, duplication
Return: numbered findings with file:line references.
```

## Invariants — never violate when compressing

- `name` must stay lowercase with hyphens (no spaces, uppercase, underscores)
- `tools` and `disallowedTools` must not have tools removed from the list
- If `isolation: worktree` exists, preserve it — deleting it removes isolation
- A specific `model` must not be removed (it would change which model runs the task)
- Any `permissionMode` other than `default` is intentional — preserve it
