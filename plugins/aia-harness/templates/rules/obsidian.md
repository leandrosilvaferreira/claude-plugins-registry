---
paths:
  - "**/*"
---

# Obsidian vault — MCP-only access

> **Scope: always-on (`paths: ["**/*"]`), not path-scoped like its siblings.** The trigger
> for using the vault is what the *task* is about, not which file is open, so no glob can
> gate it — the same reasoning `vault-orient.mjs` uses to inject its reminder into every
> prompt unconditionally instead of matching a path or a keyword regex. `paths: ["**/*"]`
> is this repo's own idiom for "always relevant" (`.claude/rules/verification.md` and
> `.claude/rules/testing.md` use it too — see `lib/generate/rules.mjs`'s docstring: rules
> "carry `paths:` frontmatter so it is loaded only when relevant files are touched").

Vault: `__OBSIDIAN_VAULT_DIR__/` (versioned in git, PARA-structured), served by the `obsidian` MCP
server declared in `.mcp.json`. It is this project's long-term memory — it does not
replace `graphify`/`Grep` over code, and it does not replace authoritative in-repo docs
(README, `docs/`, `CLAUDE.md`); it covers what neither can tell you: why a decision was
made, what was already tried and failed, conventions that span modules.

## Rule Zero — MCP tools only, never direct file access

Vault files are reached **only** through `mcp__obsidian__*` tools — never `Read`, `Write`,
`Edit`, `MultiEdit`, `NotebookEdit`, `Grep`, `Glob`, `Bash`, or `PowerShell` on anything under
`__OBSIDIAN_VAULT_DIR__/`. Direct access bypasses the server's template, wikilink, and slug
enforcement (below); a hand-written note silently violates all three and only fails later,
at some unrelated write.

This is enforced mechanically, not just by convention — but the guarantee differs by tool,
so state it precisely rather than overclaim it. `.claude/hooks/vault-guard.mjs`
(`PreToolUse`, matcher `Read|Grep|Glob|Write|Edit|MultiEdit|NotebookEdit|Bash|PowerShell`) denies any
call whose **structured path field** (`file_path`, `path`, `pattern`, `glob`,
`notebook_path`) contains a `__OBSIDIAN_VAULT_DIR__/` segment, naming the MCP tool to use instead.
For those file tools this is a hard boundary keyed on path, not intent — there is no
field-level escape hatch. Shell tools (`Bash`, `PowerShell`) are different: they have no structured path field, so the hook
falls back to a plain substring check on the command string. That catches the accidental and
casual case (`cat >> __OBSIDIAN_VAULT_DIR__/daily/x.md`) but is **not** a security boundary —
variable indirection, base64/encoding, or `cd __OBSIDIAN_VAULT_DIR__ && cat >> x.md` all slip past a
string match; a determined bypass through a shell is not prevented. A genuine need for direct
access to a file-tool path means unwiring the hook, not finding a way around it here.

## Tools by job

All search is full-text, not semantic. The server ships 30 tools; grouped by job below.
Re-confirm names and defaults against `mcp__obsidian__help_tool` (env catalog + one-line
tool index, reports live) if anything here ever looks stale.

**Search / locate**
- `search_notes_tool` — filename + content, ranked (filename matches score higher). Query
  prefixes: `tag:x` (hierarchical), `path:x` (filename only), `property:name:value`. Covers
  most cases alone. Params: `context_length` (default 20), `max_results` (default 50),
  `mode` (see Anti-overflow).
- `search_by_regex_tool` — regex when a keyword isn't enough. Same levers, plus `flags`.
- `search_by_date_tool` — `created`/`modified`, `days_ago`, `within`/`exactly`.
- `search_by_property_tool` — frontmatter filters (`=`, `!=`, `>`, `<`, `contains`, `exists`).
- `list_notes_tool` / `list_folders_tool` — enumerate one folder or the vault. Narrow use
  only ("does this folder exist") — **never enumerate the vault as a substitute for
  search**; `search_notes_tool` is the discovery tool.

**Read**
- `read_note_tool` — full note + metadata. Read before `update_note_tool` unless you're
  doing a pure append, to avoid clobbering existing content.
- `get_note_info_tool` — metadata/stats (size, word/link count) **without** content. Check
  size with this before `read_note_tool` on a note you suspect is large.
- `get_note_template_tool` — the enforced headings/frontmatter for a folder. Call before
  creating/updating a note in a template-mapped folder, or after a conformance error, for
  the exact skeleton.
- `read_image_tool` / `view_note_images_tool` — a standalone image file vs. images embedded
  in a note.

**Write** — the expensive-to-learn traps live in the next section.
- `create_note_tool` — new note (`overwrite` defaults `false`).
- `update_note_tool` — ⚠️ replaces the whole note by default.
- `edit_note_section_tool` — ⚠️ edits one section by heading; first duplicate wins.
- `add_daily_note_tool` — ⚠️ always appends at the end of the file.
- `batch_update_properties_tool` — bulk frontmatter changes (add/remove properties, add/
  remove tags) across notes matched by search query, folder, or an explicit file list.
  Frontmatter only unless `remove_inline_tags: true`, which also strips matching `#tags`
  from note bodies.

