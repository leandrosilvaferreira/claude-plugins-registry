---
name: graphify-skill-vendor-path
description: graphify's SKILL.md vendors to templates/tools/graphify/skills/graphify/, not templates/skills/ — hardcoded special case, no sync script
metadata:
  type: architecture
---

The graphify skill distributed to target projects lives at
`templates/tools/graphify/skills/graphify/` (`SKILL.md` + `.graphify_version` +
`references/*.md`), copied as the `tool-skill:graphify` artifact by a hardcoded
`if (id === "graphify")` block in `lib/plan/vendored-artifacts.mjs`
(`addToolArtifacts`). It does **not** follow the generic
`PROJECT_COMMON.skills` pattern in `lib/data/project-catalog.mjs`, which points
at `templates/skills/<name>/` — that path is for first-party skills only.

There is no sync script for this asset: `graphify` is absent from
`scripts/tools-source.json`, so `npm run sync:tools` never touches it and no
`MANIFEST.json` tracks its provenance/commit. The editable "source of truth" is
this repo's own dogfooded `.claude/skills/graphify/` — when it changes
(version bump, SKILL.md edits, reference doc edits), the vendored copy must be
synced manually: `diff -rq .claude/skills/graphify/ templates/tools/graphify/skills/graphify/`
to spot drift, then `cp` the divergent files over.

`tests/graphify-git-hooks.test.mjs` has unconditional (non-skip) assertions
covering this exact copy (`SKILL.md`, `references/query.md`, `.graphify_version`
must exist under the vendored path) — running that file catches drift or a
missing vendor copy.

**Why:** a request to "vendor the graphify skill into templates" naturally
reads as `templates/skills/graphify/` (matching every other first-party
skill's location) — but the engine already hardcodes the other path, and
`buildPlan` never reads `templates/skills/graphify/` for this tool. Copying to
the intuitive-but-wrong location would produce an artifact `addToolArtifacts`
never picks up.

**How to apply:** before "vendoring the graphify skill," grep
`lib/plan/vendored-artifacts.mjs` for `id === "graphify"` to confirm the
current expected path hasn't moved, then diff source vs. vendored copy rather
than assuming the directory is missing.
