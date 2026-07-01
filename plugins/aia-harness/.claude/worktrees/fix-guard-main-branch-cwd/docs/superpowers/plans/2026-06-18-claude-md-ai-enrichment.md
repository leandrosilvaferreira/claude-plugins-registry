# CLAUDE.md AI Enrichment + Stack-Aware Skills Block — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Inject a static stack-aware skills block into every generated CLAUDE.md, and add structured AI-ENRICH markers so the `/init` agent can replace the architecture map and conventions with project-specific content via 3-pass analysis.

**Architecture:** The engine (`lib/`) stays pure and deterministic — `skill-map.mjs` is a pure data module that maps detected frameworks/languages to skill names; `skillsBlock()` renders the markdown section. The `/init` command gains a mandatory enrichment step (between apply and review) where the agent does 3 analysis passes over the target project and rewrites the two AI-ENRICH-marked sections.

**Tech Stack:** Node ≥18 ESM (.mjs), JSDoc types, `node:test`, no external deps.

## Global Constraints

- All source `.mjs` ESM — no TypeScript, no build step.
- JSDoc `@param`/`@returns` on every exported function.
- Tests use `node:test` + `node:assert/strict` — match style of `tests/unit.test.mjs`.
- `lib/` modules: zero IO, zero side effects — pure data transforms only.
- Run `npm test` (typecheck + lint + unit) before every commit.
- `templates/` excluded from lint/typecheck — do not touch.
- Never overwrite `profile.mjs` runtime behavior — it's type-only (`export {}`).

---

### Task 1: Extend `lib/data/frameworks.mjs` + create `lib/data/skill-map.mjs`

**Files:**
- Modify: `lib/data/frameworks.mjs` (add 6 lib/tool entries at the end)
- Create: `lib/data/skill-map.mjs`
- Create: `tests/skill-map.test.mjs`

**Interfaces:**
- Produces: `skillsForProfile(profile: ProjectProfile) → Array<{label: string, skill: string, description: string}>`

- [ ] **Step 1: Write the failing test file**

Create `tests/skill-map.test.mjs`:

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { skillsForProfile } from "../lib/data/skill-map.mjs";

/** @param {string[]} fwNames @param {string} [lang] @returns {any} */
function makeProfile(fwNames, lang = "TypeScript") {
  return {
    primaryLanguage: lang,
    frameworks: fwNames.map((name) => ({
      name,
      category: "frontend",
      version: null,
      evidence: "test",
    })),
  };
}

test("Next.js → vercel:nextjs, no react-best-practices", () => {
  const skills = skillsForProfile(makeProfile(["Next.js", "React"]));
  const names = skills.map((s) => s.skill);
  assert.ok(names.includes("vercel:nextjs"), "missing vercel:nextjs");
  assert.ok(!names.includes("vercel:react-best-practices"), "react-best-practices must be suppressed by Next.js");
});

test("React without Next.js → vercel:react-best-practices", () => {
  const skills = skillsForProfile(makeProfile(["React"]));
  const names = skills.map((s) => s.skill);
  assert.ok(names.includes("vercel:react-best-practices"));
});

test("Nuxt → vercel:nuxt", () => {
  const skills = skillsForProfile(makeProfile(["Nuxt"]));
  assert.ok(skills.some((s) => s.skill === "vercel:nuxt"));
});

test("SvelteKit → ui-ux-pro-max (no duplicate from Svelte)", () => {
  const skills = skillsForProfile(makeProfile(["SvelteKit", "Svelte"]));
  const uiSkills = skills.filter((s) => s.skill === "ui-ux-pro-max");
  assert.equal(uiSkills.length, 1, "ui-ux-pro-max must appear exactly once");
});

test("Quarkus → quarkus-patterns + quarkus-verification", () => {
  const skills = skillsForProfile(makeProfile(["Quarkus"], "Java"));
  const names = skills.map((s) => s.skill);
  assert.ok(names.includes("quarkus-patterns"));
  assert.ok(names.includes("quarkus-verification"));
  assert.ok(!names.includes("java-coding-standards"), "java-coding-standards not added via language when Quarkus present");
});

