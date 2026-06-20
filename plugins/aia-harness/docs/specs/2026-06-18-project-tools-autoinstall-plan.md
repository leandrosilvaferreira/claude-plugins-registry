# Project-Level Tool Auto-Install Plan

Date: 2026-06-18
Status: Proposed (forks resolved; awaiting go-ahead)

## Goal

Give aia-harness the ability to install token-economy / code-graph tools
**at project level only** (never global / user), **transparently**: file-based
tools are vendored + wired into the target `.claude/` automatically; machine-dep
tools are installed after a single confirmation. Claude Code-focused.

## Decisions (locked)

| Fork | Decision |
|------|----------|
| Modality | **Vendor+wire automatically** (file tools) + **1 confirmation** for binary/pkg installs. |
| v1 tools | **rtk, caveman, ponytail, graphify**. |
| Session memory | **Deferred** (not in this iteration). |

## Tool install matrix (from research)

| Tool | Repo / license | Project-level method | Machine dep |
|------|----------------|----------------------|-------------|
| **caveman** | JuliusBrussee/caveman, MIT | **Vendor** skills+hooks → `.claude/` + wire `SessionStart`+`UserPromptSubmit` in `settings.json` | `node` |
| **ponytail** | DietrichGebert/ponytail, MIT | **Vendor** skills+hooks → `.claude/` + wire `SessionStart`+`UserPromptSubmit` | `node` |
| **rtk** | rtk-ai/rtk, Apache-2.0 | **Wire a guarded `PreToolUse(Bash)` hook** in `settings.json` (no-ops if binary absent) | `rtk` binary (brew/curl) |
| **graphify** | safishamsi/graphify, MIT | `uv tool install graphifyy` → `graphify install --project` → `graphify claude install` → `graphify hook install`; graph in committed `graphify-out/` | `uv` (+ python 3.12) |

caveman + ponytail become 100% project-level + offline via vendoring (same
pattern as ECC). rtk + graphify keep their **config** project-level; only the
binary/pkg is a machine dependency, installed with one confirmation.

## Architecture

```
lib/data/tools-catalog.mjs    # TOOLS[], selectTools(profile), toolSettingsHooks(ids), deps
lib/tools/transform.mjs       # pure: rewrite vendored hook paths/flag dirs, stamp provenance (tested)
scripts/tools-source.json     # pinned repos + commits (caveman, ponytail)
scripts/sync-tools.mjs        # fetch caveman+ponytail skills+hooks -> transform -> templates/tools/<id>/ + LICENSE + MANIFEST
templates/tools/
  caveman/{skills/*, hooks/*, LICENSE}
  ponytail/{skills/*, hooks/*, LICENSE}
commands/add-tools.md         # interactive: detect machine deps, 1 confirmation, run binary/pkg installs
```

### Engine (deterministic, automatic, offline) — `plan.mjs` / `apply.mjs`
- Vendor **caveman** + **ponytail**: copy each `templates/tools/<id>/skills/*` →
  `.claude/skills/*` (dir copy) and `hooks/*` → `.claude/hooks/<id>/*`.
- Compose their hooks into the generated `.claude/settings.json` via a new
  `renderSettings(profile, extraHooks)` param. Hook commands run through our
  existing `node-run.sh` wrapper, pointing at the vendored scripts with
  `${CLAUDE_PROJECT_DIR}`.
- Wire **rtk**'s `PreToolUse(Bash)` hook, **guarded**:
  `command -v rtk >/dev/null 2>&1 && exec rtk hook claude` — a missing binary
  no-ops (Bash proceeds unmodified), so it is always safe to ship.
- Emit machine-dep install commands (rtk, graphifyy, `graphify install --project`)
  into `scripts/harness-install.sh` for reference.

### Command (1 confirmation) — `/aia-harness:add-tools`
- Detect machine deps: `node`, `rtk`, `uv`/`pipx`, `graphifyy`.
- Show what is already project-level-ready (caveman/ponytail/rtk wiring) vs what
  needs a machine install.