**Links / graph** — use these, never grep the vault for `[[...]]`
- `get_backlinks_tool` — who links here (`include_context` defaults `true`).
- `get_outgoing_links_tool` — links from this note; `check_validity: true` flags targets
  that don't actually exist.
- `find_broken_links_tool` — vault-wide, one directory, or one note.
- `find_orphaned_notes_tool` — `orphan_type`: `no_backlinks` (default) / `no_links` /
  `no_tags` / `no_metadata` / `isolated`. Excludes `templates/`, `daily/`, and any archive
  folder by default.

**Tags**
- `list_tags_tool` — taxonomy + usage counts. Check before tagging, for consistency.
- `add_tags_tool` / `update_tags_tool` / `remove_tags_tool` — frontmatter only, never
  rewrite the note body. Search by tag with `search_notes_tool`'s `tag:` prefix.

**Structure / refactor**
- `rename_note_tool` — same-directory only; updates every `[[wikilink]]` to the note.
- `move_note_tool` — cross-folder (+ optional rename); link rewriting only kicks in when
  the filename actually changes.
- `create_folder_tool` — creates every parent folder in the path automatically.
- `move_folder_tool` — moves a folder and everything under it.
- `delete_note_tool` — permanent, no undo. Prefer moving into an archive location.

Never rename or move a note by hand-editing its path — these tools rewrite every
`[[wikilink]]` that points at it; a manual rename silently breaks all of them.

## Write-tool traps

- **`update_note_tool` replaces the whole note by default.** Pass
  `merge_strategy="append"` to add to the end instead; anything short of a full rewrite
  needs `read_note_tool` first, then a full replace.
- **`update_note_tool` requires `name` in frontmatter, even though `get_note_template_tool`
  explicitly says never to supply it.** That tool's `instructions` field reads "`name` is
  auto-injected from the filename — never supply it yourself"; auto-injection happens on
  `create_note_tool` only. A `update_note_tool` full replace is rejected with
  `Missing frontmatter keys: ['name']` until `name` is passed explicitly, set to the
  filename without its `.md`. Trust the enforcement table above (`name` must match the
  filename) over the template tool's instruction — five independent agents hit this on five
  different notes in one pass, so it is the server's real behaviour, not a fluke.
- **`edit_note_section_tool` matches the *first* occurrence of a duplicated heading**, with
  no parent-hierarchy disambiguation — two sections sharing a heading (e.g. two
  `## Related` in one note) means it edits the first one in file order, regardless of which
  parent section you meant. Match is case-insensitive; `operation` defaults `insert_after`
  (also: `insert_before`, `replace`, `append_to_section`); `create_if_missing` defaults
  `false`.
- **`add_daily_note_tool` always appends at the very end of the file**, after the last
  section — it does not insert into a named section, even when the content clearly belongs
  under e.g. `## Decisions`. Anything that must land in a specific section needs
  `edit_note_section_tool` instead (read the note first to confirm the heading exists).
- **`create_note_tool` defaults `overwrite: false`** — it will not clobber an existing note
  unless `overwrite: true` is passed explicitly.

## Server-side enforcement (this vault's live config)

The server validates before writing; a rejected write comes back as a `ToolError` naming
what's wrong. Values below are this vault's current configuration — these are per-project
env vars, so re-confirm with `mcp__obsidian__help_tool` rather than trusting this table
blindly in a different project.

| Control | This vault's value | Effect |
|---|---|---|
| `OBSIDIAN_REQUIRE_FRONTMATTER` | `true` | `create_note_tool` and `update_note_tool` (replace, or append with `create_if_not_exists`) require frontmatter `name` to match the filename and a non-empty `description`, or the write is rejected. Exempt: `edit_note_section_tool`, `update_note_tool` append, and `add_daily_note_tool`'s own file-creation path (it seeds `name`/`description` itself). |
| `OBSIDIAN_FOLDER_TEMPLATES` | maps `01-projects`, `02-areas`, `03-knowledge`, `04-resources`, `daily` to a template each | A mapped folder's `create_note`/`update_note`(replace) must include that template's required headings, in the same relative order (extra headings allowed anywhere). Confirm the exact skeleton with `get_note_template_tool` rather than hardcoding it. |
| `OBSIDIAN_WIKILINK_POLICY` | `strict` | A `[[wikilink]]` to a note that doesn't exist is a hard `ToolError` with suggestions, not a warning. Only link notes confirmed to exist. |
| `OBSIDIAN_SLUG_STYLE` | `kebab` | Filenames and frontmatter `name` are transliterated to ASCII kebab-case (accents stripped). Also affects link resolution: a non-slugified wikilink target resolves against an existing note's kebab form and gets rewritten to the real filename. |
| `OBSIDIAN_TAG_STYLE` | `kebab` | Tags are normalized lower-case, ASCII, hyphen-separated per `/`-hierarchy segment. |
| `OBSIDIAN_MAX_NOTE_LINES` / `OBSIDIAN_APPEND_HEADROOM_LINES` | `500` / `100` | Line-count ceiling per note on a full write; incremental writes (append, `edit_note_section_tool`) are checked against 400 (500 − 100) so they get flagged before a later one would blow past the hard ceiling. Notes under `daily/` are always exempt. |
| `OBSIDIAN_NOTE_SIZE_POLICY` | `warn` | An oversized note **is written anyway**, with a warning returned — this vault does not currently block on note size. |
| `OBSIDIAN_SEARCH_RESULT_MODE` / `OBSIDIAN_SEARCH_INDEX_THRESHOLD` | `auto` / `10` | Results switch from content snippets to a compact index shape (`path`/`name`/`description`/`score`, no snippet) once a result count passes 10. See Anti-overflow. |

