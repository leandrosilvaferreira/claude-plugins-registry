# graphify
- **graphify** (`.claude/skills/graphify/SKILL.md`) - any input to knowledge graph. Trigger: `/graphify`
When the user types `/graphify`, invoke the Skill tool with `skill: "graphify"` before doing anything else.

# uncle-bob-craft
- **uncle-bob-craft** (`.claude/skills/uncle-bob-craft/SKILL.md`) - Uncle Bob criteria (SOLID, Dependency Rule, code smells) for reviewing or writing this plugin's own code.
When reviewing a diff, PR, or non-trivial implementation in this repo, invoke the Skill tool with `skill: "uncle-bob-craft"` before finishing.
