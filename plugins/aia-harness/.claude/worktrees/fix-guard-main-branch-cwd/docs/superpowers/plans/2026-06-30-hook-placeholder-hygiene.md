# Hook-Placeholder Hygiene Detection + Guided Fix Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Detect exec-form Claude Code hooks in a target project's `.claude/settings.json` that use a bare (unbraced) `$CLAUDE_PROJECT_DIR`/`$CLAUDE_PLUGIN_ROOT`/`$CLAUDE_PLUGIN_DATA` — the exact bug that just broke aia-harness's own dogfood harness — surface it as a `scan` warning, and offer a consent-gated fix via `doctor`.

**Architecture:** A new pure detector (`lib/detect/hook-hygiene.mjs`) walks a parsed `settings.json`'s hook tree and flags `args` entries with an unbraced placeholder (exec-form hooks bypass the shell, so Claude Code only expands the braced form). It's wired into the existing `scanProject` pipeline as a new `profile.hookHygiene` field, surfaced in both the human-readable scan report and `--json` output. `doctor.md` gets a new audit bullet that reads this field and fixes it via a direct, approved `Edit` (not `apply`, which would duplicate rather than repair — see Task 3). Also fixes the `mergeSettingsHooks` dedup-key fragility this bug exposed.

**Tech Stack:** Node.js ESM (`.mjs`), JSDoc + `tsc --checkJs`, `node:test` + `node:assert/strict`.

**Full design spec:** `docs/superpowers/specs/2026-06-30-hook-placeholder-hygiene-design.md` — read this first for the "why," especially the Non-goals section (auto-fix without consent, fixing via `apply`, and redesigning `mergeSettingsHooks` precedence are all explicitly out of scope).

## Global Constraints

- All source is `.mjs` ESM with JSDoc types — no TypeScript files, no build step.
- `lib/` stays pure and tested; IO lives at the edges. The core placeholder-matching logic must be a pure function (fixture input, no filesystem) so it's directly unit-testable; only the thin wrapper that reads `.claude/settings.json` from disk touches IO.
- Never auto-fix without user consent. `doctor`'s fix step is: show the diff, get approval, then `Edit` — never write without asking.
- Never fix the detected bug via `apply --only=settings`. `mergeSettingsHooks` (`lib/apply.mjs`) dedups hook entries by exact `{command, args}` string identity; a bare and braced form of the same hook are different strings today, so re-applying would add a duplicate hook, not replace the broken one (Task 3 fixes the dedup key, but even after that fix, "existing wins" means the broken value is never repaired by `apply` — repair is `Edit`-only, by design).
- Do not touch `templates/hooks/sql-idempotent-review.mjs` or its test file — unrelated, already-completed work from a different session.
- Match existing per-file conventions exactly: `ROOT`/`FIX` constant derivation via `path.join(path.dirname(fileURLToPath(import.meta.url)), ...)`, no shared test-utils module (small per-file helpers), `node:test` + `node:assert/strict`.
- Run `npm test` (typecheck + lint + unit) before every commit; it must stay green.

---

### Task 1: Detector module + profile typedef + unit tests

**Files:**
- Modify: `lib/profile.mjs` (add typedefs after line 122, add a `ProjectProfile` property after line 161)
- Create: `lib/detect/hook-hygiene.mjs`
- Create: `tests/detect-hook-hygiene.test.mjs`

**Interfaces:**
- Produces: `detectHookPlaceholderIssues(settingsJson: unknown): HookPlaceholderIssue[]` — pure, exported from `lib/detect/hook-hygiene.mjs`. Task 2 does not call this directly (it calls the wrapper below) but Task 4's doctor.md prose describes the shape this produces.
- Produces: `detectHookHygiene(root: string, hasSettings: boolean): HookHygieneInfo` — exported from the same file. Task 2 calls this from `lib/detect/index.mjs`.
- Produces: `HookPlaceholderIssue` and `HookHygieneInfo` typedefs in `lib/profile.mjs`, referenced by both this task's own JSDoc and Task 2's.

- [ ] **Step 1: Add the two typedefs to `lib/profile.mjs`**

Open `lib/profile.mjs`. Find this existing block (ends the `GitHubPMInfo` typedef, right before the `DepEntry` typedef):

