---
description: Scan the project and scaffold a full Claude Code harness — diagnose, approve, then apply with diffs.
argument-hint: "[path]"
allowed-tools:
  - Bash
  - Read
  - Edit
  - Write
  - AskUserQuestion
---

# Initialize the project's Claude Code harness

Use the **harness-engineering** skill. Run the deterministic core, then gate
every write behind explicit user approval. Never overwrite a file without
showing a diff first.

Target directory: `$1` if provided, else `$CLAUDE_PROJECT_DIR`.

## Flow

## 0. Verificar dependências do sistema

```bash
"${CLAUDE_PLUGIN_ROOT}/bin/aia-harness" check "${1:-$CLAUDE_PROJECT_DIR}" --json
```

Se `status === "block"`: apresentar em português a lista de `missing[]` com `installHint`
para a plataforma do usuário e encerrar — não executar os passos seguintes.

1. **Diagnose.** Run and present the report (in Portuguese):

   ```bash
   "${CLAUDE_PLUGIN_ROOT}/bin/aia-harness" scan "${1:-$CLAUDE_PROJECT_DIR}"
   ```

2. **Plan.** Get the machine-readable plan:

   ```bash
   "${CLAUDE_PLUGIN_ROOT}/bin/aia-harness" plan "${1:-$CLAUDE_PROJECT_DIR}" --json
   ```

   Summarize the proposed artifacts grouped by category, each with its rationale
   and session context cost. Call out the total context cost.

3. **Consent gate.** Use `AskUserQuestion` (multi-select) to let the user choose
   which artifact groups to apply. Groups include our own files (CLAUDE.md,
   rules, settings, hooks, skills, .mcp.json) **and ECC-sourced assets selected
   for the detected stack** — `agents` (reviewers/build-resolvers), ECC `skills`,
   and mirrored ECC `rules` under `.claude/rules/ecc/`. Default-select items
   marked `selected`; leave `opt-in` items (e.g. `.lsp.json`, the market install
   script) unchecked. Mention the ECC attribution (MIT, Affaan Mustafa).

   The **`.mcp.json` group proposes `context7` + `github`** (github only when the
   repo is git; plus `sequential-thinking`). On confirmation, apply writes them to
   the target's project-root `.mcp.json` using `${ENV}` placeholders only, and adds
   the matching env keys (e.g. `GITHUB_PERSONAL_ACCESS_TOKEN`) to
   `.claude/settings.local.json` for the user to fill. These are suggested
   per-target — aia-harness never ships a plugin-level `.mcp.json`.

   **Also ask one dedicated single-select question: "Stop verification".** Phrase
   it plainly, e.g. _"Run lint + typecheck when the agent finishes and block until
   they pass, so it fixes its own errors? (recommended)"_ — list **"Yes,
   recommended"** first and **"No, just remind me"** second. Do **not** mention any
   CLI flag. This maps to the strict Stop hook (default on): the generated
   `verify-on-stop.mjs` runs the detected lint/typecheck and blocks with the error
   fed back, while a `set-files-changed.mjs` PostToolUse hook scopes it to sessions
   that edited code. If the project has neither a lint nor a typecheck command,
   skip the question (strict has nothing to run). Remember the choice for apply.

   **Also ask one dedicated single-select question: "Large-file guard".** The
   `large-file-warning.mjs` hook is **mandatory** (always installed) — this question
   only picks its _mode_, never whether to install it. Phrase it plainly, e.g.
   _"Quando um arquivo-fonte passar de 350 linhas, o agente deve **bloquear e
   refatorar antes de encerrar** (projeto novo nasce limpo) ou **só sugerir e
   confirmar com você** (projeto legado, não mexe sem aprovação)?"_ — two options:
   **"Bloquear e refatorar já"** (→ `--large-files=block`) and **"Só sugerir, sem
   bloquear"** (→ `--large-files=advisory`). **Order them so the option matching the
   scan's "Large source files → recommended guard" comes first, labelled
   "(recomendado)"** — the scan recommends `block` for a clean repo and `advisory`
   for one with pre-existing oversized files. Do **not** mention the CLI flag.
   Remember the choice for apply.

   **If `profile.githubPM.detected` is true**, also offer a dedicated single-select
   question: "GitHub PM (issues, Projects v2, workflows)".
   Phrase: _"O projeto usa GitHub. Instalar o pillar GitHub PM? (skill /pm:*, issue templates,
   4 GitHub Actions workflows, pm-config template)"_
   Options: **"Sim, instalar"** (→ include `github-pm` category) first, **"Não"** second.
   Mention: "Requer configuração via `/pm:setup-project` após a instalação."
   `defaultSelected: false` — always opt-in.

4. **Preview & diffs.** Run a dry run to preview, and for any artifact whose
   target already exists, show the diff before deciding to overwrite:

   ```bash
   "${CLAUDE_PLUGIN_ROOT}/bin/aia-harness" apply "${1:-$CLAUDE_PROJECT_DIR}" --only=<ids> --large-files=<mode>
   ```

