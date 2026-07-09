# graphify

- **graphify** (`.claude/skills/graphify/SKILL.md`) - any input to knowledge graph. Trigger: `/graphify`

When the user types `/graphify`, invoke the Skill tool with `skill: "graphify"` before doing anything else.

# uncle-bob-craft

- **uncle-bob-craft** (`.claude/skills/uncle-bob-craft/SKILL.md`) - Uncle Bob criteria (SOLID, Dependency Rule, code smells) for reviewing or writing this plugin's own code.

When reviewing a diff, PR, or non-trivial implementation in this repo, invoke the Skill tool with `skill: "uncle-bob-craft"` before finishing.

# subagent-driven-development

- **subagent-driven-development** (superpowers plugin skill) - non-trivial implementation work in this repo. Trigger when the request meets **≥2** of:
  - touches **3+ files** or **2+ domains/layers** (e.g. engine + templates, catalog + generator)
  - is a **new feature / epic / cross-cutting refactor** (not a one-line or single-function change)
  - needs a **multi-step plan** or ordered tasks, each with its own verification
  - has **unclear scope or root cause** and needs exploration before coding

When the request meets ≥2 of those, invoke the Skill tool with `skill: "superpowers:subagent-driven-development"` before implementing. Skip it — implement inline — for typo/copy fixes, single-function edits, config tweaks, or one-file bugs with an obvious cause.