```js
/**
 * @typedef {Object} GitHubPMInfo
 * @property {boolean} detected          Remote contains github.com and isGit=true.
 * @property {boolean} hasIssueTemplates .github/ISSUE_TEMPLATE/ path found in file list.
 * @property {boolean} hasWorkflows      .github/workflows/ path found in file list.
 * @property {boolean} hasPmConfig       .claude/pm-config.json found in file list.
 */

/**
 * @typedef {{ name: string, level: 'required'|'recommended' }} DepEntry
 */
```

Insert a new block between them, so it reads:

```js
/**
 * @typedef {Object} GitHubPMInfo
 * @property {boolean} detected          Remote contains github.com and isGit=true.
 * @property {boolean} hasIssueTemplates .github/ISSUE_TEMPLATE/ path found in file list.
 * @property {boolean} hasWorkflows      .github/workflows/ path found in file list.
 * @property {boolean} hasPmConfig       .claude/pm-config.json found in file list.
 */

/**
 * @typedef {Object} HookPlaceholderIssue
 * @property {string} event       Hook event key the offending entry lives under (e.g. "PostToolUse").
 * @property {string} matcher     Matcher string of the group ("" if the group has none, e.g. SessionStart).
 * @property {string} script      Basename of the offending `args` string (its last `/`-separated segment).
 * @property {string} arg         The full offending `args[]` string, verbatim.
 * @property {"CLAUDE_PROJECT_DIR"|"CLAUDE_PLUGIN_ROOT"|"CLAUDE_PLUGIN_DATA"} placeholder
 *   Which path placeholder was found unbraced.
 */

/**
 * @typedef {Object} HookHygieneInfo
 * @property {HookPlaceholderIssue[]} placeholderIssues  Exec-form hook `args` entries using a
 *   bare (unbraced) path placeholder. Exec-form hooks (an `args` array present) bypass the
 *   shell, so Claude Code only substitutes the braced `${VAR}` form — a bare `$VAR` is passed
 *   through literally and `node` throws MODULE_NOT_FOUND resolving it as a relative path.
 */

/**
 * @typedef {{ name: string, level: 'required'|'recommended' }} DepEntry
 */
```

Now find this line inside the `ProjectProfile` typedef:

```js
 * @property {GitHubPMInfo} githubPM        GitHub PM detection results.
```

Add a new line immediately after it:

```js
 * @property {GitHubPMInfo} githubPM        GitHub PM detection results.
 * @property {HookHygieneInfo} hookHygiene  Bare-placeholder hook hygiene results.
```

- [ ] **Step 2: Run typecheck to confirm the typedef additions are valid**

Run: `npm run typecheck`
Expected: no errors (these are additive JSDoc typedefs; nothing consumes `hookHygiene` on `ProjectProfile` yet, so nothing can be inconsistent yet).

- [ ] **Step 3: Write the failing tests for the pure matcher**

Create `tests/detect-hook-hygiene.test.mjs`:

