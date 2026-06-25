# Best Practices — Rules (`.claude/rules/<name>.md`)

> Reference for compressing rule files. Rules are instructions that load conditionally (with `paths:`) or unconditionally (without `paths:`). The context cost of global rules is paid IN EVERY session — compression is critical here.

## Frontmatter fields

| Field | Required | Compression: rule |
|-------|----------|-------------------|
| `paths` | no | **PRESERVE EXACT** — governs scope; removing it turns a scoped rule into a global one (loaded every session) |
| `description` | no | Compress if present — it is not a discovery field like in skills/agents |

**Rules without `paths`:** load unconditionally for every session. High cost — compress the body aggressively.
**Rules with `paths`:** load only when Claude works with files matching the globs. Compress the body but NEVER touch `paths`.

## Valid `paths` structure

```yaml
# YAML list (correct):
---
paths:
  - "src/api/**/*.ts"
  - "**/*.test.ts"
---

# CSV string (also valid):
---
paths: "src/api/**/*.ts", "**/*.test.ts"
---
```

Preserve the original format (list or string) when compressing.

## Compressing the body

Rules are the type with the highest compression payoff — every token saved is repeated in every session that loads them.

**Compress aggressively:**
- Introductory/contextual prose
- Explanations of why the rules exist (relevant for CLAUDE.md, not for rules)
- Repetition across items in a list
- Hedging ("It is recommended that you...", "Please make sure to...")
- Any text that is not the rule itself

**Mandatory to preserve:**
- The concrete imperatives: "Always X", "Never Y", "When Z do W"
- Numeric thresholds: "max 350 lines", "≥ 2 reviewers"
- Specific tool names, commands, file patterns
- Concrete examples that define correct vs wrong behavior
- Any explicit negation ("NEVER", "must not", "forbidden")
- Enumerations of valid/invalid values
- Code blocks with mandatory patterns

## Optimal structure pattern

Rules should be short and imperative. The ideal is a list of direct bullets:

```markdown
---
paths:
  - "src/api/**/*.ts"
---

# API Rules

- All endpoints require input validation with Zod
- Use standard error format: `{ error: string, code: string }`
- Include OpenAPI `@tags` comment above each handler
- Never expose internal stack traces to API responses
- Rate limit all public endpoints (max 100 req/min)
```

**BAD (verbose):**
```markdown
When you are working on API files, please make sure that you validate all inputs
that come into the endpoints. This is important for security. You should also use
our standard error format which we have defined to ensure consistency across the
API surface...
```

**GOOD (imperative):**
```markdown
- Validate all endpoint inputs
- Standard error format: `{ error: string, code: string }`
```

## Correct scope: rule vs CLAUDE.md vs skill

| Content | Where to put it |
|----------|--------------|
| Convention specific to a file type | `rules/*.md` with `paths:` |
| Cross-cutting convention with no scope | `rules/*.md` without `paths:` |
| Reusable procedure/workflow | skill |
| Fact about the project/architecture | `CLAUDE.md` |
| Long instruction with many details | skill (lazy-load) |

When compressing: if a rule body is too large (>50 lines), point out to the user that it may be better as a skill (lazy-load) instead of a rule (unconditional load).

## Invariants — never violate when compressing

- `paths:` with any value — removing it turns the rule global; preserve exact
- Explicit negations (NEVER/never/must not/forbidden) — preserve in full
- Numeric thresholds — compress the surrounding prose but keep the number and unit
- Code blocks — preserve byte for byte
- Specific tool/command/file names referenced as a mandatory pattern

## Context cost alert

Global rules (no `paths`) are loaded in EVERY project session. A 500-token rule costs 500 tokens × N sessions per day × M developers. Compressing global rules is the highest ROI of the entire condensation.

When condensing: prioritize maximum aggressiveness on global rules; accept small losses of narrative prose as long as the imperative is preserved.