- With **one** `AskUserQuestion` confirmation, run only the approved machine
  installs (rtk and the graphify flow below).
- Never auto-run installers without that confirmation.

### graphify — exact flow (per user)
Machine deps first (prefer `uv`):
- macOS: `brew install python@3.12 uv`
- Windows: `winget install astral-sh.uv`
- Ubuntu/Debian: `sudo apt install python3.12 python3-pip pipx` **or** `curl -LsSf https://astral.sh/uv/install.sh | sh`

Then, from the project root (all project-level):
1. `uv tool install graphifyy`   (puts `graphify` on PATH)
2. `graphify install --project`   (skill into `.claude/skills/graphify/`)
3. `graphify claude install`      (make Claude Code always use the graph: CLAUDE.md + PreToolUse hook)
4. `graphify hook install`        (auto-rebuild on git commit; sets a graph.json merge driver)
5. build the graph: `/graphify .` (or `graphify .`), then commit `graphify-out/`

aia-harness also writes/updates:
- **`.graphifyignore`** (gitignore syntax, merged with `.gitignore`, `!` negation
  wins-last) seeded from the detected stack — e.g. `node_modules/`, `dist/`,
  `.next/`, `*.generated.*`, build/coverage dirs.
- **`.gitignore`** additions: `graphify-out/cost.json` (local only); optionally
  `graphify-out/cache/`. `graphify-out/` itself is **committed** (team shares the map).

Team workflow (documented in the generated install script): one dev runs
`/graphify .` and commits `graphify-out/`; teammates pull and their assistant
reads the graph immediately; `graphify hook install` keeps it fresh (AST-only,
no API cost).

### Vendor transform (sync-tools)
- Fetch each tool's `skills/` + `hooks/` at a pinned commit (1 API call + raw CDN).
- Rewrite hook internals: any `${CLAUDE_PLUGIN_ROOT}` → vendored-relative; redirect
  runtime flag files to a project path where feasible; stamp provenance comment.
- Write `templates/tools/<id>/LICENSE` + `MANIFEST.json` (commit + attribution).

## Conflict / safety
- `apply` is diff-safe: existing `.claude/skills/*` or hooks are skipped (a repo
  that already has caveman, like swapo, won't be clobbered).
- Two token modes (caveman = output compression, ponytail = minimal code) can
  coexist — they target different concerns (swapo runs both).
- No secrets written; no `bypassPermissions`; vendored content keeps MIT/Apache
  notices. Do **not** replicate swapo's plaintext-secret `settings.local.json`.

## Quality gates
- Pure transforms unit-tested (no network).
- `tools-catalog` mapping tested (selectTools/toolSettingsHooks).
- plan/apply tests: vendored tool dirs land; settings.json contains the tool +
  rtk hooks; rtk hook is guarded.
- `tsc --checkJs` + ESLint + `node:test` all green.
- Smoke: apply to a temp project, confirm `.claude/skills/caveman*`,
  `.claude/hooks/{caveman,ponytail}/*`, and the merged settings hooks.

## Phases
1. tools-catalog + transform (+ tests).
2. sync-tools + tools-source.json; run once to vendor caveman+ponytail; LICENSE/MANIFEST.
3. renderSettings extraHooks + plan/apply integration (+ tests).
4. /aia-harness:add-tools command + enriched install script + README/skill updates + credits.
5. Final verify + smoke + commit.

## Credits to add
- caveman — JuliusBrussee/caveman (MIT).
- ponytail — DietrichGebert/ponytail (MIT).
- rtk — rtk-ai/rtk (Apache-2.0).
- graphify — safishamsi/graphify (MIT).

## Out of scope (this iteration)
Project-level cross-session memory (save/resume-session, PreCompact flush,
codemaps), and code-review-graph MCP wiring — deferred per fork.