```js
// tests/detect-hook-hygiene.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { detectHookPlaceholderIssues } from "../lib/detect/hook-hygiene.mjs";

test("bare $CLAUDE_PROJECT_DIR in an args element is flagged", () => {
  const settings = {
    hooks: {
      PostToolUse: [
        {
          matcher: "Edit|Write|MultiEdit",
          hooks: [
            {
              type: "command",
              command: "node",
              args: ["$CLAUDE_PROJECT_DIR/.claude/hooks/x.mjs"],
            },
          ],
        },
      ],
    },
  };
  const issues = detectHookPlaceholderIssues(settings);
  assert.equal(issues.length, 1);
  assert.deepEqual(issues[0], {
    event: "PostToolUse",
    matcher: "Edit|Write|MultiEdit",
    script: "x.mjs",
    arg: "$CLAUDE_PROJECT_DIR/.claude/hooks/x.mjs",
    placeholder: "CLAUDE_PROJECT_DIR",
  });
});

test("braced ${CLAUDE_PROJECT_DIR} is not flagged", () => {
  const settings = {
    hooks: {
      PostToolUse: [
        {
          matcher: "*",
          hooks: [{ command: "node", args: ["${CLAUDE_PROJECT_DIR}/.claude/hooks/x.mjs"] }],
        },
      ],
    },
  };
  assert.deepEqual(detectHookPlaceholderIssues(settings), []);
});

test("shell-form hook (command string, no args) is never flagged, even with a bare placeholder", () => {
  const settings = {
    hooks: {
      Stop: [{ hooks: [{ command: '"$CLAUDE_PROJECT_DIR/.claude/hooks/x.mjs"' }] }],
    },
  };
  assert.deepEqual(detectHookPlaceholderIssues(settings), []);
});

test("all three placeholder names are detected individually", () => {
  for (const name of ["CLAUDE_PROJECT_DIR", "CLAUDE_PLUGIN_ROOT", "CLAUDE_PLUGIN_DATA"]) {
    const settings = {
      hooks: { Stop: [{ hooks: [{ command: "node", args: [`$${name}/x.mjs`] }] }] },
    };
    const issues = detectHookPlaceholderIssues(settings);
    assert.equal(issues.length, 1, `expected ${name} to be flagged`);
    assert.equal(issues[0].placeholder, name);
  }
});

test("an unrelated $SOMETHING_ELSE is not flagged (exact name list, not a wildcard)", () => {
  const settings = {
    hooks: { Stop: [{ hooks: [{ command: "node", args: ["$SOMETHING_ELSE/x.mjs"] }] }] },
  };
  assert.deepEqual(detectHookPlaceholderIssues(settings), []);
});

test("multiple issues across different events are all returned, not just the first", () => {
  const settings = {
    hooks: {
      PostToolUse: [
        { matcher: "*", hooks: [{ command: "node", args: ["$CLAUDE_PROJECT_DIR/a.mjs"] }] },
      ],
      Stop: [{ hooks: [{ command: "node", args: ["$CLAUDE_PLUGIN_ROOT/b.mjs"] }] }],
    },
  };
  const issues = detectHookPlaceholderIssues(settings);
  assert.equal(issues.length, 2);
  assert.deepEqual(
    issues.map((i) => i.event).sort(),
    ["PostToolUse", "Stop"],
  );
});

test("malformed or missing input returns an empty array without throwing", () => {
  assert.deepEqual(detectHookPlaceholderIssues({}), []);
  assert.deepEqual(detectHookPlaceholderIssues({ hooks: null }), []);
  assert.deepEqual(detectHookPlaceholderIssues({ hooks: "not an object" }), []);
  assert.deepEqual(detectHookPlaceholderIssues({ hooks: [] }), []);
  assert.deepEqual(detectHookPlaceholderIssues(null), []);
  assert.deepEqual(detectHookPlaceholderIssues(undefined), []);
});
```

- [ ] **Step 4: Run the tests to verify they fail**

