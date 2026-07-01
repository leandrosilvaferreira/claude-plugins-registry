# Design: validate-settings-schema hook

**Date:** 2026-06-27
**Status:** Approved

## Summary

A `PostToolUse` hook that validates `.claude/settings.json` and `.claude/settings.local.json`
against the official Claude Code JSON Schema from SchemaStore whenever those files are written
or edited. When errors are found, the hook exits with code 2 and a structured stderr message
that instructs Claude to present the errors to the user and ask for confirmation before fixing.

## Goals

- Catch settings.json schema violations immediately after any write/edit
- Fetch the live schema from SchemaStore (always current, no manual sync)
- Cache schema locally for 24h to avoid per-edit network calls
- Fail-open on every infrastructure error (network, cache, parse)
- Distribute to all target projects via the existing `PROJECT_HOOK_FILES` mechanism
- Also wire into aia-harness itself for development

## Non-goals

- Auto-fixing without user confirmation
- Full JSON Schema spec compliance (anyOf/oneOf/allOf handled partially)
- Validating files outside `.claude/settings.json` and `.claude/settings.local.json`

---

## Architecture

### Trigger

**Event:** `PostToolUse`
**Matcher:** `Edit|Write|MultiEdit`

Fires after the tool completes, so the file on disk already reflects the new content.

### File locations

| Path | Purpose |
|---|---|
| `templates/hooks/validate-settings-schema.mjs` | Distributed to target projects |
| `.claude/hooks/validate-settings-schema.mjs` | Wired for aia-harness development |

### Logic flow

```
stdin (PostToolUse event)
  │
  ├─ tool_name ∉ {Write, Edit, MultiEdit}? → exit 0 (silent)
  ├─ file_path missing or not a string (ti.file_path || ti.path)? → exit 0
  ├─ path.basename(file) ∉ {settings.json, settings.local.json}? → exit 0
  ├─ path.basename(path.dirname(file)) ≠ ".claude"? → exit 0
  ├─ file does not exist on disk? → exit 0 (fail-open)
  ├─ JSON parse error? → exit 2 (syntax error message)
  ├─ schema fetch fails? → exit 0 (fail-open)
  ├─ validation passes? → exit 0 (silent)
  └─ validation fails → exit 2 (structured errors + instruction to ask user)
```

---

## Schema fetch and cache

**URL:** `https://www.schemastore.org/claude-code-settings.json`
**Cache file:** `path.join(os.tmpdir(), 'aia-validate-settings-schema.json')`
**TTL:** 24 hours
**Cache format:** `{ schema: {...}, fetchedAt: <unix ms> }`
**Fetch timeout:** 8 seconds via `AbortSignal.timeout(8000)`

Fail-open conditions (all return `null`, hook exits 0):
- Cache file unreadable or malformed
- Network unreachable or fetch timeout
- HTTP response not OK
- Schema body not valid JSON
- `fs.writeFileSync` on cache fails (non-fatal; schema still used for current run)

```js
async function loadSchema() {
  // 1. Try cache
  try {
    const { schema, fetchedAt } = JSON.parse(fs.readFileSync(CACHE_FILE, 'utf8'))
    if (Date.now() - fetchedAt < TTL_MS) return schema
  } catch { /* cache miss or stale */ }

  // 2. Fetch
  try {
    const res = await fetch(SCHEMA_URL, { signal: AbortSignal.timeout(8000) })
    if (!res.ok) return null
    const schema = await res.json()
    try { fs.writeFileSync(CACHE_FILE, JSON.stringify({ schema, fetchedAt: Date.now() })) }
    catch { /* non-fatal */ }
    return schema
  } catch { return null }
}
```

---

## Validation engine

Minimal recursive JSON Schema validator in pure Node built-ins (~200 lines).
No external dependencies — runs in any `.claude/hooks/` context without `node_modules`.

### Supported keywords

| Keyword | Behavior |
|---|---|
| `type` | string / object / array / boolean / number / integer / null |
| `properties` | recurse each property |
| `additionalProperties` | report unknown keys when `false` |
| `required` | report missing required keys |
| `items` | validate each array element against item schema |
| `enum` | value must be one of the listed values |
| `pattern` | value must match regex |
| `const` | value must equal const |
| `minimum` / `maximum` | numeric range |
| `minLength` / `maxLength` | string length |
| `$ref` | resolve `#/definitions/...` within same schema document |
| `anyOf` / `oneOf` / `allOf` | partial: error only if ALL branches fail; otherwise pass |

Unknown keywords are silently ignored (fail-open).

### Error format

Each error is a `{ path: string, message: string }` object.
Path uses JSON Pointer notation (e.g., `/hooks/PostToolUse/0/command`).

---

## Stderr output format (exit 2)

