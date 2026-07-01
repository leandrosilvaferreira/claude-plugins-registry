---
name: lint-fix
description: Lint and format the codebase, then fix the issues found. Use when asked to lint, format, clean up style, or resolve linter/formatter errors.
---

# Lint & fix

1. Find the canonical **lint** and **format** commands in the root `CLAUDE.md` (or `.claude/rules/`).
2. Run the formatter first, then the linter.
3. Fix remaining lint errors by editing the code — do not silence rules unless the user asks.
4. Re-run the linter to confirm it is clean. Report the final status.

Keep changes minimal and scoped to the lint/format issues; do not refactor unrelated code.