Run: `node --test tests/detect-hook-hygiene.test.mjs`
Expected: FAIL — `Cannot find module '../lib/detect/hook-hygiene.mjs'` (the module doesn't exist yet).

- [ ] **Step 5: Implement the pure matcher and the IO wrapper**

Create `lib/detect/hook-hygiene.mjs`:

```js
/**
 * Detect exec-form Claude Code hooks whose `args` reference a bare
 * (unbraced) path placeholder. Exec-form hooks (an `args` array present)
 * spawn without a shell, so Claude Code only substitutes the braced
 * `${VAR}` form into `args` elements — a bare `$VAR` is passed through
 * literally and `node` throws MODULE_NOT_FOUND resolving it as a relative
 * path. (Bare form IS fine in shell-form hooks — a single `command` string
 * with no `args` — since that runs through a real shell, and bash expands
 * `$VAR`/`${VAR}` identically. This module only looks at `args`.)
 * @module detect/hook-hygiene
 */
import path from "node:path";
import { readText } from "../util/fs.mjs";

const PLACEHOLDER_RE = /\$(?!\{)(CLAUDE_PROJECT_DIR|CLAUDE_PLUGIN_ROOT|CLAUDE_PLUGIN_DATA)\b/;

/**
 * Pure: no I/O. Walks an already-parsed settings.json object for exec-form
 * hook `args` entries using a bare path placeholder.
 * @param {unknown} settingsJson
 * @returns {import('../profile.mjs').HookPlaceholderIssue[]}
 */
export function detectHookPlaceholderIssues(settingsJson) {
  /** @type {import('../profile.mjs').HookPlaceholderIssue[]} */
  const issues = [];
  if (!settingsJson || typeof settingsJson !== "object") return issues;
  const hooks = /** @type {{ hooks?: unknown }} */ (settingsJson).hooks;
  if (!hooks || typeof hooks !== "object" || Array.isArray(hooks)) return issues;

  for (const [event, groups] of Object.entries(hooks)) {
    if (!Array.isArray(groups)) continue;
    for (const group of groups) {
      const g = /** @type {{ matcher?: unknown, hooks?: unknown }} */ (group ?? {});
      const matcher = typeof g.matcher === "string" ? g.matcher : "";
      const hookList = Array.isArray(g.hooks) ? g.hooks : [];
      for (const hook of hookList) {
        const h = /** @type {{ args?: unknown }} */ (hook ?? {});
        const args = Array.isArray(h.args) ? h.args : [];
        for (const arg of args) {
          if (typeof arg !== "string") continue;
          const m = arg.match(PLACEHOLDER_RE);
          if (m) {
            issues.push({
              event,
              matcher,
              script: arg.split("/").pop() ?? arg,
              arg,
              placeholder: /** @type {"CLAUDE_PROJECT_DIR"|"CLAUDE_PLUGIN_ROOT"|"CLAUDE_PLUGIN_DATA"} */ (
                m[1]
              ),
            });
          }
        }
      }
    }
  }
  return issues;
}

/**
 * Reads and parses the target project's `.claude/settings.json` (if
 * present) and runs the pure detector above. Fail-open on every I/O or
 * parse error, matching this codebase's existing posture for optional
 * config inspection (e.g. `validate-settings-schema.mjs`).
 * @param {string} root            Absolute project root.
 * @param {boolean} hasSettings    `profile.existingHarness.settings` — avoids a redundant stat.
 * @returns {import('../profile.mjs').HookHygieneInfo}
 */
export function detectHookHygiene(root, hasSettings) {
  if (!hasSettings) return { placeholderIssues: [] };
  const text = readText(path.join(root, ".claude", "settings.json"));
  if (!text) return { placeholderIssues: [] };
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { placeholderIssues: [] };
  }
  return { placeholderIssues: detectHookPlaceholderIssues(parsed) };
}
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `node --test tests/detect-hook-hygiene.test.mjs`
Expected: `pass 7`, `fail 0`.

- [ ] **Step 7: Add wrapper tests (real filesystem, mkdtemp) for `detectHookHygiene`**

Append to `tests/detect-hook-hygiene.test.mjs` (add these imports to the top of the file, alongside the existing ones):

```js
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { detectHookHygiene } from "../lib/detect/hook-hygiene.mjs";
```

Append these tests at the end of the file:

```js
test("detectHookHygiene: hasSettings=false never touches the filesystem, returns empty", () => {
  assert.deepEqual(detectHookHygiene("/nonexistent/path/that/does/not/exist", false), {
    placeholderIssues: [],
  });
});

test("detectHookHygiene: hasSettings=true but file missing → empty (fail-open)", () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "aia-harness-hook-hygiene-"));
  try {
    assert.deepEqual(detectHookHygiene(tmp, true), { placeholderIssues: [] });
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test("detectHookHygiene: malformed JSON → empty, no throw (fail-open)", () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "aia-harness-hook-hygiene-"));
  try {
    fs.mkdirSync(path.join(tmp, ".claude"));
    fs.writeFileSync(path.join(tmp, ".claude", "settings.json"), "{ not json");
    assert.deepEqual(detectHookHygiene(tmp, true), { placeholderIssues: [] });
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test("detectHookHygiene: valid settings.json with a bare placeholder → issue surfaced", () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "aia-harness-hook-hygiene-"));
  try {
    fs.mkdirSync(path.join(tmp, ".claude"));
    fs.writeFileSync(
      path.join(tmp, ".claude", "settings.json"),
      JSON.stringify({
        hooks: {
          Stop: [{ hooks: [{ command: "node", args: ["$CLAUDE_PROJECT_DIR/.claude/hooks/y.mjs"] }] }],
        },
      }),
    );
    const result = detectHookHygiene(tmp, true);
    assert.equal(result.placeholderIssues.length, 1);
    assert.equal(result.placeholderIssues[0].script, "y.mjs");
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});
```

- [ ] **Step 8: Run the full file, then typecheck + lint**

Run: `node --test tests/detect-hook-hygiene.test.mjs`
Expected: `pass 11`, `fail 0`.

Run: `npm run typecheck && npm run lint`
Expected: both clean.

- [ ] **Step 9: Commit**

```bash
git add lib/profile.mjs lib/detect/hook-hygiene.mjs tests/detect-hook-hygiene.test.mjs
git commit -m "feat(detect): add hook-placeholder hygiene detector