5. **Apply.** Once approved, write the selected artifacts (add `--force` only for
   approved overwrites). **If the user chose "No, just remind me" for Stop
   verification, add `--no-strict`** (strict is the default otherwise). **Pass the
   Large-file guard choice as `--large-files=block` or `--large-files=advisory`**
   (the hook is always installed; the flag only picks its mode):

   ```bash
   "${CLAUDE_PLUGIN_ROOT}/bin/aia-harness" apply "${1:-$CLAUDE_PROJECT_DIR}" --yes --only=<ids> --large-files=<mode> [--no-strict]
   ```

5.5. **Enrich CLAUDE.md.** After apply, analyze the target project in 3 passes and rewrite the AI-ENRICH-marked sections of the generated `CLAUDE.md`. Do not alter `## Stack`, `## Canonical commands`, or `## Skills`. **Never touch any section carrying the `aia-harness:fixed` marker** (root `## Engineering rules`, domain `## Rules`) — those are non-negotiable baseline rules that must survive verbatim; you may only add to `## Conventions` / `## Local conventions`, never relocate rules out of the fixed section.

   **Pass 1 — Structure and responsibilities.** Run:

   ```bash
   find "${1:-$CLAUDE_PROJECT_DIR}" -maxdepth 3 \
     -not -path '*/node_modules/*' \
     -not -path '*/.git/*' \
     -not -path '*/vendor/*' \
     -not -path '*/.next/*' \
     -not -path '*/dist/*' \
     -not -path '*/.nuxt/*' \
     -not -path '*/target/*'
   ```

   Also read: `README.md` or `README` (root), `docs/` up to 2 levels (if present), and root config files (`package.json`, `composer.json`, `pyproject.toml`, `pom.xml`, `go.mod`, `Cargo.toml`). Goal: understand top-level module responsibilities and relationships.

   **Pass 2 — Real source patterns.** Based on the frameworks detected in the scan profile, read the key directories below (2–4 representative files per directory):

   | Framework | Directories to read |
   | --- | --- |
   | Next.js | `app/`, `src/app/`, `pages/`, `middleware.ts`, `lib/` |
   | Nuxt | `pages/`, `server/`, `composables/`, `plugins/` |
   | React (SPA) | `src/`, `src/components/`, `src/hooks/`, `src/pages/` |
   | Angular | `src/app/`, `src/app/core/`, `src/app/shared/` |
   | Laravel | `app/Http/Controllers/`, `routes/`, `app/Models/`, `resources/views/` |
   | Adianti | `app/control/`, `app/model/`, `app/view/`, `index.php` |
   | NestJS | `src/`, `src/modules/`, `src/common/` |
   | Quarkus | `src/main/java/`, `src/main/resources/` |
   | Spring Boot | `src/main/java/`, `src/main/resources/application*.yml` |
   | Go | `cmd/`, `internal/`, `pkg/`, `api/` |
   | Django | `apps/`, `config/`, `requirements*.txt` |
   | FastAPI | `app/`, `app/routers/`, `app/models/` |

   Goal: detect real patterns — naming conventions, import structure, error handling style, test organization.

   **Pass 3 — Synthesize and rewrite.** Using data from passes 1 and 2, edit the root `CLAUDE.md` **and every nested domain `CLAUDE.md`** that was written:

   1. Rewrite the root `## Architecture map`: one line per relevant module/directory, describing **responsibility + relationships** (e.g. "protected by middleware X", "consumes service Y via lib/Z"). Omit obvious directories (`node_modules`, `dist`, `.git`). Max 15 entries.
   2. Rewrite the root `## Conventions`: 4–7 **project-specific** conventions detected from the source — concrete and actionable, not generic. Replace only the placeholder line under `## Conventions`. **Do not touch `## Engineering rules`** (the `aia-harness:fixed` section) — those non-negotiable rules stay verbatim; never move, reword, or drop them.
   3. **Enrich each nested domain `CLAUDE.md`** (the `<domain>/CLAUDE.md` files written under each detected domain — they otherwise ship as an identical generic stub, which is the bug this prevents). For each one, using the files you read for **that** directory in Pass 2 (read the directory now if Pass 2 did not cover it):
      - replace the `## Responsibility` AI-ENRICH section with 2–4 sentences on what concretely lives there and what does not (and where that other code lives);
      - replace the `## Local conventions` placeholder with 2–5 conventions actually observed in that directory (naming, base classes, error handling, file layout) — not generic lines. **Leave the domain `## Rules` (`aia-harness:fixed`) section untouched.**
      Each domain file must end up **distinct** from the others in its `## Responsibility` / `## Local conventions` (the fixed `## Rules` is identical by design). If a directory genuinely has too little to say, keep it to one honest line rather than inventing — but never leave the identical stub.
   4. Remove every `<!-- AI-ENRICH: ... -->` comment from the files you touched (root + domains), but **keep every `aia-harness:fixed` marker** so the protected rules stay flagged for future audits.
   5. Show a combined diff (root + domain files) versus the skeletons. Wait for explicit user approval before writing with `Edit`.

