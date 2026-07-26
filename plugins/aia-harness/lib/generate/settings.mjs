/**
 * Generate `.claude/settings.json` (committed) and `.claude/settings.local.json`
 * (gitignored). Least-privilege permissions + JS hook wiring via the node wrapper.
 *
 * @module generate/settings
 */

/** @typedef {import('../profile.mjs').ProjectProfile} ProjectProfile */

/**
 * Build a least-privilege allow pattern from a command string.
 * Takes the command prefix up to the first flag/argument.
 * @param {string} cmd
 * @returns {string|null}
 */
export function permPrefix(cmd) {
  const tokens = cmd.trim().split(/\s+/);
  /** @type {string[]} */
  const head = [];
  for (const t of tokens) {
    if (t.startsWith("-") || t === ".") break;
    head.push(t);
    if (head.length >= 3) break;
  }
  if (head.length === 0) return null;
  return `Bash(${head.join(" ")}:*)`;
}

/**
 * Hook command object invoking node directly (exec form — no shell required).
 * Spread into the hook entry: { type: "command", ...hookCmd(script), timeout }.
 * @param {string} script
 * @returns {{ command: string, args: string[] }}
 */
function hookCmd(script) {
  const dir = "${CLAUDE_PROJECT_DIR}/.claude/hooks";
  return { command: "node", args: [`${dir}/${script}`] };
}

/**
 * GitHub-sourced `extraKnownMarketplaces` entry.
 * @param {string} repo  "owner/repo"
 * @returns {{ source: { source: "github", repo: string } }}
 */
function ghMarketplace(repo) {
  return { source: { source: "github", repo } };
}

/**
 * @param {ProjectProfile} profile
 * @param {Record<string, any[]>} [extraHooks]  Additional hook entries to merge by event (e.g. tool hooks).
 * @param {{ strict?: boolean, largeFiles?: "block"|"advisory" }} [opts]
 *   `largeFiles` selects the large-file guard wiring: `block` (Stop, refactor
 *   before finishing) or `advisory` (PostToolUse, suggest + confirm). Defaults
 *   to `advisory` — the legacy-safe choice when a caller doesn't decide.
 * @returns {string}
 */