Pure detectHookPlaceholderIssues() flags exec-form hook args using a bare
\$CLAUDE_PROJECT_DIR/\$CLAUDE_PLUGIN_ROOT/\$CLAUDE_PLUGIN_DATA instead of the
braced form Claude Code actually expands in exec form (no shell). Not
wired into the scan pipeline yet (Task 2)."
```

---

### Task 2: Wire the detector into `scanProject` + surface in the report

**Files:**
- Modify: `lib/detect/index.mjs`
- Modify: `lib/render.mjs`
- Create: `tests/fixtures/hook-hygiene-project/package.json`
- Create: `tests/fixtures/hook-hygiene-project/.claude/settings.json`
- Modify: `tests/detect-hook-hygiene.test.mjs` (append integration tests)

**Interfaces:**
- Consumes: `detectHookHygiene(root, hasSettings)` from `lib/detect/hook-hygiene.mjs` (Task 1).
- Consumes: `HookHygieneInfo` typedef from `lib/profile.mjs` (Task 1).
- Produces: `profile.hookHygiene` populated on every `scanProject()` result — Task 4's `doctor.md` bullet reads `profile.hookHygiene.placeholderIssues` from `scan --json`.

- [ ] **Step 1: Create the fixture project**

Create `tests/fixtures/hook-hygiene-project/package.json`:

```json
{
  "name": "hook-hygiene-fixture",
  "version": "1.0.0"
}
```

Create `tests/fixtures/hook-hygiene-project/.claude/settings.json`:

```json
{
  "hooks": {
    "PostToolUse": [
      {
        "matcher": "Edit|Write|MultiEdit",
        "hooks": [
          {
            "type": "command",
            "command": "node",
            "args": ["$CLAUDE_PROJECT_DIR/.claude/hooks/example.mjs"]
          }
        ]
      }
    ]
  }
}
```

- [ ] **Step 2: Write the failing integration test**

Append to `tests/detect-hook-hygiene.test.mjs` — add this import at the top alongside the existing ones:

```js
import { fileURLToPath } from "node:url";
import { scanProject } from "../lib/detect/index.mjs";
import { renderReport } from "../lib/render.mjs";
```

Append at the end of the file:

```js
const FIX = path.join(path.dirname(fileURLToPath(import.meta.url)), "fixtures");

test("scanProject surfaces a bare-placeholder issue from a real .claude/settings.json", () => {
  const profile = scanProject(path.join(FIX, "hook-hygiene-project"));
  assert.equal(profile.hookHygiene.placeholderIssues.length, 1);
  assert.equal(profile.hookHygiene.placeholderIssues[0].script, "example.mjs");
});

test("scanProject reports zero issues for a project with no .claude/settings.json", () => {
  const profile = scanProject(path.join(FIX, "js-ts-app"));
  assert.deepEqual(profile.hookHygiene.placeholderIssues, []);
});

test("scan report includes a hook-placeholder warning when issues exist", () => {
  const out = renderReport(scanProject(path.join(FIX, "hook-hygiene-project")));
  assert.match(out, /Hook placeholder hygiene/);
  assert.match(out, /example\.mjs/);
  assert.match(out, /\/aia-harness:doctor/);
});

test("scan report says nothing about hook placeholders when there are none", () => {
  const out = renderReport(scanProject(path.join(FIX, "js-ts-app")));
  assert.doesNotMatch(out, /Hook placeholder hygiene/);
});
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `node --test tests/detect-hook-hygiene.test.mjs`
Expected: FAIL — `profile.hookHygiene` is `undefined` (not wired into `scanProject` yet), and the report assertions fail because `renderReport` doesn't emit the section yet.

- [ ] **Step 4: Wire the detector into `scanProject`**

Open `lib/detect/index.mjs`. Add this import after the existing `detectGitHubPM` import (currently the last import, line 17):

```js
import { detectGitHubPM } from "./github-pm.mjs";
import { detectHookHygiene } from "./hook-hygiene.mjs";
```

Find this block inside the `profile` object literal:

```js
    githubPM: /** @type {import('../profile.mjs').GitHubPMInfo} */ ({
      detected: false,
      hasIssueTemplates: false,
      hasWorkflows: false,
      hasPmConfig: false,
    }),
```

Add a new field immediately after it:

```js
    githubPM: /** @type {import('../profile.mjs').GitHubPMInfo} */ ({
      detected: false,
      hasIssueTemplates: false,
      hasWorkflows: false,
      hasPmConfig: false,
    }),
    hookHygiene: /** @type {import('../profile.mjs').HookHygieneInfo} */ ({
      placeholderIssues: [],
    }),
```

Find this line:

```js
  profile.githubPM = detectGitHubPM(profile, files);
```

