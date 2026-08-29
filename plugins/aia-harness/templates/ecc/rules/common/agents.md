<!-- Vendored from ECC (github.com/affaan-m/ECC) @ ceca28852e5b31edbbf66ebccc8fd163dd14208e :: rules/common/agents.md. MIT (c) Affaan Mustafa. -->

> **Note on agent names below:** ECC's stack-specific reviewer/build-resolver agents (e.g. `typescript-reviewer`, `go-reviewer`, `rust-reviewer`) are only installed when your project's detected stack matches — check `.claude/agents/` for what is actually present before assuming one of these ran. `code-reviewer` and `security-reviewer` are installed for every project.

# Agent Orchestration

## Available Agents

Located in `~/.claude/agents/`:

| Agent | Purpose | When to Use |
|-------|---------|-------------|
| code-reviewer | Code review | After writing code |
| security-reviewer | Security analysis | Before commits |
| rust-reviewer | Rust code review | Rust projects |

## Immediate Agent Usage

No user prompt needed:
1. Complex feature requests - Use an appropriate specialist agent (check `.claude/agents/`)
2. Code just written/modified - Use **code-reviewer** agent
3. Bug fix or new feature - Use an appropriate specialist agent (check `.claude/agents/`)
4. Architectural decision - Use an appropriate specialist agent (check `.claude/agents/`)

## Parallel Task Execution

ALWAYS use parallel Task execution for independent operations:

```markdown
# GOOD: Parallel execution
Launch 3 agents in parallel:
1. Agent 1: Security analysis of auth module
2. Agent 2: Performance review of cache system
3. Agent 3: Type checking of utilities

# BAD: Sequential when unnecessary
First agent 1, then agent 2, then agent 3
```

## Multi-Perspective Analysis

For complex problems, use split role sub-agents:
- Factual reviewer
- Senior engineer
- Security expert
- Consistency reviewer
- Redundancy checker
