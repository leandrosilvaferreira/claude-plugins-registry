# Frontmatter Compliance — Design Spec

**Date:** 2026-06-21
**Status:** approved

## Problem

Templates distributed to target projects contain non-compliant YAML frontmatter per the Claude Code spec. Two root causes:

1. `lib/ecc/transform.mjs` does not normalize the `tools:` field — ECC agents arrive from upstream with `tools: ["Read", "Grep"]` (YAML flow sequence / JSON array) instead of the required comma-separated scalar `tools: Read, Grep`.
2. Some ag-kit agents have quoted MCP tool names mixed with unquoted standard tools: `tools: Read, "mcp__foo__bar"`.

Without correction, agents in target projects may be misconfigured or ignored by Claude Code.

## Claude Code Frontmatter Spec (source of truth)

| Asset | Required | Optional | Notes |
|-------|----------|----------|-------|
| `agents/*.md` | `name`, `description` | `tools` (CSV, unquoted), `model` | no `tools` = unrestricted; no `model` = inherits caller |
| `skills/*/SKILL.md` | `name`, `description` | `allowed-tools` (CSV, unquoted), `disable-model-invocation` | field is `allowed-tools`, NOT `tools` |
| `commands/*.md` | `description` | `allowed-tools` (CSV, unquoted), `model` | no `name` — filename is command name |
| `rules/*.md` | none | `paths` (YAML block list) | no `paths` = global scope |
| hooks (`.mjs`) | N/A | N/A | no frontmatter |

**Tools field format rules:**
- Comma-separated scalar: `Read, Grep, Glob`
- MCP tools unquoted: `Read, mcp__foo__bar__tool`
- JSON/YAML arrays forbidden: `["Read", "Grep"]`
- Quotes forbidden: `"Read"`, `'Grep'`
- Space-only separation forbidden: `Read Grep Glob`

## Scope

Only `templates/` is addressed. Skipped:
- `skills/` at repo root (plugin-own skills, not distributed)
- `.claude/hooks/` (plugin hooks, `.mjs`, no frontmatter)

## Design: 3 Components

### Component 1 — `lib/validate/frontmatter.mjs` (pure module)

Pure, side-effect-free. Used by script, transforms, apply, hook, and doctor.

```js
/**
 * @typedef {'agent'|'skill'|'command'|'rule'|null} AssetType
 * @typedef {{ valid: boolean, errors: string[], warnings: string[], normalized: string }} ValidationResult
 */

/** Derive asset type from relative path within templates/. */
export function detectAssetType(relPath: string): AssetType

/** Normalize a tools/allowed-tools value to clean CSV. */
export function normalizeToolsValue(value: string): string
// "[\\"Read\\", \\"Grep\\"]" → "Read, Grep"
// 'Read, "mcp__foo"' → "Read, mcp__foo"
// "Read Grep" → "Read, Grep"

/** Validate and normalize frontmatter for a given asset type.
 *  errors: format violations → auto-fixable, applied to `normalized`
 *  warnings: missing optional fields with behavioral impact → NOT auto-applied
 *  valid: false iff errors is non-empty
 */
export function validateFrontmatter(content: string, type: AssetType): ValidationResult
```

**Error conditions (auto-fixed in `normalized`):**
- `tools` or `allowed-tools` value is JSON/YAML array or contains quotes
- `tools` used in skill/command (wrong field name — rename to `allowed-tools`)
- `allowed-tools` used in agent (wrong field name — rename to `tools`)

**Warning conditions (NOT auto-fixed):**
- agent missing `tools` → unrestricted tool access
- agent missing `model` → inherits from caller
- skill missing `allowed-tools` → unrestricted tool access
- rule missing `paths` → global scope

**Unknown fields:** kept as-is, no warning (upstream vendored files may carry extra fields).

Unit test file: `tests/frontmatter-validator.test.mjs`

---

### Component 2 — `scripts/normalize-frontmatter.mjs` (dev tool)

**This script is run by plugin developers, not end users.** Output committed to repo.

```
node scripts/normalize-frontmatter.mjs [options] [dir]

Options:
  --dry-run       Print changes without writing (default if no other flag)
  --fix-format    Auto-fix format errors only (no prompt for warnings)
  --interactive   Prompt developer for each warning file
  --report=FILE   Write warnings report to FILE (default: frontmatter-review.md)
  dir             Target directory (default: templates/)
```

**Output (two phases):**

```
=== AUTO-FIXED (format errors) ===
templates/ecc/agents/python-reviewer.md   tools: JSON array → CSV
templates/ecc/agents/rust-reviewer.md     tools: JSON array → CSV
... (N files)

=== REVIEW NEEDED (missing optional fields) ===
agents without `tools` (unrestricted access):
  templates/ag-kit/agents/documentation-writer.md
  ...

agents without `model` (inherits caller):
  templates/ecc/agents/go-reviewer.md
  ...

skills without `allowed-tools` (unrestricted):
  templates/ag-kit/skills/memory-system/SKILL.md
  ...

rules without `paths` (global scope):
  templates/ecc/rules/01-ddd.md
  ...
```