Add a new line immediately after it:

```js
  profile.githubPM = detectGitHubPM(profile, files);
  profile.hookHygiene = detectHookHygiene(abs, existingHarness.settings);
```

- [ ] **Step 5: Add the report section to `lib/render.mjs`**

Open `lib/render.mjs`. Find this block (the end of `renderReport`, right before its closing template literal and function brace):

```js
## Existing harness
${existing}
`;
}
```

Replace it with:

```js
## Existing harness
${existing}
${hookHygieneBlock}`;
}
```

Now find where `existing` is computed (just above the `return` statement):

```js
  const eh = profile.existingHarness;
  const existing = [
    `- CLAUDE.md: ${eh.claudeMd ? `yes (${eh.claudeMdFiles.length})` : "no"}`,
    `- settings.json: ${eh.settings ? "yes" : "no"}`,
    `- settings.local.json: ${eh.settingsLocal ? "yes" : "no"}`,
    `- .mcp.json: ${eh.mcp ? "yes" : "no"}`,
    `- hooks: ${eh.hooks ? "yes" : "no"}`,
    `- rules: ${eh.rules ? "yes" : "no"}`,
    `- skills: ${eh.skills.length > 0 ? eh.skills.join(", ") : "no"}`,
  ].join("\n");
```

Add a new block immediately after it:

```js
  const eh = profile.existingHarness;
  const existing = [
    `- CLAUDE.md: ${eh.claudeMd ? `yes (${eh.claudeMdFiles.length})` : "no"}`,
    `- settings.json: ${eh.settings ? "yes" : "no"}`,
    `- settings.local.json: ${eh.settingsLocal ? "yes" : "no"}`,
    `- .mcp.json: ${eh.mcp ? "yes" : "no"}`,
    `- hooks: ${eh.hooks ? "yes" : "no"}`,
    `- rules: ${eh.rules ? "yes" : "no"}`,
    `- skills: ${eh.skills.length > 0 ? eh.skills.join(", ") : "no"}`,
  ].join("\n");

  const hhIssues = profile.hookHygiene.placeholderIssues;
  const hookHygieneBlock =
    hhIssues.length > 0
      ? `\n\n## ⚠ Hook placeholder hygiene\n${hhIssues.length} hook(s) in .claude/settings.json use a bare $VAR instead of \${VAR} — Claude Code only expands the braced form in exec-form hooks (no shell), so these will throw MODULE_NOT_FOUND. Run \`/aia-harness:doctor\` to fix.\n${hhIssues.map((i) => `  - \`${i.script}\` (${i.event}): \`${i.arg}\``).join("\n")}`
      : "";
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `node --test tests/detect-hook-hygiene.test.mjs`
Expected: `pass 15`, `fail 0`.

- [ ] **Step 7: Run the full suite**

Run: `npm test`
Expected: all green. (This wiring touches `lib/detect/index.mjs` and `lib/render.mjs`, both used by many existing tests — confirm nothing else regressed.)

- [ ] **Step 8: Commit**

```bash
git add lib/detect/index.mjs lib/render.mjs tests/fixtures/hook-hygiene-project tests/detect-hook-hygiene.test.mjs
git commit -m "feat(scan): surface hook-placeholder hygiene issues in profile + report

profile.hookHygiene.placeholderIssues is now populated on every scan.
The human-readable report gets a new warning section pointing at
/aia-harness:doctor when issues exist; silent when clean. --json output
carries the field automatically (profile is serialized wholesale)."
```

---

### Task 3: Fix the `mergeSettingsHooks` dedup-key fragility

**Files:**
- Modify: `lib/apply.mjs`
- Modify: `tests/plan-apply.test.mjs`

**Interfaces:**
- Consumes: nothing from Tasks 1-2 — this task is independent (different bug, same root cause family).
- Produces: no new exports; `mergeSettingsHooks`'s existing signature and behavior contract are unchanged except for the dedup-identity fix below.

- [ ] **Step 1: Write the failing test**

Open `tests/plan-apply.test.mjs`. Find this existing test (in the "mergeSettingsHooks — direct unit tests" section):

```js
test("mergeSettingsHooks: duplicate hook entry → appears only once", () => {
  const hook = { command: "node", args: ["dup.mjs"] };
  const groups = [{ matcher: "*", hooks: [hook] }];
  const existing = JSON.stringify({ hooks: { PreToolUse: groups } });
  const incoming = JSON.stringify({ hooks: { PreToolUse: groups } });

  const result = JSON.parse(mergeSettingsHooks(existing, incoming));
  assert.equal(result.hooks.PreToolUse[0].hooks.length, 1);
});
```