5.7. **Seed unit tests (se faltar).** Leia `profile.testing` do JSON retornado pelo scan/plan.
   **Se `testing.configured === false` e `testing.recommended` não for nulo**, ofereça
   configurar agora com `AskUserQuestion` (single-select), em português:
   _"Este projeto não tem testes unitários. Configurar agora? Recomendado: `<testing.recommended>`."_
   — opções: **"Sim, configurar"** / **"Sim, mas escolher outro framework"** / **"Não, por ora"**.

   - **"Sim"** → invoque a skill **`setup-testing`** (ela instala o framework com confirmação,
     escreve a config + 1 teste real num módulo existente, fia o script `test` e roda até verde).
   - **"Sim, mas escolher outro"** → pergunte qual framework e passe a escolha à skill.
   - **"Não"** → siga sem configurar; a skill fica instalada para `/setup-testing` depois.

   Se `testing.configured === true`, pule este passo silenciosamente.

6. **Review.** Launch the `harness-reviewer` agent to audit the written files for
   secrets, fail-open hooks, and over-broad permissions. Apply its fixes — but
   **never change `settings.json` `model` (`opusplan` is intentional: Opus plan /
   Sonnet exec) nor `env.CLAUDE_CODE_EFFORT_LEVEL`**. If a finding proposes a
   concrete model id, discard it.

7. **Wrap up + install dependencies — ask, then run; never leave it as a file to
   remember.** Drive each install **interactively** with `AskUserQuestion`. Do not
   just print a summary and stop, and do not tell the user to run a script "later".

   a. **Plugins.** If `scripts/install-plugins.sh` was written, use `AskUserQuestion`
      to ask whether to install the N suggested plugins now (per-stack LSP,
      code-review, hookify, context7, github, …). On approval, run it (idempotent,
      user-level):

      ```bash
      bash "${1:-$CLAUDE_PROJECT_DIR}/scripts/install-plugins.sh" -y
      ```

      On decline → `/aia-harness:add-plugins` later.

   b. **Project tools (machine deps).** The vendored tools (caveman / ponytail /
      worktrees) are already wired by apply — nothing to install. The ones that need
      a machine-level install are **rtk** (token-proxy binary; its hook is wired and
      no-ops until present) and **graphify** (code-graph; needs `uv`). Use **one
      `AskUserQuestion` (multi-select)** listing only the wired ones (check
      `.claude/settings.json` / `.graphifyignore`) so the user ticks which to install.
      For each selected, check its package manager exists first, run it, tolerate
      failure, and report:
      - **rtk:** `command -v brew >/dev/null && brew install rtk || curl -fsSL https://raw.githubusercontent.com/rtk-ai/rtk/refs/heads/master/install.sh | sh`
      - **graphify** (from the target dir): `uv tool install graphifyy` then
        `graphify install --project && graphify claude install && graphify hook install && graphify .`

      This is the same set `/aia-harness:add-tools` step 3 installs — defer there for
      anything more. `scripts/harness-install.sh` stays only as a written reference;
      these interactive offers mean the user never has to remember to run it.

   c. **MCP secrets.** The `.mcp.json` servers are written but inert until their env
      keys are filled in `.claude/settings.local.json` (gitignored). List exactly
      which keys to fill (e.g. `GITHUB_PERSONAL_ACCESS_TOKEN`).

   d. **Restart.** Remind the user to **restart Claude Code** so new hooks, plugins,
      and MCP servers load.

8. **Second opinion (Claude's own recommendations) — then apply, don't just print.**
   Invoke the **`claude-automation-recommender`** skill on this project so Claude
   reviews the result and suggests further automations (hooks / subagents / skills
   / plugins / MCP). Present its findings grouped by category and note which overlap
   what aia-harness already installed.

   Then **make them actionable** — never end by only printing the suggestions:

   1. Use `AskUserQuestion` (multi-select) listing the genuinely-new
      recommendations so the user picks which to apply.
   2. For each selected item, apply it now, re-confirming before any write:
      - **new skill / agent / hook file** → create it with `Write` (show the
        content first); if it is a hook, also wire it in `.claude/settings.json`
        with `Edit` (show a diff) and add a compliance test if appropriate.
      - **settings/permission/hook tweak** → `Edit` `.claude/settings.json` (diff first).
      - **plugin / MCP** → run `/aia-harness:add-plugins` or `/aia-harness:add-mcp`.
   3. Leave unselected items as a short "later" list.

   If recurring or high-value, suggest contributing the automation back into
   aia-harness so every future project gets it by default.

   If the skill is not installed, tell the user it ships in the `claude-code-setup`
   plugin (`claude plugin install claude-code-setup@anthropics/claude-plugins-official`)
   and skip gracefully. Apply nothing without explicit approval.
