/**
 * GitHub PM pillar smoke check — pure health-report logic.
 *
 * The pillar's own /aia-harness:add-github-pm command used to declare success
 * purely from artifact `exists` flags: every file present meant "already
 * fully installed". Existence is not functionality — a project can have all
 * 8 artifacts on disk and still move zero board items, because
 * .claude/pm-config.json is still full of REPLACE_ME placeholders, or was
 * never committed (GitHub Actions checks out committed files only), or the
 * installed workflow copies are an older, unpatched version whose status
 * names no longer match the config. Every check in this module is read-only
 * diagnosis: nothing here mutates a board, opens an issue, or writes a file.
 *
 * Pure by design: every function here takes already-read inputs (file text,
 * a pre-computed git-tracked status, a pre-computed `gh` auth/secrets
 * result) and returns plain data. IO — reading pm-config.json and the
 * installed workflow files, invoking `git`/`gh` — happens at the edge
 * (bin/harness.mjs's `pm-check` command, lib/detect/git-track-status.mjs,
 * lib/detect/gh-auth.mjs), exactly like the rest of this engine.
 *
 * Duplication note (deliberate): this module re-implements the stub-loop
 * detection signals (STUB_MARKERS, findStubMarkerComments,
 * findEchoOnlyLoopBodies) that already exist in
 * tests/github-pm-workflows-stub-guard.test.mjs, rather than importing them.
 * Two independent reasons, not just the obvious one:
 *   1. That test file's YAML walk (tests/gha-run-steps.mjs) depends on
 *      js-yaml, a devDependency forbidden inside lib/ — lib/ is reachable
 *      from bin/harness.mjs, which runs inside an installed plugin copy with
 *      no node_modules (root CLAUDE.md's "lib/ is pure and tested" rule).
 *      The marker/echo-detection functions themselves need no YAML parser
 *      (they scan a plain bash string), so only extractRunBlocks below had
 *      to be reinvented — a narrow, line-based scanner instead of a real
 *      YAML parser, sufficient for the `run: |`/`run: >`/single-line shapes
 *      GitHub Actions YAML actually uses.
 *   2. The two checks are not really the same check pointed at different
 *      directories. tests/github-pm-workflows-stub-guard.test.mjs is a
 *      regression guard over templates/github/** in THIS repo — content this
 *      project fully controls, checked at HEAD. This module inspects
 *      *installed copies* in an arbitrary target project, which may predate
 *      this repo's current templates by many versions. If this repo's own
 *      dev-process marker vocabulary ever needs to change, that is not
 *      automatically correct for the historical defect shapes this check
 *      exists to catch in the wild — so keeping them independently editable
 *      is the more correct outcome, not just the path of least resistance.
 *
 * @module pm-check
 */

/**
 * Placeholder strings the shipped pm-config.json.template seeds
 * (templates/github/pm-config.json.template). Any survivor in an installed
 * copy means /pm:setup-project was never run to completion — the config
 * "exists" but is not real.
 * @type {readonly string[]}
 */
export const PM_CONFIG_PLACEHOLDERS = Object.freeze([
  "PVT_REPLACE_ME",
  "PVTSSF_REPLACE_ME",
  "REPLACE_ME_OPTION_ID",
  "YOUR_ORG_OR_USER",
  "YOUR_REPO_NAME",
]);

/**
 * @typedef {Object} GitTrackStatus
 * @property {boolean} isGitRepo
 * @property {boolean} tracked
 * @property {boolean} ignored
 */

/**
 * @typedef {Object} PmCheckResult
 * @property {string} id
 * @property {boolean} blocking  Whether this check's *category* is blocking (the pillar
 *   provably cannot work) vs advisory (misconfiguration hint, or unverifiable in this
 *   environment) — a fixed property of the check id, per the task's own classification,
 *   not a per-run outcome. A "warn" status never makes the report unhealthy regardless of
 *   this flag; it only matters when status is "fail".
 * @property {"pass"|"fail"|"warn"} status
 * @property {string} message
 * @property {string|null} remedy
 */

/**
 * @typedef {Object} PmHealthReport
 * @property {boolean} healthy  False when any blocking check has status "fail".
 * @property {PmCheckResult[]} checks
 */