Add a new test immediately after it:

```js
test("mergeSettingsHooks: bare vs braced placeholder in args → recognized as same hook, no duplicate", () => {
  const existingHook = { command: "node", args: ["$CLAUDE_PROJECT_DIR/.claude/hooks/x.mjs"] };
  const incomingHook = { command: "node", args: ["${CLAUDE_PROJECT_DIR}/.claude/hooks/x.mjs"] };
  const existing = JSON.stringify({
    hooks: { PostToolUse: [{ matcher: "*", hooks: [existingHook] }] },
  });
  const incoming = JSON.stringify({
    hooks: { PostToolUse: [{ matcher: "*", hooks: [incomingHook] }] },
  });

  const result = JSON.parse(mergeSettingsHooks(existing, incoming));
  const merged = result.hooks.PostToolUse[0].hooks;
  assert.equal(merged.length, 1, "bare and braced forms of the same hook must not both survive");
  assert.deepEqual(
    merged[0],
    existingHook,
    "existing (bare) form still wins the slot — merge only dedups identity, never rewrites values",
  );
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test tests/plan-apply.test.mjs`
Expected: FAIL on the new test — `merged.length` is `2`, not `1` (today's `hookKey` hashes the raw strings, so bare and braced forms are treated as different hooks and both survive).

- [ ] **Step 3: Fix `hookKey` in `lib/apply.mjs`**

Open `lib/apply.mjs`. Find this line inside `mergeSettingsHooks`:

```js
  /** @param {{ command?: unknown, args?: unknown }} h */
  const hookKey = (h) => JSON.stringify({ command: h.command, args: h.args });
```

Replace it with:

```js
  /**
   * Normalizes placeholder bracing for key computation ONLY — the stored
   * hook object (whichever one wins) is never rewritten by this function.
   * A bare $CLAUDE_PROJECT_DIR and a braced ${CLAUDE_PROJECT_DIR} refer to
   * the same hook; without this, a routine re-apply after a placeholder
   * fix would add a duplicate instead of recognizing the hook as already
   * present.
   * @param {unknown} v
   */
  const normalizePlaceholders = (v) =>
    typeof v === "string"
      ? v.replace(/\$(?!\{)(CLAUDE_PROJECT_DIR|CLAUDE_PLUGIN_ROOT|CLAUDE_PLUGIN_DATA)\b/g, "${$1}")
      : v;

  /** @param {{ command?: unknown, args?: unknown }} h */
  const hookKey = (h) =>
    JSON.stringify({
      command: normalizePlaceholders(h.command),
      args: Array.isArray(h.args) ? h.args.map(normalizePlaceholders) : h.args,
    });
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `node --test tests/plan-apply.test.mjs`
Expected: all tests in the file pass, including the new one.

- [ ] **Step 5: Run the full suite**

Run: `npm test`
Expected: all green. `hookKey` is used only inside `mergeSettingsHooks`'s own dedup loop, so this change cannot affect any other code path — but confirm nothing else assumed the old (unnormalized) key shape.

- [ ] **Step 6: Commit**

```bash
git add lib/apply.mjs tests/plan-apply.test.mjs
git commit -m "fix(apply): normalize placeholder bracing in mergeSettingsHooks dedup key

hookKey hashed args verbatim, so a bare \$CLAUDE_PROJECT_DIR and a braced
\${CLAUDE_PROJECT_DIR} form of the same hook were treated as different
hooks — re-applying settings after fixing the placeholder bug would have
added a duplicate instead of recognizing it as already present.
Normalizing bracing in the key (not the stored value) fixes the
false-duplicate-detection without touching existing-wins precedence."
```

---

### Task 4: `doctor.md` audit bullet

**Files:**
- Modify: `commands/doctor.md`

**Interfaces:**
- Consumes: `profile.hookHygiene.placeholderIssues[]` shape from Task 2 (`{ event, matcher, script, arg, placeholder }` per entry) via `scan --json`.

This task is pure prompt/docs — no `lib/` code, no automated test (matches this file's own nature: it's an instruction set interpreted by the agent running `/aia-harness:doctor`, not executable code).

- [ ] **Step 1: Add the new bullet to `commands/doctor.md`**

Open `commands/doctor.md`. Find this existing bullet (it ends right before item `4.` closes step 3's list):

```markdown
   - **Graphify orientation hook (settings.json):** If the plan includes the
     `settings` artifact AND graphify is in the plan (a `tool-skill:graphify`,
     `graphify-orient-hook`, or `graphify-git-hook:` ID is present), verify the target
     `.claude/settings.json` already wires the PreToolUse orientation hook — grep its
     `hooks.PreToolUse` for the marker string `graphify-orient.mjs`. A project init'd
     before this hook existed will have a `settings.json` (so whole-file drift never flags
     it) that is missing the wiring. If the marker is absent, offer to merge it in
     (non-destructive — the merge adds the hook without touching existing settings):

     ```bash
     "${CLAUDE_PLUGIN_ROOT}/bin/aia-harness" apply "${1:-$CLAUDE_PROJECT_DIR}" \
       --yes --only=settings
     ```

     If graphify is not in the plan, skip this check silently.

4. Present a prioritized findings list.
```

Insert a new bullet between the graphify one and item `4.`, so it reads:

```markdown
   - **Graphify orientation hook (settings.json):** If the plan includes the
     `settings` artifact AND graphify is in the plan (a `tool-skill:graphify`,
     `graphify-orient-hook`, or `graphify-git-hook:` ID is present), verify the target
     `.claude/settings.json` already wires the PreToolUse orientation hook — grep its
     `hooks.PreToolUse` for the marker string `graphify-orient.mjs`. A project init'd
     before this hook existed will have a `settings.json` (so whole-file drift never flags
     it) that is missing the wiring. If the marker is absent, offer to merge it in
     (non-destructive — the merge adds the hook without touching existing settings):

     ```bash
     "${CLAUDE_PLUGIN_ROOT}/bin/aia-harness" apply "${1:-$CLAUDE_PROJECT_DIR}" \
       --yes --only=settings
     ```

     If graphify is not in the plan, skip this check silently.

   - **Hook placeholder hygiene (settings.json):** Read `hookHygiene.placeholderIssues`
     from the `scan --json` output (step 1). If empty, say nothing. Otherwise, for each
     entry (`{ event, matcher, script, arg, placeholder }`), explain: exec-form hooks
     (an `args` array) spawn without a shell, so Claude Code only expands the **braced**
     `${placeholder}` form — the bare `$placeholder` currently in `arg` is passed through
     literally and will throw `MODULE_NOT_FOUND`. List every affected `script` with its
     event and the exact `arg` string. Ask the user to approve the fix with
     `AskUserQuestion`, then fix each one with `Edit` directly on `.claude/settings.json`
     — replace `$<placeholder>` with `${<placeholder>}` in that exact `args` string, and
     nothing else on the line. **Do not** fix this with `apply --only=settings`:
     `mergeSettingsHooks` dedups hook entries by exact `{command, args}` string identity,
     so re-applying would add a duplicate hook, not repair the broken one — `Edit` is the
     only correct fix here.

4. Present a prioritized findings list.
```

- [ ] **Step 2: Sanity-check the bullet against a real detection**

There is no automated test for `doctor.md` (it's a prompt, not code — matching every
other bullet in this file). Instead, verify manually that the data this bullet reads
actually exists end-to-end:

```bash
node bin/harness.mjs scan tests/fixtures/hook-hygiene-project --json | node -e '
  let data = "";
  process.stdin.on("data", (d) => (data += d));
  process.stdin.on("end", () => {
    const profile = JSON.parse(data);
    console.log(JSON.stringify(profile.hookHygiene, null, 2));
  });
'
```

Expected output: one issue, `script: "example.mjs"`, `placeholder: "CLAUDE_PROJECT_DIR"`,
`arg` containing the bare form — confirming the exact field path the new bullet reads
(`hookHygiene.placeholderIssues[]`) is real and populated, matching what Task 2 wired up.

- [ ] **Step 3: Run the full suite one final time**

Run: `npm test`
Expected: all green (this task didn't touch any `.mjs` file, so this simply reconfirms
the plan's cumulative state is clean).

- [ ] **Step 4: Commit**

```bash
git add commands/doctor.md
git commit -m "docs(doctor): audit + guided fix for hook-placeholder hygiene

New bullet reads scan's hookHygiene.placeholderIssues and, after user
approval, fixes each bare \$VAR -> \${VAR} via direct Edit — not apply,
which would duplicate the hook rather than repair it (mergeSettingsHooks
dedups by exact args string)."
```
