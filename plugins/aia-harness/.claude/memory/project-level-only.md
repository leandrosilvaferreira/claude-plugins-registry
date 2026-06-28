---
name: project-level-only
description: "User wants tools/config installed project-level (.claude/), never global/user"
metadata: 
  node_type: memory
  type: feedback
  originSessionId: 771f2bf6-1cc4-4795-a542-72b4f587e30d
---

For the aia-harness work, the user requires all tooling/config to be installed at
**project level** (inside the repo's `.claude/`), **never** global / user scope
(`~/.claude`). Install should be **transparent/automatic** for file-based tools,
but code-executing/binary installs run only after **one confirmation**.

**Why:** project-scoped harness travels with the repo and the team (committable,
reproducible); global installs are invisible to teammates and leak across projects.

**How to apply:** vendor file tools (MIT) into `.claude/` + wire hooks in the
project `settings.json`; for binary/pkg tools (rtk, graphifyy) keep the *config*
project-level and treat the machine binary as the only unavoidable global dep.
Never write to `~/.claude`. See [[node-runtime-nvm]] for the node resolver used by
the wired JS hooks.