/**
 * @typedef {Object} WorkflowFile
 * @property {string} name     Basename, e.g. "commit-to-progress.yml".
 * @property {string} content  Raw file text.
 */

/**
 * @typedef {Object} PmCheckInput
 * @property {string|null} configRaw   Raw text of .claude/pm-config.json, or null when
 *   missing or unreadable.
 * @property {any} configParsed        JSON.parse(configRaw) result, or null when missing
 *   or invalid JSON.
 * @property {GitTrackStatus} gitStatus
 * @property {WorkflowFile[]} workflowFiles  Installed .github/workflows/*.yml files.
 * @property {import('./detect/gh-auth.mjs').GhAuthCheck | null} ghAuth  null when the `gh`
 *   binary itself could not be found.
 * @property {string[] | null} secretNames  Repo Actions secret names from `gh secret list`,
 *   or null when that could not be determined (gh missing/unauthenticated/errored).
 */

// ── Check 1: pm-config.json exists ──────────────────────────────────────

/**
 * @param {boolean} configExists
 * @returns {PmCheckResult}
 */
export function checkConfigExists(configExists) {
  const id = "config-exists";
  if (!configExists) {
    return {
      id,
      blocking: true,
      status: "fail",
      message: ".claude/pm-config.json is missing.",
      remedy: "Run /pm:setup-project to generate and populate it.",
    };
  }
  return {
    id,
    blocking: true,
    status: "pass",
    message: ".claude/pm-config.json exists.",
    remedy: null,
  };
}

// ── Check 2: no leftover placeholders ───────────────────────────────────

/**
 * @param {string|null} configRaw
 * @returns {PmCheckResult}
 */
export function checkNoPlaceholders(configRaw) {
  const id = "no-placeholders";
  if (configRaw == null) {
    return {
      id,
      blocking: true,
      status: "warn",
      message:
        "Cannot check for placeholders — .claude/pm-config.json is missing (see config-exists).",
      remedy: null,
    };
  }
  const found = PM_CONFIG_PLACEHOLDERS.filter((p) => configRaw.includes(p));
  if (found.length > 0) {
    return {
      id,
      blocking: true,
      status: "fail",
      message: `.claude/pm-config.json still has unfilled placeholder(s): ${found.join(", ")}.`,
      remedy:
        "Run /pm:setup-project to replace every placeholder with the real IDs from your GitHub project.",
    };
  }
  return {
    id,
    blocking: true,
    status: "pass",
    message: "No leftover placeholders in .claude/pm-config.json.",
    remedy: null,
  };
}

// ── Check 3: pm-config.json is tracked by git ───────────────────────────

/**
 * @param {boolean} configExists
 * @param {GitTrackStatus} gitStatus
 * @returns {PmCheckResult}
 */
export function checkConfigTracked(configExists, gitStatus) {
  const id = "config-tracked";
  if (!configExists) {
    return {
      id,
      blocking: true,
      status: "warn",
      message: "Cannot check git tracking — .claude/pm-config.json is missing (see config-exists).",
      remedy: null,
    };
  }
  if (!gitStatus.isGitRepo) {
    return {
      id,
      blocking: true,
      status: "warn",
      message:
        "Not a git repository (or git could not be run) — cannot verify pm-config.json will reach CI.",
      remedy: null,
    };
  }
  if (gitStatus.ignored || !gitStatus.tracked) {
    return {
      id,
      blocking: true,
      status: "fail",
      message:
        `pm-config.json is ${gitStatus.ignored ? "gitignored" : "not tracked by git"} — GitHub ` +
        'Actions checks out committed files only, so every workflow\'s "config missing" fallback ' +
        "will silently fire on every run: a green CI run that moves nothing.",
      remedy:
        "Remove any .gitignore entry matching .claude/pm-config.json, then run: " +
        "git add .claude/pm-config.json && git commit",
    };
  }
  return {
    id,
    blocking: true,
    status: "pass",
    message: "pm-config.json is tracked by git.",
    remedy: null,
  };
}

// ── Check 4: status names agree between pm-config.json and the workflows ──