export function renderSettings(profile, extraHooks = {}, opts = {}) {
  const c = profile.commands;
  /** @type {Set<string>} */
  const allow = new Set();
  for (const cmd of [c.install, c.lint, c.format, c.typecheck, c.test, c.build, c.run]) {
    if (!cmd) continue;
    const p = permPrefix(cmd);
    if (p) allow.add(p);
  }
  for (const g of [
    "git status",
    "git diff",
    "git add",
    "git commit",
    "git push",
    "git pull",
    "git fetch",
    "git checkout",
    "git switch",
    "git branch",
    "git log",
    "git stash",
    "git reset",
    "git merge",
    "git rebase",
    "git tag",
  ])
    allow.add(`Bash(${g}:*)`);

  // Defense-in-depth for sessionScratchDir()'s fallback path (used when the
  // real Claude Code scratchpad can't be located — see
  // templates/hooks/session-scratch.mjs and .claude/rules/hooks-cross-platform.md).
  // The primary fix is resolving the pre-authorized scratchpad itself; this
  // covers the degraded case so it still never interrupts the session.
  for (const p of [
    "Write(//private/tmp/**)",
    "Edit(//private/tmp/**)",
    "Write(//tmp/**)",
    "Edit(//tmp/**)",
  ])
    allow.add(p);

  /** @type {Record<string, any[]>} */
  const hooks = {
    PreToolUse: [
      {
        matcher: "Bash",
        hooks: [{ type: "command", ...hookCmd("guard-main-branch.mjs"), timeout: 10 }],
      },
      {
        matcher: "Agent",
        hooks: [{ type: "command", ...hookCmd("subagent-model-guard.mjs"), timeout: 10 }],
      },
      {
        // secret-scan blocks secrets before they land; worktree-write-guard asks
        // for confirmation when the target file is outside the active worktree.
        matcher: "Edit|Write|MultiEdit",
        hooks: [
          { type: "command", ...hookCmd("secret-scan.mjs"), timeout: 10 },
          { type: "command", ...hookCmd("worktree-write-guard.mjs"), timeout: 10 },
        ],
      },
    ],
    PostToolUse: [
      {
        matcher: "Edit|Write|MultiEdit",
        hooks: [
          { type: "command", ...hookCmd("format-on-edit.mjs"), timeout: 60 },
          { type: "command", ...hookCmd("set-files-changed.mjs"), timeout: 30 },
          { type: "command", ...hookCmd("sql-idempotent-review.mjs"), timeout: 10 },
          { type: "command", ...hookCmd("validate-settings-schema.mjs"), timeout: 30 },
        ],
      },
      {
        // Idempotent re-seed safety net: fires on every EnterWorktree call,
        // including entry into a worktree that already existed before this
        // hook was configured. worktree-create.mjs stays silent on this path.
        matcher: "EnterWorktree",
        hooks: [{ type: "command", ...hookCmd("worktree-create.mjs"), timeout: 60 }],
      },
    ],
    SessionStart: [
      {
        // Check system deps at session start; injects additionalContext when missing.
        // Also inject active worktree path (from event.cwd) into the main session.
        hooks: [
          { type: "command", ...hookCmd("check-deps-on-start.mjs"), timeout: 30 },
          { type: "command", ...hookCmd("worktree-session-ctx.mjs"), timeout: 10 },
        ],
      },
    ],
    UserPromptSubmit: [
      {
        // Reinject compact worktree reminder on every prompt (post-compaction recovery);
        // orchestration-mode injects the standing delegate/parallelize directive.
        hooks: [
          { type: "command", ...hookCmd("worktree-prompt-ctx.mjs"), timeout: 10 },
          { type: "command", ...hookCmd("orchestration-mode.mjs"), timeout: 10 },
        ],
      },
    ],
    SubagentStart: [
      {
        // Inject active worktree path (from event.cwd) into every subagent.
        hooks: [{ type: "command", ...hookCmd("worktree-subagent-ctx.mjs"), timeout: 10 }],
      },
    ],
    Stop: [
      {
        hooks: [
          { type: "command", ...hookCmd("verify-on-stop.mjs"), timeout: 300 },
          { type: "command", ...hookCmd("memory-stop.mjs"), timeout: 30 },
          { type: "command", ...hookCmd("sql-idempotent-review.mjs"), timeout: 15 },
        ],
      },
    ],
    // Replaces Claude Code's native `git worktree add` entirely once configured
    // (also disables native .worktreeinclude processing — worktree-create.mjs
    // reimplements that copy). Must print the created worktree's absolute path
    // as a bare string on stdout (command-hook contract, not JSON).
    WorktreeCreate: [
      { hooks: [{ type: "command", ...hookCmd("worktree-create.mjs"), timeout: 30 }] },
    ],
    // Replaces Claude Code's native worktree cleanup. Removes the worktree
    // checkout only — never deletes the branch (destructive, out of scope).
    WorktreeRemove: [
      { hooks: [{ type: "command", ...hookCmd("worktree-remove.mjs"), timeout: 15 }] },
    ],
  };

  // Large-file guard: one hook script, two wirings chosen by mode. `block` runs
  // it at Stop (refactor before finishing — greenfield born strict); `advisory`
  // (default) runs it on PostToolUse against the just-edited file (suggest +
  // confirm — legacy-safe). The hook branches on hook_event_name accordingly.
  const lfHook = {
    type: /** @type {const} */ ("command"),
    ...hookCmd("large-file-warning.mjs"),
    timeout: 30,
  };
  if (opts.largeFiles === "block") {
    hooks.Stop[0].hooks.push(lfHook);
  } else {
    hooks.PostToolUse[0].hooks.push(lfHook);
  }

  // Merge extra hooks by matcher, not by naive concat: a tool hook sharing a
  // matcher with a base group (e.g. rtk and graphify both match "Bash") folds
  // into that one group instead of creating a second same-matcher group. This
  // keeps apply.mjs mergeSettingsJson — which collapses by first matching
  // matcher — idempotent on re-apply (a duplicate matcher group would otherwise
  // get the same hook merged into two places).
  for (const [event, entries] of Object.entries(extraHooks)) {
    const base = hooks[event] ?? [];
    for (const grp of entries) {
      const m = grp.matcher ?? "";
      const i = base.findIndex((g) => (g.matcher ?? "") === m);
      if (i === -1) {
        base.push(grp);
      } else {
        base[i] = { ...base[i], hooks: [...(base[i].hooks ?? []), ...(grp.hooks ?? [])] };
      }
    }
    hooks[event] = base;
  }

  const settings = {
    $schema: "https://json.schemastore.org/claude-code-settings.json",
    // Default model: Opus for planning, Sonnet for execution.
    model: "opusplan",
    // Default reasoning effort to MAX. `effortLevel` in settings.json only
    // persists up to "xhigh"; `max` is session-only, so it's set via the env
    // var Claude Code reads for the same purpose.
    env: {
      CLAUDE_CODE_EFFORT_LEVEL: "max",
      CLAUDE_CODE_DISABLE_ADAPTIVE_THINKING: "1",
      CAVEMAN_DEFAULT_MODE: "ultra",
      // Works around a documented, unfixed Claude Code CLI bug: the Bash
      // tool's cwd persists across tool calls within a session, and once an
      // earlier call `cd`s elsewhere, `$CLAUDE_PROJECT_DIR` resolves wrong
      // for every hook subprocess spawned afterward (upstream issues #50960,
      // #33815, #27343, #36360, #22343, #6023 — closed not-planned/duplicate
      // as of v2.1.113+). This resets the Bash tool's cwd to the project
      // root after every command, fixing the drift at its source. Value must
      // stay the string "1" — the official schema's enum is ["0","1"].
      CLAUDE_BASH_MAINTAIN_PROJECT_WORKING_DIR: "1",
    },
    showClearContextOnPlanAccept: true,
    autoMemoryEnabled: true,
    skipDangerousModePermissionPrompt: true,
    permissions: {
      // Bypass permission prompts at the project level. Per the official schema
      // (json.schemastore.org/claude-code-settings.json), defaultMode is only
      // ever recognized nested here — there is no top-level `defaultMode` field
      // (the top level allows unknown keys, so a top-level one is silently inert
      // rather than a validation error).
      defaultMode: "bypassPermissions",
      allow: [...allow].sort(),
      deny: [
        "Read(./.env)",
        "Read(./.env.*)",
        "Read(./**/.env)",
        "Read(./**/.env.*)",
        "Read(./secrets/**)",
      ],
      // Covers sessionScratchDir()'s fallback path — see the allow-list comment above.
      additionalDirectories: ["/tmp", "/private/tmp"],
    },
    // Branch new worktrees from local HEAD, not origin/<default> — preserves
    // unpushed commits (this harness's own WorktreeCreate hook assumes that).
    worktree: {
      baseRef: "head",
    },
    // Auto-enable the plugins this harness is designed to pair with, and
    // aia-harness itself (so its own commands keep working in the target
    // project), for anyone who opens it in Claude Code.
    enabledPlugins: {
      "caveman@caveman": true,
      "ponytail@ponytail": true,
      "superpowers@claude-plugins-official": true,
      "aia-harness@leandro-plugins-registry": true,
    },
    extraKnownMarketplaces: {
      caveman: ghMarketplace("JuliusBrussee/caveman"),
      ponytail: ghMarketplace("DietrichGebert/ponytail"),
      "leandro-plugins-registry": ghMarketplace("leandrosilvaferreira/claude-plugins-registry"),
    },
    hooks,
  };
  return JSON.stringify(settings, null, 2) + "\n";
}

/**
 * @param {string[]} envPlaceholders
 * @returns {string}
 */
export function renderSettingsLocal(envPlaceholders) {
  /** @type {Record<string, string>} */
  const env = {};
  for (const key of envPlaceholders) env[key] = "";
  const local = {
    $comment:
      "Personal, gitignored. MCP-server credentials (env vars referenced by .mcp.json) — project secrets belong in .env/.env.local. Do not commit secrets.",
    env,
  };
  return JSON.stringify(local, null, 2) + "\n";
}
