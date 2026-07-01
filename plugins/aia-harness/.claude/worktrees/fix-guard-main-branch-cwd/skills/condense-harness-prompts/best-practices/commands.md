# Best Practices — Commands (`.claude/commands/<name>.md`)

> Reference for compressing command files. Commands are plain markdown (not a directory), invoked via `/name`. They use `allowed-tools` (NOT `tools`). The body is the prompt sent to Claude when the command is invoked.

## Frontmatter fields

| Field | Required | Compression: rule |
|-------|----------|-------------------|
| `description` | **YES** | Compress prose BUT preserve what describes the purpose — it shows up in autocomplete |
| `allowed-tools` | no | Preserve exact — allowlist of tools for command execution |
| `argument-hint` | no | Preserve exact — tab-completion hint, e.g. `[path]`, `<branch>` |
| `model` | no | Preserve exact — model override for this command |
| `disable-model-invocation` | no | Preserve exact — `true` = only the user can invoke |

**Note:** Commands use `allowed-tools`, not `tools`. If the file uses `tools`, it is a frontmatter error (fixed by the validator before compression).

## Critical difference: command vs skill

- **Command** (`.claude/commands/name.md`): single file, no directory structure
- **Skill** (`.claude/skills/name/SKILL.md`): directory with SKILL.md + optional auxiliary files

Both create `/name` — but commands are simpler and suited to linear flows that need no auxiliary files.

## Compressing `description`

`description` appears in autocomplete and in the list of available commands. It is shorter than a skill description — it focuses on WHAT, not WHEN.

```yaml
# BAD:
description: This command helps you create a git commit with a well-formatted commit message by analyzing the current staged changes and generating an appropriate message.

# GOOD:
description: Create a git commit with an appropriate message based on staged changes.
```

## Compressing the body

The body is the full prompt sent to Claude when `/name` is invoked. It is a task instruction.

**Mandatory to preserve:**
- Bash blocks with exact commands and flags (`"${CLAUDE_PLUGIN_ROOT}/bin/..."`  etc.)
- Context variables: `$1`, `$ARGUMENTS`, `${CLAUDE_PROJECT_DIR}`, `${CLAUDE_PLUGIN_ROOT}`
- Dynamic context syntax: `!`` `git status` ``` — injects command output into the prompt
- Numbered workflow sections with mandatory steps
- Mapping tables (e.g. category → artifact IDs)
- Conditional logic ("if X then Y, otherwise Z")
- Examples of expected output
- Calls to `AskUserQuestion` with defined options
- Inline bash code with heredoc (e.g. passing a commit message)
- Absolute paths and glob patterns

**Compress aggressively:**
- Introductory/contextualizing prose ("This command runs...")
- Obvious explanations of trivial steps
- Repetition across sections
- Hedging and fillers

## Optimal structure pattern

```markdown
---
description: <what it does, short>
argument-hint: [optional argument]
allowed-tools: Tool1, Tool2
---

# /plugin:command-name

Target: `$1` if provided, else `$CLAUDE_PROJECT_DIR`.

## 1. <Initial step>

[imperative instruction + bash if needed]

## 2. <Next step>

```bash
<exact command>
```

[what to do with the output]
```

## Dynamic context injection

The `!`` `` pattern is processed when the command is loaded — the result goes into the prompt. Preserve exact:

```markdown
## Current state

- Status: !`git status`
- Diff: !`git diff HEAD`
```

## Invariants — never violate when compressing

- `$1`, `$ARGUMENTS`, `${CLAUDE_PROJECT_DIR}`, `${CLAUDE_PLUGIN_ROOT}` — substitution variables; preserve exact
- `!`` `command` `` ` — dynamic context; preserve exact (the triple backtick and the command inside)
- Paths with `"${CLAUDE_PLUGIN_ROOT}/..."` — double quotes and interpolation are required for paths with spaces
- `AskUserQuestion` options — each option defines a flow path; removing one breaks the command
- `allowed-tools: Bash(pattern)` — the pattern restricts which bash commands are allowed; do not simplify to `Bash`
- Any markdown table mapping IDs/categories — these are structural lookups for the command