/**
 * Extracts every `target-status:`/`guard-statuses:` value from a workflow's
 * raw YAML text — the exact strings the composite action looks up as
 * `status_options` keys at runtime. Deliberately a flat, line-based regex
 * scan rather than a YAML parser: both keys only ever appear as single-line
 * scalars under a step's `with:` block in every workflow this plugin has
 * ever generated, so a full parse buys nothing a line scan doesn't already
 * get right, and keeps this module js-yaml-free (see module docstring).
 * @param {string} yamlText
 * @returns {{ line: number, key: "target-status"|"guard-statuses", value: string }[]}
 */
export function extractStatusUsage(yamlText) {
  const lines = yamlText.split(/\r?\n/);
  /** @type {{ line: number, key: "target-status"|"guard-statuses", value: string }[]} */
  const usages = [];
  lines.forEach((line, idx) => {
    const target = /^\s*target-status:\s*(.+?)\s*$/.exec(line);
    if (target)
      usages.push({ line: idx + 1, key: "target-status", value: stripYamlQuotes(target[1]) });

    const guard = /^\s*guard-statuses:\s*(.+?)\s*$/.exec(line);
    if (guard) {
      const raw = stripYamlQuotes(guard[1]);
      for (const part of raw.split(",")) {
        const value = part.trim();
        if (value) usages.push({ line: idx + 1, key: "guard-statuses", value });
      }
    }
  });
  return usages;
}

/**
 * @param {string} s
 * @returns {string}
 */
function stripYamlQuotes(s) {
  const t = s.trim();
  if (t.length >= 2 && ((t[0] === '"' && t.endsWith('"')) || (t[0] === "'" && t.endsWith("'")))) {
    return t.slice(1, -1);
  }
  return t;
}

/**
 * @param {Set<string>|null} statusOptionKeys  Keys of pm-config.json's status_options, or
 *   null when the config is missing or its status_options is not a usable object.
 * @param {WorkflowFile[]} workflowFiles
 * @returns {PmCheckResult}
 */
export function checkStatusNamesAgree(statusOptionKeys, workflowFiles) {
  const id = "status-names-agree";
  if (!statusOptionKeys) {
    return {
      id,
      blocking: true,
      status: "warn",
      message:
        "Cannot check status names — pm-config.json is missing or its status_options is invalid.",
      remedy: null,
    };
  }
  if (!workflowFiles || workflowFiles.length === 0) {
    return {
      id,
      blocking: true,
      status: "warn",
      message: "No installed workflows found under .github/workflows — nothing to check.",
      remedy: null,
    };
  }

  /** @type {string[]} */
  const failures = [];
  for (const { name, content } of workflowFiles) {
    for (const usage of extractStatusUsage(content)) {
      // A dynamic GitHub Actions expression (e.g. ${{ matrix.status }}) is resolved at
      // runtime, not statically — this plugin's own generated workflows never do this,
      // but a hand-edited installed copy might, and flagging it would be a false positive.
      if (usage.value.includes("${{")) continue;
      if (!statusOptionKeys.has(usage.value)) {
        failures.push(
          `${name}:${usage.line}: ${usage.key} "${usage.value}" is not a status_options key`,
        );
      }
    }
  }

  if (failures.length > 0) {
    return {
      id,
      blocking: true,
      status: "fail",
      message: failures.join(" | "),
      remedy:
        "Add the missing key(s) to status_options in .claude/pm-config.json, matching the " +
        "canonical 8-state lifecycle: Triage, Backlog, Todo, Ready, In Progress, In Review, Blocked, Done.",
    };
  }
  return {
    id,
    blocking: true,
    status: "pass",
    message:
      "Every target-status/guard-statuses value used by the installed workflows exists in status_options.",
    remedy: null,
  };
}

// ── Check 5: installed workflows are not stub loops ─────────────────────

/** @type {{ name: string, re: RegExp }[]} */
const STUB_MARKERS = [
  { name: "TODO", re: /\bTODO\b/i },
  { name: "FIXME", re: /\bFIXME\b/i },
  { name: "see ... for (the) pattern", re: /see .* for (the )?pattern/i },
  { name: "same pattern as", re: /same pattern as/i },
  { name: "implement ... here", re: /implement .* here/i },
];