test("Spring Boot → java-coding-standards (not duplicated by Java language rule)", () => {
  const skills = skillsForProfile(makeProfile(["Spring Boot"], "Java"));
  const javaSkills = skills.filter((s) => s.skill === "java-coding-standards");
  assert.equal(javaSkills.length, 1);
});

test("Java language without Spring/Quarkus → java-coding-standards via language rule", () => {
  const skills = skillsForProfile(makeProfile([], "Java"));
  assert.ok(skills.some((s) => s.skill === "java-coding-standards"));
});

test("Go → golang-code-style + golang-design-patterns + golang-modernize", () => {
  const skills = skillsForProfile(makeProfile([], "Go"));
  const names = skills.map((s) => s.skill);
  assert.ok(names.includes("golang-code-style"));
  assert.ok(names.includes("golang-design-patterns"));
  assert.ok(names.includes("golang-modernize"));
});

test("Adianti → adianti-framework", () => {
  const skills = skillsForProfile(makeProfile(["Adianti"], "PHP"));
  assert.ok(skills.some((s) => s.skill === "adianti-framework"));
});

test("NestJS → node", () => {
  const skills = skillsForProfile(makeProfile(["NestJS"]));
  assert.ok(skills.some((s) => s.skill === "node"));
});

test("Prisma → postgresql-database-engineering", () => {
  const skills = skillsForProfile(makeProfile(["Prisma"]));
  assert.ok(skills.some((s) => s.skill === "postgresql-database-engineering"));
});

test("amqplib → rabbitmq-development", () => {
  const skills = skillsForProfile(makeProfile(["amqplib"]));
  assert.ok(skills.some((s) => s.skill === "rabbitmq-development"));
});

test("no frameworks, no language match → empty array", () => {
  const skills = skillsForProfile(makeProfile([], "Ruby"));
  assert.deepEqual(skills, []);
});

test("each entry has label, skill, description strings", () => {
  const skills = skillsForProfile(makeProfile(["Next.js", "Prisma"]));
  for (const s of skills) {
    assert.equal(typeof s.label, "string");
    assert.equal(typeof s.skill, "string");
    assert.equal(typeof s.description, "string");
    assert.ok(s.label.length > 0);
    assert.ok(s.skill.length > 0);
    assert.ok(s.description.length > 0);
  }
});
```

- [ ] **Step 2: Run tests to verify they fail with "Cannot find module"**

```bash
node --test tests/skill-map.test.mjs
```

Expected: `Error: Cannot find module '../lib/data/skill-map.mjs'`

- [ ] **Step 3: Add lib/tool entries to `lib/data/frameworks.mjs`**

Append before the closing `];` of the `FRAMEWORKS` array:

```js
  // ---- JS libs / tooling (detected for skill mapping) ----
  { name: "shadcn/ui", category: "frontend", ecosystem: "js", deps: ["@shadcn/ui"], markers: ["components.json"] },
  { name: "LangChain.js", category: "meta", ecosystem: "js", depPrefixes: ["@langchain/"], deps: ["langchain"] },
  { name: "Remotion", category: "meta", ecosystem: "js", deps: ["remotion"] },
  { name: "amqplib", category: "backend", ecosystem: "js", deps: ["amqplib", "rabbitmq-client"] },
  { name: "Prisma", category: "meta", ecosystem: "js", deps: ["@prisma/client", "prisma"] },
  { name: "node-postgres", category: "backend", ecosystem: "js", deps: ["pg", "postgres"] },
```

- [ ] **Step 4: Create `lib/data/skill-map.mjs`**

```js
/**
 * Static mapping: detected stack → recommended skills to inject into CLAUDE.md.
 * Pure module — no IO, no side effects.
 *
 * @module data/skill-map
 */

/** @typedef {import('../profile.mjs').ProjectProfile} ProjectProfile */

/**
 * @typedef {Object} SkillEntry
 * @property {string} label       Display name shown in CLAUDE.md (e.g. "Next.js")
 * @property {string} skill       Skill identifier used as `/skill` invocation (e.g. "vercel:nextjs")
 * @property {string} description One-line hint for when to invoke the skill
 */