```
[settings-schema-validator] 2 erro(s) de validação em .claude/settings.json:

  1. /hooks/PostToolUse/0/command — tipo inválido: esperado "string", encontrado object
  2. /permissions/allow/3 — não corresponde ao padrão esperado

Por favor, apresente os erros acima ao usuário, explique como corrigir cada um,
e pergunte: "Encontrei 2 erro(s) no .claude/settings.json. Deseja que eu corrija?"
Se o usuário confirmar, aplique as correções.
```

The final paragraph is an explicit instruction to Claude to ask the user before acting.
Without it, Claude might auto-fix without confirmation.

### JSON parse error format (exit 2)

```
[settings-schema-validator] .claude/settings.json contém JSON inválido:

  SyntaxError: Unexpected token } in JSON at position 142

Corrija a sintaxe do arquivo antes de continuar.
```

---

## Catalog registration

### `lib/data/project-catalog.mjs` — `PROJECT_HOOK_FILES`

```js
export const PROJECT_HOOK_FILES = [
  // ... existing entries ...
  "validate-settings-schema.mjs", // ← add
]
```

### `lib/generate/settings.mjs` — `renderSettings()`

Add to the existing `PostToolUse[0].hooks` array (matcher `Edit|Write|MultiEdit`):

```js
PostToolUse: [
  {
    matcher: "Edit|Write|MultiEdit",
    hooks: [
      { type: "command", ...hookCmd("format-on-edit.mjs"), timeout: 60 },
      { type: "command", ...hookCmd("set-files-changed.mjs"), timeout: 30 },
      { type: "command", ...hookCmd("sql-idempotent-review.mjs"), timeout: 10 },
      { type: "command", ...hookCmd("validate-settings-schema.mjs"), timeout: 30 }, // ← add
    ],
  },
],
```

Timeout 30s accommodates first-run schema fetch over slow connections.
Subsequent runs use the disk cache and complete in <100ms.

### `.claude/settings.json` (aia-harness dev)

Same wiring added to the existing `PostToolUse / Edit|Write|MultiEdit` group:

```json
{ "type": "command", "command": "node",
  "args": ["${CLAUDE_PROJECT_DIR}/.claude/hooks/validate-settings-schema.mjs"],
  "timeout": 30 }
```

---

## Unit tests — `tests/hook-validate-settings-schema.test.mjs`

All branches tested. Every output validated via `validatePostToolUseOutput` from
`lib/validate/hook-schema.mjs` (required by CLAUDE.md for all distributed hooks).

| # | Scenario | Expected |
|---|---|---|
| 1 | Tool name is `Bash` | exit 0, no output |
| 2 | Tool is `Write` but path is `src/index.ts` | exit 0, no output |
| 3 | Tool is `Edit` on `.claude/settings.json`, file missing from disk | exit 0, no output |
| 4 | Tool is `Write` on `.claude/settings.json`, file has invalid JSON | exit 2, stderr contains parse error |
| 5 | Tool is `Write` on `.claude/settings.json`, schema fetch throws | exit 0, no output |
| 6 | Tool is `Write` on `.claude/settings.json`, JSON valid against schema | exit 0, no output |
| 7 | Tool is `Edit` on `.claude/settings.json`, JSON fails schema | exit 2, stderr contains error list + instruction |
| 8 | Tool is `Write` on `.claude/settings.local.json`, JSON fails schema | exit 2 (same behavior) |
| 9 | Cache file is fresh (< 24h) | schema loaded from cache, no network call |
| 10 | Cache file is stale (> 24h) | fetch called, cache updated |
| 11 | `stdin` is empty / malformed | exit 0 (fail-open) |

Tests mock `fetch` and filesystem reads via module-level injection or temp files.
No real HTTP calls in test suite.

---

## Cross-platform compliance

Follows all rules from `.claude/rules/hooks-cross-platform.md`:

- `.mjs` ESM, exec form `node` + `args`
- `os.tmpdir()` for cache path (no hardcoded `/tmp`)
- `path.join()` for all path construction
- No shell form, no `jq`, no `bash`
- `windowsHide: true` on any `spawn`/`exec` (none needed — pure Node APIs only)
- Wired via `${CLAUDE_PROJECT_DIR}/.claude/hooks/validate-settings-schema.mjs`

---

## File change summary

| File | Change |
|---|---|
| `templates/hooks/validate-settings-schema.mjs` | **new** — the hook |
| `.claude/hooks/validate-settings-schema.mjs` | **new** — copy for aia-harness dev |
| `lib/data/project-catalog.mjs` | add `"validate-settings-schema.mjs"` to `PROJECT_HOOK_FILES` |
| `lib/generate/settings.mjs` | add hook entry to `PostToolUse[0].hooks` |
| `.claude/settings.json` | add hook entry to `PostToolUse / Edit\|Write\|MultiEdit` |
| `tests/hook-validate-settings-schema.test.mjs` | **new** — 11 test branches |