/**
 * Given the index of the `$` that opens a `$( ... )` command substitution,
 * returns the index immediately after its matching `)`. Quote-aware,
 * recurses into further nesting. Ported from
 * tests/github-pm-workflows-stub-guard.test.mjs's skipSubstitutionLocal —
 * see this module's docstring for why it is duplicated rather than shared.
 * @param {string} text
 * @param {number} openIdx
 * @returns {number}
 */
function skipSubstitution(text, openIdx) {
  const n = text.length;
  let i = openIdx + 2;
  let depth = 1;
  /** @type {"'" | '"' | null} */
  let quote = null;
  while (i < n && depth > 0) {
    const c = text[i];
    if (quote === "'") {
      if (c === "'") quote = null;
      i++;
      continue;
    }
    if (quote === '"') {
      if (c === "\\") {
        i += 2;
        continue;
      }
      if (c === '"') {
        quote = null;
        i++;
        continue;
      }
      if (c === "$" && text[i + 1] === "(") {
        i = skipSubstitution(text, i);
        continue;
      }
      i++;
      continue;
    }
    if (c === "\\") {
      i += 2;
      continue;
    }
    if (c === "'") {
      quote = "'";
      i++;
      continue;
    }
    if (c === '"') {
      quote = '"';
      i++;
      continue;
    }
    if (c === "$" && text[i + 1] === "(") {
      i = skipSubstitution(text, i);
      continue;
    }
    if (c === "(") {
      depth++;
      i++;
      continue;
    }
    if (c === ")") {
      depth--;
      i++;
      continue;
    }
    i++;
  }
  return i;
}

/**
 * Extracts every unquoted `#...` comment from a bash script body. Ported
 * from tests/github-pm-workflows-stub-guard.test.mjs's extractComments.
 * @param {string} body
 * @returns {{ text: string }[]}
 */
function extractComments(body) {
  /** @type {{ text: string }[]} */
  const comments = [];
  const n = body.length;
  let i = 0;
  /** @type {"'" | '"' | null} */
  let quote = null;
  while (i < n) {
    const c = body[i];
    if (quote === "'") {
      if (c === "'") quote = null;
      i++;
      continue;
    }
    if (quote === '"') {
      if (c === "\\") {
        i += 2;
        continue;
      }
      if (c === '"') {
        quote = null;
        i++;
        continue;
      }
      if (c === "$" && body[i + 1] === "(") {
        i = skipSubstitution(body, i);
        continue;
      }
      i++;
      continue;
    }
    if (c === "\\") {
      i += 2;
      continue;
    }
    if (c === "'") {
      quote = "'";
      i++;
      continue;
    }
    if (c === '"') {
      quote = '"';
      i++;
      continue;
    }
    if (c === "$" && body[i + 1] === "(") {
      i = skipSubstitution(body, i);
      continue;
    }
    if (c === "#") {
      let j = i;
      while (j < n && body[j] !== "\n") j++;
      comments.push({ text: body.slice(i, j) });
      i = j;
      continue;
    }
    i++;
  }
  return comments;
}

/**
 * @param {string} body
 * @returns {{ comment: string, marker: string }[]}
 */
export function findStubMarkerComments(body) {
  /** @type {{ comment: string, marker: string }[]} */
  const hits = [];
  for (const { text } of extractComments(body)) {
    for (const marker of STUB_MARKERS) {
      if (marker.re.test(text)) {
        hits.push({ comment: text.trim(), marker: marker.name });
        break;
      }
    }
  }
  return hits;
}

/**
 * @param {string} body
 * @returns {{ loopBody: string }[]}
 */
export function findEchoOnlyLoopBodies(body) {
  /** @type {{ loopBody: string }[]} */
  const hits = [];
  const re = /\bdo\b([\s\S]*?)\bdone\b/g;
  let m;
  while ((m = re.exec(body)) !== null) {
    const loopBody = m[1];
    const statementLines = loopBody
      .split("\n")
      .map((l) => l.trim())
      .filter((l) => l.length > 0 && !l.startsWith("#"));
    if (statementLines.length > 0 && statementLines.every((l) => /^echo\b/.test(l))) {
      hits.push({ loopBody: loopBody.trim() });
    }
  }
  return hits;
}

