## Sanitation (mandatory when index is large)

Before writing a new memory entry, count the non-blank lines in `.claude/memory/MEMORY.md`.
If ≥ 130 lines, run sanitation first.

This project has an Obsidian vault for long-term memory (see `.claude/rules/obsidian.md`).
A memory entry that no longer earns its place in the always-loaded index is never just
discarded — it migrates there, where there is no size limit. Only `.claude/memory/`
itself has to stay small.

1. Read every file in `.claude/memory/` and score each entry: **recency ×
   specificity × likelihood of preventing a real future mistake**.
2. For each low-score entry, migrate it before deleting anything — in this
   exact order, never skipping or reordering a step:
   1. **Dedup** — `mcp__obsidian__search_notes_tool` with one specific term
      from the entry. A note on the same topic already exists → extend it
      with `mcp__obsidian__edit_note_section_tool` instead of creating a
      duplicate.
   2. **Contract** — `mcp__obsidian__get_note_template_tool` for the target
      folder below returns the required headings and frontmatter. Match it
      exactly; the server rejects a note that doesn't.
   3. **Create** — `mcp__obsidian__create_note_tool`, kebab-case filename, in
      the folder matching the entry's type:

      | Memory type | Vault folder |
      |---|---|
      | `architecture`, `feedback` | `03-knowledge/` |
      | `business-rule` | `03-knowledge/` (a topic subfolder if the vault already has one) |
      | `reference` | `04-resources/` |

   4. **Confirm** — `mcp__obsidian__read_note_tool` on the path just
      created. No successful read means the migration did not happen.
   5. **Only then** delete `.claude/memory/<file>.md` and its line in
      `MEMORY.md`.
3. Rewrite the `MEMORY.md` index with only what's left (target: ≤ 130
   lines).
4. Then write the new memory.

Deleting a memory file before step 2.4 confirms the read is forbidden — an
unconfirmed migration is data loss, not a move. Unsure whether an entry
still earns its place? Leave it in `.claude/memory/` — migrating later
costs nothing; a lesson lost from both places is expensive to relearn.
