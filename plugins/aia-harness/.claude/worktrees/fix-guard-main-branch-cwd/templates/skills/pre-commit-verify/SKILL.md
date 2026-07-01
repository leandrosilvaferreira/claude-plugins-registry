---
name: pre-commit-verify
description: Full verification gate before a commit or PR — typecheck, lint, and tests must all pass. Use before committing, opening a PR, or claiming work complete.
---

# Pre-commit verification

Run, in order, the canonical commands from the root `CLAUDE.md`:

1. **Typecheck / compile** (if the project has one).
2. **Lint.**
3. **Tests.**

Stop at the first failure, report the actual output, and fix it before continuing.
Only report success once every step has passed with output you have seen.

Do not commit on the user's behalf unless they explicitly ask.