/**
 * Extracts every `run:` step body from a workflow/composite-action YAML file
 * without a real YAML parser (js-yaml is forbidden in lib/ — see module
 * docstring). Understands exactly the two `run:` shapes GitHub Actions YAML
 * uses: a block scalar (`run: |`, `run: >`, with an optional `-`/`+` chomping
 * indicator) whose body is every following line indented deeper than the
 * `run:` key itself, and a single-line `run: <command>`. Not a general YAML
 * parser — no anchors, flow style, or multi-document files — sufficient for
 * installed copies of this plugin's own generated workflows.
 * @param {string} yamlText
 * @returns {string[]}
 */
export function extractRunBlocks(yamlText) {
  const lines = yamlText.split(/\r?\n/);
  /** @type {string[]} */
  const blocks = [];
  for (let i = 0; i < lines.length; i++) {
    const blockStart = /^(\s*)run:\s*[|>][-+]?\s*$/.exec(lines[i]);
    if (blockStart) {
      const indent = blockStart[1].length;
      /** @type {string[]} */
      const body = [];
      let j = i + 1;
      for (; j < lines.length; j++) {
        const line = lines[j];
        if (line.trim() === "") {
          body.push("");
          continue;
        }
        const lineIndent = line.length - line.trimStart().length;
        if (lineIndent <= indent) break;
        body.push(line);
      }
      blocks.push(body.join("\n"));
      i = j - 1;
      continue;
    }
    const singleLine = /^\s*run:\s*(.+)$/.exec(lines[i]);
    if (singleLine) blocks.push(singleLine[1]);
  }
  return blocks;
}

/**
 * @param {string} yamlText
 * @returns {string[]}
 */
function findStubIssuesInText(yamlText) {
  /** @type {string[]} */
  const issues = [];
  for (const block of extractRunBlocks(yamlText)) {
    for (const hit of findStubMarkerComments(block)) {
      issues.push(`comment "${hit.comment}" looks like a leftover placeholder (${hit.marker})`);
    }
    for (const hit of findEchoOnlyLoopBodies(block)) {
      const firstLine = hit.loopBody.split("\n")[0];
      issues.push(`a loop body only echoes and never mutates anything (e.g. "${firstLine}")`);
    }
  }
  return issues;
}

/**
 * @param {WorkflowFile[]} workflowFiles
 * @returns {PmCheckResult}
 */
export function checkWorkflowsNotStubs(workflowFiles) {
  const id = "workflows-not-stubs";
  if (!workflowFiles || workflowFiles.length === 0) {
    return {
      id,
      blocking: true,
      status: "warn",
      message: "No installed workflows found under .github/workflows — nothing to check.",
      remedy: null,
    };
  }

  /** @type {string[]} */
  const issues = [];
  for (const { name, content } of workflowFiles) {
    for (const issue of findStubIssuesInText(content)) issues.push(`${name}: ${issue}`);
  }

  if (issues.length > 0) {
    return {
      id,
      blocking: true,
      status: "fail",
      message: issues.join(" | "),
      remedy:
        "Reinstall the github-pm workflows: run /aia-harness:patch and select the github-pm " +
        "category to get the current, non-stub versions.",
    };
  }
  return {
    id,
    blocking: true,
    status: "pass",
    message: "No stub loops or placeholder comments found in installed workflows.",
    remedy: null,
  };
}

// ── Check 6: PROJECTS_PAT repo secret exists (advisory when unverifiable) ──

/**
 * @param {import('./detect/gh-auth.mjs').GhAuthCheck | null} ghAuth
 * @param {string[] | null} secretNames
 * @returns {PmCheckResult}
 */