/**
 * Returns the ordered, deduplicated list of skill entries for a given profile.
 * Rules evaluated top-to-bottom; a skill is never added twice.
 *
 * @param {ProjectProfile} profile
 * @returns {SkillEntry[]}
 */
export function skillsForProfile(profile) {
  const fw = new Set(profile.frameworks.map((f) => f.name));
  const lang = profile.primaryLanguage ?? "";

  /** @type {SkillEntry[]} */
  const entries = [];
  const seen = new Set();

  /** @param {string} label @param {string} skill @param {string} description */
  const add = (label, skill, description) => {
    if (seen.has(skill)) return;
    seen.add(skill);
    entries.push({ label, skill, description });
  };

  // --- Framework rules (evaluated in priority order) ---
  if (fw.has("Next.js")) add("Next.js", "vercel:nextjs", "routing, SSR/SSG, cache, middleware");
  if (fw.has("Nuxt")) add("Nuxt", "vercel:nuxt", "pages, composables, server routes");
  if (fw.has("React") && !fw.has("Next.js")) {
    add("React", "vercel:react-best-practices", "componentes, hooks, performance");
  }
  if (fw.has("Angular") || fw.has("SvelteKit") || (fw.has("Svelte") && !fw.has("SvelteKit"))) {
    add("UI/UX", "ui-ux-pro-max", "design de componentes, acessibilidade, UX");
  }
  if (["NestJS", "Express", "Fastify", "Koa", "Hono", "AdonisJS"].some((n) => fw.has(n))) {
    add("Node.js backend", "node", "APIs, middleware, módulos Node");
  }
  if (fw.has("Quarkus")) {
    add("Quarkus", "quarkus-patterns", "extensions, CDI, REST endpoints");
    add("Quarkus verify", "quarkus-verification", "validação de configuração e build nativo");
  }
  if (fw.has("Spring Boot")) add("Java/Spring", "java-coding-standards", "padrões de código Java no projeto");
  if (fw.has("Adianti")) add("Adianti", "adianti-framework", "padrões MVC do framework Adianti");
  if (fw.has("shadcn/ui")) add("shadcn/ui", "vercel:shadcn", "componentes, temas, customização");
  if (fw.has("LangChain.js")) add("LangChain", "langchain", "chains, agentes, integrações LLM");
  if (fw.has("Remotion")) add("Remotion", "remotion-best-practices", "composições de vídeo React");
  if (fw.has("amqplib") || fw.has("RabbitMQ")) {
    add("RabbitMQ", "rabbitmq-development", "filas, exchanges, consumers");
  }
  if (fw.has("Prisma") || fw.has("node-postgres")) {
    add("PostgreSQL", "postgresql-database-engineering", "migrations, queries, índices");
  }

  // --- Language rules (fallbacks when no specific framework matched) ---
  if (lang === "Java" && !fw.has("Spring Boot") && !fw.has("Quarkus")) {
    add("Java", "java-coding-standards", "padrões de código Java no projeto");
  }
  if (lang === "Go") {
    add("Go style", "golang-code-style", "idioms, formatação, convenções");
    add("Go patterns", "golang-design-patterns", "padrões de arquitetura Go");
    add("Go modernize", "golang-modernize", "modernização de código Go legado");
  }

  // --- Fallback: JS/TS frontend with no specific UI skill yet ---
  const hasFrontendSkill =
    seen.has("vercel:nextjs") ||
    seen.has("vercel:nuxt") ||
    seen.has("vercel:react-best-practices") ||
    seen.has("ui-ux-pro-max");
  const hasFrontendFramework = profile.frameworks.some((f) => f.category === "frontend");
  if (!hasFrontendSkill && hasFrontendFramework && (lang === "TypeScript" || lang === "JavaScript")) {
    add("UI/UX", "ui-ux-pro-max", "design de componentes, acessibilidade, UX");
  }

  return entries;
}
```

- [ ] **Step 5: Run tests — should pass**

```bash
node --test tests/skill-map.test.mjs
```

Expected: all 14 tests `✓ pass`

- [ ] **Step 6: Run full test suite**

```bash
npm test
```

Expected: typecheck OK, lint OK, all tests pass.

- [ ] **Step 7: Commit**

```bash
git add lib/data/frameworks.mjs lib/data/skill-map.mjs tests/skill-map.test.mjs
git commit -m "feat(skill-map): add static stack→skill mapping and lib framework entries"
```

---

### Task 2: Add `skillsBlock()` to `lib/generate/claude-md.mjs` + update `renderRootClaudeMd()`

**Files:**
- Modify: `lib/generate/claude-md.mjs`
- Modify: `tests/skill-map.test.mjs` (add `skillsBlock` tests)

**Interfaces:**
- Consumes: `skillsForProfile` from `../data/skill-map.mjs`
- Produces:
  - `skillsBlock(profile: ProjectProfile) → string` (exported)
  - `renderRootClaudeMd(profile)` updated output — includes skills block + AI-ENRICH comments

- [ ] **Step 1: Write failing tests for `skillsBlock`**

Append to `tests/skill-map.test.mjs`:

```js
import { skillsBlock } from "../lib/generate/claude-md.mjs";