**`--interactive` mode:** for each warning file, prompts:
```
[agent] templates/ag-kit/agents/documentation-writer.md
  Missing: tools
  Add tools restriction? [enter CSV value or ENTER to skip]:
```

**After running:** developer commits the result. All format errors resolved; warnings resolved or intentionally left open (based on decisions made during `--interactive`).

**Integration into transforms (future-proof):**

`lib/ecc/transform.mjs` — add to `cleanAgentMarkdown()`:
```js
import { normalizeToolsValue } from '../validate/frontmatter.mjs'
// in the frontmatter entries loop:
if (e.key === 'tools') e.value = normalizeToolsValue(e.value)
```

`lib/agkit/transform.mjs` — update `mapAgentTools()`:
- After mapping Antigravity→Claude Code tool names, pass result through `normalizeToolsValue()`
- This handles any quoted MCP tools that may be present

Both changes ensure future `npm run sync:*` does not reintroduce format issues.

---

### Component 3 — PreToolUse hook (plugin-only, not distributed)

File: `.claude/hooks/validate-template-frontmatter.mjs`

Registered in `.claude/settings.json` under `PreToolUse`, matcher `Write|Edit`.

**Logic:**
1. Parse `tool_name` and target path from stdin JSON
2. If path does not start with `templates/` or does not end with `.md` → exit 0 (allow, noop)
3. Detect asset type from path via `detectAssetType(relPath)`
4. Extract content being written:
   - `Write`: use `content` field
   - `Edit`: use `new_string` field (validate the fragment being inserted)
5. Call `validateFrontmatter(content, type)`
6. If no errors and no warnings → exit 0 (allow)
7. If errors present:
   - Return exit 0 with `updatedInput` (content replaced by `normalized`) + `systemMessage` listing what was auto-fixed
8. If warnings only (no errors):
   - Return exit 0 with `systemMessage` listing missing optional fields and their behavioral impact

**Schema compliance (required by CLAUDE.md):**
- Hook test file: `tests/hook-validate-template-frontmatter.test.mjs`
- Must test: no-op path, valid content, auto-fix path, warning-only path
- All outputs validated with `validatePreToolUseOutput` from `lib/validate/hook-schema.mjs`

---

### Component 4 — Safety net in `lib/apply.mjs`

Before writing any `.md` artifact to the target project:

```js
import { detectAssetType, validateFrontmatter } from './validate/frontmatter.mjs'

// inside writeArtifact():
if (destPath.endsWith('.md')) {
  const type = detectAssetType(relativeToTemplates(destPath))
  if (type) {
    const { valid, errors, normalized } = validateFrontmatter(content, type)
    if (!valid) {
      ctx.log.warn(`[frontmatter] ${artifact.id}: auto-fixed ${errors.length} format error(s)`)
      content = normalized
    }
  }
}
```

- Never blocks apply — normalizes silently
- Does NOT act on warnings (developer already resolved those in templates)
- Logs warn so the fix is visible in apply output

---

## File Map

| File | Action |
|------|--------|
| `lib/validate/frontmatter.mjs` | create |
| `lib/validate/index.mjs` | create (barrel: re-exports frontmatter.mjs) |
| `tests/frontmatter-validator.test.mjs` | create |
| `scripts/normalize-frontmatter.mjs` | create |
| `lib/ecc/transform.mjs` | modify — call `normalizeToolsValue` in `cleanAgentMarkdown` |
| `lib/agkit/transform.mjs` | modify — pass MCP tools through `normalizeToolsValue` |
| `lib/apply.mjs` | modify — validator call before write |
| `.claude/hooks/validate-template-frontmatter.mjs` | create |
| `.claude/settings.json` | modify — add PreToolUse entry |
| `tests/hook-validate-template-frontmatter.test.mjs` | create |

---

## Execution Order (dev workflow)

1. Implement `lib/validate/frontmatter.mjs` + tests → `npm test` green
2. Update `lib/ecc/transform.mjs` + `lib/agkit/transform.mjs` — existing transform tests still green
3. Implement `scripts/normalize-frontmatter.mjs`
4. Run `node scripts/normalize-frontmatter.mjs --dry-run` — review output
5. Run `node scripts/normalize-frontmatter.mjs --fix-format` — auto-fix format errors
6. Run `node scripts/normalize-frontmatter.mjs --interactive` — resolve warnings
7. Commit fixed templates
8. Modify `lib/apply.mjs` — add safety net
9. Implement `.claude/hooks/validate-template-frontmatter.mjs` + hook tests
10. Register hook in `.claude/settings.json`
11. `npm test` — all green

---

## Non-Goals

- No interactive decision-making for end users — all decisions made in step 6 above
- No modification of `skills/` at repo root (plugin-own, not distributed)
- No auto-adding missing optional fields without explicit developer decision
- No blocking apply for warnings — warnings are a dev-time concern