export function checkPatSecretExists(ghAuth, secretNames) {
  const id = "pat-secret-exists";
  if (!ghAuth || !ghAuth.available) {
    return {
      id,
      blocking: true,
      status: "warn",
      message:
        "gh is not installed or could not be run — cannot verify the PROJECTS_PAT secret exists.",
      remedy: null,
    };
  }
  if (ghAuth.envTokenOverride) {
    return {
      id,
      blocking: true,
      status: "warn",
      message:
        "GH_TOKEN/GITHUB_TOKEN is set — cannot reliably verify secret access under this override.",
      remedy: "unset GH_TOKEN GITHUB_TOKEN, then re-run this check.",
    };
  }
  if (!ghAuth.authenticated) {
    return {
      id,
      blocking: true,
      status: "warn",
      message: "gh is not logged in — cannot verify the PROJECTS_PAT secret exists.",
      remedy: "gh auth login",
    };
  }
  if (secretNames == null) {
    return {
      id,
      blocking: true,
      status: "warn",
      message:
        "Could not list repo secrets via gh (missing admin access, no resolvable GitHub remote, " +
        "or a network error) — cannot verify PROJECTS_PAT exists.",
      remedy: "Confirm you have admin access to the repo, then run: gh secret list",
    };
  }
  if (!secretNames.includes("PROJECTS_PAT")) {
    return {
      id,
      blocking: true,
      status: "fail",
      message:
        "PROJECTS_PAT repo secret is missing — every github-pm workflow will silently no-op.",
      remedy: "gh secret set PROJECTS_PAT --repo <owner>/<repo>",
    };
  }
  return {
    id,
    blocking: true,
    status: "pass",
    message: "PROJECTS_PAT secret is present.",
    remedy: null,
  };
}

// ── Check 7: gh token carries the project scope (always advisory) ───────

/**
 * Always advisory, even when gh is authenticated and the scope is
 * confirmed missing — unlike check 6, this can never be "provably
 * blocking": PROJECTS_PAT is a repo secret that may have been minted by an
 * entirely different token than the one the local `gh` login carries, so
 * this local scope check is informative (it may explain a failure of a
 * `/pm:*` command run locally) but never dispositive about whether the
 * secret Actions actually uses is broken.
 * @param {import('./detect/gh-auth.mjs').GhAuthCheck | null} ghAuth
 * @returns {PmCheckResult}
 */
export function checkGhScope(ghAuth) {
  const id = "gh-token-project-scope";
  if (!ghAuth || !ghAuth.available) {
    return {
      id,
      blocking: false,
      status: "warn",
      message: "gh is not installed or could not be run — cannot verify the token's OAuth scopes.",
      remedy: null,
    };
  }
  if (ghAuth.envTokenOverride) {
    return {
      id,
      blocking: false,
      status: "warn",
      message:
        "GH_TOKEN/GITHUB_TOKEN is set — its scopes apply instead of the keyring account's, so this cannot be verified reliably.",
      remedy:
        "unset GH_TOKEN GITHUB_TOKEN to fall back to the OAuth login, then re-run this check.",
    };
  }
  if (!ghAuth.authenticated) {
    return {
      id,
      blocking: false,
      status: "warn",
      message: "gh is not logged in to any host.",
      remedy: `gh auth login -h github.com -s ${ghAuth.missing.join(",")}`,
    };
  }
  if (ghAuth.missing.length > 0) {
    return {
      id,
      blocking: false,
      status: "warn",
      message:
        `Local gh token is missing scope(s): ${ghAuth.missing.join(", ")}. This does not by itself ` +
        "confirm PROJECTS_PAT is broken — that secret can carry a different token entirely — but any " +
        "/pm:* command you run locally with this login may fail.",
      remedy: ghAuth.refreshCmd,
    };
  }
  return {
    id,
    blocking: false,
    status: "pass",
    message: "gh token carries the required scopes.",
    remedy: null,
  };
}

// ── Aggregate ─────────────────────────────────────────────────────────

/**
 * @param {PmCheckInput} input
 * @returns {PmHealthReport}
 */
export function buildPmHealthReport(input) {
  const configExists = input.configRaw != null;
  const statusOptionKeys =
    input.configParsed &&
    typeof input.configParsed.status_options === "object" &&
    input.configParsed.status_options !== null
      ? new Set(Object.keys(input.configParsed.status_options))
      : null;

  const checks = [
    checkConfigExists(configExists),
    checkNoPlaceholders(input.configRaw),
    checkConfigTracked(configExists, input.gitStatus),
    checkStatusNamesAgree(statusOptionKeys, input.workflowFiles),
    checkWorkflowsNotStubs(input.workflowFiles),
    checkPatSecretExists(input.ghAuth, input.secretNames),
    checkGhScope(input.ghAuth),
  ];

  return {
    healthy: !checks.some((c) => c.blocking && c.status === "fail"),
    checks,
  };
}
