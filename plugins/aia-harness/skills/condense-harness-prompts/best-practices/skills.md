# Best Practices — Skills (`.claude/skills/<name>/SKILL.md`)

> Reference for compressing skill files. Skills use `allowed-tools` (NOT `tools`). The `description` governs automatic discovery — preserve all triggers.

## Frontmatter fields

| Field | Required | Compression: rule |
|-------|----------|-------------------|
| `name` | recommended | Preserve exact — invocation name `/name`; max 64 chars, lowercase+hyphens |
| `description` | recommended | Compress prose BUT preserve ALL discovery triggers (see below) |
| `allowed-tools` | no | Preserve exact — tool allowlist; `Bash(pattern)` for restricted bash |
| `disable-model-invocation` | no | Preserve exact — `true` blocks automatic invocation (user only) |
| `argument-hint` | no | Preserve exact — autocomplete hint, e.g. `<branch-or-path>` |
| `paths` | no | Preserve exact — glob patterns for automatic per-file activation |
| `model` | no | Preserve exact — model override for this skill |

**Note:** Skills use `allowed-tools`, not `tools`. If you find `tools` in a skill, it is a frontmatter error (the validator fixes it, not the compressor).

## Compressing `description`

The `description` governs both autocomplete and automatic discovery by Claude. Condense prose but **mandatory to preserve**:

- "Use when..." patterns — these are the automatic activation triggers
- Specific keywords Claude uses for matching (tool names, formats, extensions)
- Concrete usage contexts/scenarios
- Specific action verbs ("analyzes", "generates", "extracts")

**Compress:** articles, generic introductory phrases, hedging, repetitions of the skill name

```yaml
# BAD (verbose, implicit triggers):
description: This skill helps you work with PDF files. It can extract text from PDFs, fill out forms, and merge multiple PDF documents together. You can use it whenever you need to do anything with PDF files.

# GOOD (third person, explicit triggers):
description: Extracts text/tables from PDFs, fills forms, merges documents. Use when working with PDF files or user mentions PDFs, forms, document extraction.
```

**Critical rule:** Description is injected into the discovery system prompt. Never use first/second person ("I can", "you can") — always third person.

## Compressing the body (SKILL.md body)

The body loads only when the skill is invoked (not at startup) — but once loaded, it competes with the entire context.

**Condensation target:** body under 500 lines for optimal performance.

**Compress aggressively:**
- Introductory/contextual prose Claude already knows
- Obvious explanations of well-known concepts
- Repetition across sections
- Hedging and fillers

**Mandatory to preserve:**
- Every numbered workflow step
- Code blocks (byte for byte)
- Bash commands with exact flags
- Referenced paths and file names
- Numeric thresholds and conditions ("max 1-2 rounds", ">350 lines")
- Links to reference files (`[FORMS.md](FORMS.md)`) — they are the progressive-disclosure mechanism
- Explicit prohibitions and hard rules
- Concrete input/output examples

## Optimal structure pattern

```markdown
# Skill Name

## Quick start / Workflow (mandatory)
[numbered imperative steps]

## Edge cases / Variants
[links to external files when detailed]

## Notes
[hard rules, invariants]
```

**Progressive disclosure:** When condensing, check whether there is content that could be moved into referenced external files (one level of depth only). Second-level references (a file pointing to another file) should be identified and reported to the user as an opportunity.

## Invariants — never violate when compressing

- `name`: max 64 chars, lowercase+numbers+hyphens, no XML tags, no "anthropic"/"claude"
- `description`: max 1024 chars, non-empty, no XML tags
- `allowed-tools` with `Bash(pattern)` — the pattern is the restriction; do not simplify to `Bash`
- `paths` with globs — the patterns are the activation scope; do not remove
- `disable-model-invocation: true` — deleting it removes invocation control
- Links to reference files (`[file.md](file.md)`) — they are the lazy-loading mechanism; preserve exact
- Wikilinks `[[...]]` — preserve exact

## Quality signal after compression

After compressing, check: can the compressor figure out when to invoke this skill by reading only the `description`? If yes, the description is correct. If not, the triggers were lost.
