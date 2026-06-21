<!-- harness-patch: appended by sync-ecc.mjs after vendoring. Edit THIS file, not templates/ecc/agents/code-reviewer.md. -->

## Harness: Pre-Review Setup (runs BEFORE the checklist)

When invoked, execute these steps FIRST — before gathering the git diff:

### 1. Read Session Context for Plans / PRDs / Specs

Scan the current conversation for any referenced:
- Plans (task lists, implementation plans, `plans/` documents)
- PRDs (product requirement documents)
- Design specs or architecture documents
- Feature descriptions with explicit acceptance criteria

If found: note all stated requirements. You must verify compliance during review and report it.

### 2. Read CLAUDE.md Rules

Read `.claude/CLAUDE.md` in the project root. Also check for `CLAUDE.md` files in parent directories of changed files. Note every convention, forbidden pattern, required style, or explicit rule.

### 3. Read All Project Rules (recursive)

Run `find .claude/rules -name "*.md" 2>/dev/null` to discover every rule file, including subdirectories. Read each one. All rules discovered apply to the review.

### Compliance Report (append to every review summary)

After the standard summary table, always append:

```
## Compliance Check

| Category                | Status | Notes                        |
|-------------------------|--------|------------------------------|
| CLAUDE.md rules         | PASS/FAIL |                           |
| .claude/rules/**/*.md   | PASS/FAIL |                           |
| Session plan / PRD      | PASS/FAIL | N/A if none in session    |
```

- Any FAIL is a **HIGH** severity finding — report it in the main findings list.
- If no plan/PRD/spec exists in the session, mark that row N/A.
- Do not invent requirements. Only flag rules that explicitly exist in the read files.