## Anti-overflow

1. `context_length` (default 20) and `max_results` (default 50) are the two levers on every
   search tool — lower them first if a result is still too large.
2. One specific composite term beats a generic one (`"withdraw-status-flow"`, not
   `"status"`) — fewer, more relevant hits, more likely to land under the index threshold
   and get content snippets back directly.
3. Before `read_note_tool` on a note you suspect is large, check it with
   `get_note_info_tool` first — metadata and size, no content downloaded.
4. Overflow that persists after narrowing the term a couple of times: don't work around it
   by reading in chunks — ask the user instead.

## Automated writers — where notes come from without you touching them

Two hooks write to the vault on their own schedule; know they exist so you don't duplicate
what they already do:

- **`.claude/hooks/session-log.mjs`** (`SessionEnd`) — cheaply gates on whether the session
  had enough substantive turns, then spawns a detached worker that calls
  `add_daily_note_tool` once with a `## Session — HH:MM` block (What I did / Decisions /
  Problems / Ideas, whichever have content).
- **`.claude/hooks/compile.mjs`** (`SessionStart`) — promotes **every** daily
  note older than today that has not yet been compiled, oldest first, one LLM
  sub-session each. Today's note is never eligible: `session-log-runner.mjs`
  is still appending to it. Idempotent by content hash, so an unchanged note
  is never recompiled.

A daily note is **deleted** once the compile sub-agent reaches a terminal
conclusion about it — including a deliberate "nothing here worth promoting"
and a run where every write it attempted was rejected. The raw log is not
kept. If this vault is gitignored, that deletion is unrecoverable; commit
the vault, or back it up, if you want the raw daily log to survive its
promotion.

The compile also **rewrites the notes it just wrote to**, deterministically
and only those: any `[[wikilink]]` whose target does not exist is turned into
plain text (the vault's wikilink policy is strict, so a broken link is a hard
error), and two or more `## Related` sections are merged into a single one at
the end of the note. Both edits touch notes you may have authored by hand, so
expect a note the pipeline appended to to come back tidied, not byte-identical.

Both hooks spawn their detached worker via `@anthropic-ai/claude-agent-sdk`, which must be
resolvable from this project (e.g. `npm install @anthropic-ai/claude-agent-sdk`) — without
it, the worker fails silently and the write never happens.

Because routine session logging is automatic, call `add_daily_note_tool` /
`create_note_tool` / `update_note_tool` yourself only when the user explicitly asks you to
record something right now, or an existing note needs a correction outside that cycle.

## When to search — mandatory triggers

Read together with `vault-orient.mjs`'s injected reminder (fires on every prompt when the
vault exists) — this table operationalizes it, it doesn't add conditions beyond it:

| Situation | Action |
|---|---|
| Task touches a past decision, a failed approach, or a convention spanning modules | `search_notes_tool` before answering |
| Resuming work from an earlier session | `search_notes_tool` before answering |
| About to create a note | Search its title first — update the existing note, never duplicate |
| "What links to / references X?" | `get_backlinks_tool` / `get_outgoing_links_tool` — never grep the vault |
| Renaming or moving a note | `rename_note_tool` / `move_note_tool` — never hand-edit and leave links stale |
| Vault maintenance (broken links, orphaned notes) | `find_broken_links_tool` / `find_orphaned_notes_tool` — propose changes, never auto-delete |
| Routine "what happened this session" logging | Nothing — automatic (see Automated writers) |

## Structure

PARA folders, each mapped to a template (see the enforcement table above) —
`get_note_template_tool` is the source of truth for what belongs where; this is the short
version:

- `01-projects/` — active project work with an end state.
- `02-areas/` — ongoing responsibilities with no end date.
- `03-knowledge/` — consolidated, reusable lessons. Populated by the promote pipeline
  above; also fine to write to directly for something worth keeping now.
- `04-resources/` — reference material.
- `daily/` — per-session log. Populated by the pipeline above.
- `templates/` — the templates the server enforces against. Read-only by convention (not
  server-enforced) — don't write notes here.

Never create a note directly at the vault root — go through the mapped folder so the right
template applies.

Note conventions: kebab-case filenames (enforced via `OBSIDIAN_SLUG_STYLE`); `[[wikilinks]]`
to connect related notes (must resolve — `OBSIDIAN_WIKILINK_POLICY` is `strict`);
`## Related` is the last required heading in every folder template — keep it last in
practice too; one fact per note, well under the 500-line ceiling.