test("skillsBlock returns empty string when no skills match", () => {
  const result = skillsBlock(makeProfile([], "Ruby"));
  assert.equal(result, "");
});

test("skillsBlock returns markdown section with header and entries", () => {
  const result = skillsBlock(makeProfile(["Next.js"]));
  assert.match(result, /## Skills/);
  assert.match(result, /vercel:nextjs/);
  assert.match(result, /Next\.js/);
});

test("skillsBlock entries use backtick slash-prefix format", () => {
  const result = skillsBlock(makeProfile(["Next.js"]));
  // Must render as `/vercel:nextjs` inside backticks
  assert.match(result, /`\/vercel:nextjs`/);
});

test("skillsBlock omits section entirely when profile has no matching stack", () => {
  const result = skillsBlock(makeProfile([], "Rust"));
  assert.equal(result, "");
});
```

- [ ] **Step 2: Run tests — should fail**

```bash
node --test tests/skill-map.test.mjs
```

Expected: `SyntaxError` or `TypeError` — `skillsBlock` not exported from `claude-md.mjs` yet.

- [ ] **Step 3: Add import + `skillsBlock` function to `lib/generate/claude-md.mjs`**

Add import at top of the file, after existing `@typedef` lines (line 10):

```js
import { skillsForProfile } from "../data/skill-map.mjs";
```

Add new exported function after `commandsBlock` (after line 38, before `stackLine`):

```js
/**
 * Renders the "## Skills" section for a profile. Returns "" if no skills apply
 * (section is omitted rather than showing an empty block).
 *
 * @param {ProjectProfile} profile
 * @returns {string}
 */
export function skillsBlock(profile) {
  const entries = skillsForProfile(profile);
  if (entries.length === 0) return "";
  const lines = entries.map((e) => `- **${e.label}** → \`/${e.skill}\` — ${e.description}`);
  return `## Skills — use para esta stack\n\n> Invoque a skill correspondente antes de trabalhar no domínio dela.\n\n${lines.join("\n")}\n`;
}
```

- [ ] **Step 4: Run tests — skillsBlock tests should pass**

```bash
node --test tests/skill-map.test.mjs
```

Expected: all `skillsBlock` tests `✓ pass`

- [ ] **Step 5: Update `renderRootClaudeMd()` to inject skills block and AI-ENRICH comments**

Replace the entire `renderRootClaudeMd` function body (lines 65–106 in the original file):

```js
export function renderRootClaudeMd(profile) {
  const name = profile.root.split("/").pop() || "project";
  const domains = profile.architecture.domains;
  const domainMap =
    domains.length > 0
      ? domains
          .slice(0, DOMAIN_LIMIT)
          .map((d) => `- \`${d.path}/\` — ${d.role}`)
          .join("\n")
      : "- _Single-tree project; no sub-domains detected._";

  const skills = skillsBlock(profile);

  return `# ${name}

> Project memory for Claude Code. Keep this file short and high-signal —
> bloated memory gets ignored. Put hard guarantees in hooks, not prose.

## Stack
${stackLine(profile)}

Architecture: **${profile.architecture.style}**${
    profile.monorepo.isMonorepo ? ` (monorepo via ${profile.monorepo.tool})` : ""
  }.

## Canonical commands
Always use these exact commands (do not guess):

${commandsBlock(profile.commands)}
${skills ? `\n${skills}` : ""}
## Architecture map
<!-- AI-ENRICH: analyze file tree and key source dirs, describe module responsibilities and relationships, replace this section -->

Domain-specific guidance lives in nested CLAUDE.md files (loaded on demand):

${domainMap}

## Conventions
<!-- AI-ENRICH: detect project-specific patterns from source files, replace with 4-7 concrete conventions, remove generic ones -->

- Match the style of surrounding code; do not introduce new patterns unprompted.
- Write unit tests for every new function or module added.
- Run the lint + test commands above before claiming work is complete.
- Never commit secrets; environment values belong in \`.claude/settings.local.json\` (gitignored).

<!-- Generated by aia-harness. Edit freely; re-run /aia-harness:doctor to audit. -->
`;
}
```

- [ ] **Step 6: Add snapshot tests for `renderRootClaudeMd` to `tests/skill-map.test.mjs`**

Append to `tests/skill-map.test.mjs`:

```js
import { renderRootClaudeMd } from "../lib/generate/claude-md.mjs";

/** @returns {any} */
function makeFullProfile(fwNames = [], lang = "TypeScript") {
  return {
    root: "/projects/my-app",
    primaryLanguage: lang,
    languages: [{ name: lang, type: "programming", bytes: 1000, files: 10, share: 1 }],
    frameworks: fwNames.map((name) => ({ name, category: "frontend", version: null, evidence: "test" })),
    packageManagers: [{ name: "npm", ecosystem: "js", version: null, evidence: "test" }],
    monorepo: { isMonorepo: false, tool: null, packages: [], evidence: null },
    commands: { install: "npm install", lint: "npm run lint", format: null, typecheck: null, test: "npm test", build: null, run: "npm run dev", source: "test", raw: {} },
    architecture: { style: "layered", domains: [{ path: "src", kind: "layer", role: "application source" }], signals: [] },
    existingHarness: { claudeMd: false, claudeMdFiles: [], settings: false, settingsLocal: false, mcp: false, hooks: false, rules: false, skills: [] },
    vcs: { isGit: true, worktreeReady: false, defaultBranch: "main" },
    markers: [],
    truncated: false,
  };
}

test("renderRootClaudeMd with Next.js includes skills section", () => {
  const md = renderRootClaudeMd(makeFullProfile(["Next.js", "React"]));
  assert.match(md, /## Skills/);
  assert.match(md, /vercel:nextjs/);
  assert.doesNotMatch(md, /react-best-practices/);
});

test("renderRootClaudeMd with no matching stack omits skills section", () => {
  const md = renderRootClaudeMd(makeFullProfile([], "Ruby"));
  assert.doesNotMatch(md, /## Skills/);
});

test("renderRootClaudeMd includes AI-ENRICH comments", () => {
  const md = renderRootClaudeMd(makeFullProfile([]));
  assert.match(md, /AI-ENRICH/);
  assert.ok((md.match(/AI-ENRICH/g) ?? []).length === 2, "must have exactly 2 AI-ENRICH comments");
});

test("renderRootClaudeMd preserves canonical structure", () => {
  const md = renderRootClaudeMd(makeFullProfile(["Next.js"]));
  assert.match(md, /## Stack/);
  assert.match(md, /## Canonical commands/);
  assert.match(md, /## Architecture map/);
  assert.match(md, /## Conventions/);
});
```

- [ ] **Step 7: Run all tests**

```bash
node --test tests/skill-map.test.mjs
```

Expected: all tests pass.

- [ ] **Step 8: Run full suite**

```bash
npm test
```

Expected: typecheck OK, lint OK, all tests pass.

- [ ] **Step 9: Commit**

```bash
git add lib/generate/claude-md.mjs tests/skill-map.test.mjs
git commit -m "feat(claude-md): add skillsBlock injection and AI-ENRICH markers to renderRootClaudeMd"
```

---

### Task 3: Update `commands/init.md` with step 5.5 — Enrich CLAUDE.md

**Files:**
- Modify: `commands/init.md`

No unit tests — this is agent instruction prose. Validate by reading the result.

- [ ] **Step 1: Read current `commands/init.md` to confirm step numbering**

File is at `commands/init.md`. Current steps: 1 Diagnose, 2 Plan, 3 Consent gate, 4 Preview & diffs, 5 Apply, 6 Review, 7 Wrap up, 8 Second opinion.

- [ ] **Step 2: Insert step 5.5 between steps 5 (Apply) and 6 (Review)**

After the step 5 block (ending at `...add \`--force\` only for approved overwrites...`), insert:

```markdown
5.5. **Enrich CLAUDE.md.** After apply, analyze the target project in 3 passes and rewrite the AI-ENRICH-marked sections of the generated `CLAUDE.md`. Do not alter `## Stack`, `## Canonical commands`, or `## Skills`.

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
   |---|---|
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

   **Pass 3 — Synthesize and rewrite.** Using data from passes 1 and 2, edit the target project's `CLAUDE.md`:

   1. Rewrite `## Architecture map`: one line per relevant module/directory, describing **responsibility + relationships** (e.g. "protected by middleware X", "consumes service Y via lib/Z"). Omit obvious directories (`node_modules`, `dist`, `.git`). Max 15 entries.
   2. Rewrite `## Conventions`: 4–7 **project-specific** conventions detected from the source — concrete and actionable, not generic. Remove any generic placeholder lines.
   3. Remove all `<!-- AI-ENRICH: ... -->` comments from the final file.
   4. Show a diff of the enriched file versus the skeleton. Wait for explicit user approval before writing with `Edit`.
```

- [ ] **Step 3: Remove "Offer to tailor any generated CLAUDE.md prose" from step 7 (Wrap up)**

In step 7, remove the sentence: `Offer to tailor any generated \`CLAUDE.md\` prose.`

The enrichment is now mandatory in step 5.5, not an optional offer.

- [ ] **Step 4: Verify the file reads correctly end-to-end**

```bash
cat commands/init.md
```

Confirm: step 5.5 appears between steps 5 and 6, step numbering is coherent, no "Offer to tailor" in step 7.

- [ ] **Step 5: Run full suite (lint covers commands/ .md files if configured)**

```bash
npm test
```

Expected: all pass.

- [ ] **Step 6: Commit**

```bash
git add commands/init.md
git commit -m "feat(init): add mandatory 3-pass CLAUDE.md AI enrichment step after apply"
```

---

## Self-Review

**Spec coverage:**
- ✅ `lib/data/skill-map.mjs` created with `skillsForProfile()` — Task 1
- ✅ `lib/data/frameworks.mjs` extended with shadcn/LangChain/Prisma/amqplib/node-postgres — Task 1
- ✅ `skillsBlock(profile)` added to `claude-md.mjs` — Task 2
- ✅ `renderRootClaudeMd()` injects skills block + AI-ENRICH comments — Task 2
- ✅ Tests for `skillsForProfile` + `skillsBlock` + `renderRootClaudeMd` — Tasks 1 & 2
- ✅ `commands/init.md` step 5.5 with 3-pass enrichment — Task 3
- ✅ Deduplication rules (Next.js suppresses React, SvelteKit suppresses Svelte, etc.) — Task 1
- ✅ Fail-open: AI-ENRICH skeleton fallback stays if agent doesn't enrich — inherent in design
- ✅ "Offer to tailor" removed from step 7 — Task 3

**Not implemented (explicitly out of scope per spec):**
- `renderDomainClaudeMd()` changes
- `/doctor` enrichment
- User-customizable skill map
