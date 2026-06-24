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
  allow.add("Bash(git status:*)");
  allow.add("Bash(git diff:*)");

  /** @type {Record<string, any[]>} */
  const hooks = {
    PreToolUse: [
      {
        matcher: "Bash",
        hooks: [
          { type: "command", ...hookCmd("guard-main-branch.mjs"), timeout: 10 },
        ],
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
        ],
      },
    ],
    SessionStart: [
      {
        // Check system deps at session start; injects additionalContext when missing.
        hooks: [
          { type: "command", ...hookCmd("check-deps-on-start.mjs"), timeout: 30 },
        ],
      },
    ],
    SubagentStart: [
      {
        // Inject active worktree path (from event.cwd) into every subagent.
        hooks: [
          { type: "command", ...hookCmd("worktree-subagent-ctx.mjs"), timeout: 10 },
        ],
      },
    ],
    Stop: [
      {
        hooks: [
          { type: "command", ...hookCmd("verify-on-stop.mjs"), timeout: 300 },
          { type: "command", ...hookCmd("memory-stop.mjs"), timeout: 30 },
        ],
      },
    ],
  };

  // Large-file guard: one hook script, two wirings chosen by mode. `block` runs
  // it at Stop (refactor before finishing — greenfield born strict); `advisory`
  // (default) runs it on PostToolUse against the just-edited file (suggest +
  // confirm — legacy-safe). The hook branches on hook_event_name accordingly.
  const lfHook = { type: /** @type {const} */ ("command"), ...hookCmd("large-file-warning.mjs"), timeout: 30 };
  if (opts.largeFiles === "block") {
    hooks.Stop[0].hooks.push(lfHook);
  } else {
    hooks.PostToolUse.push({ matcher: "Edit|Write|MultiEdit", hooks: [lfHook] });
  }

  for (const [event, entries] of Object.entries(extraHooks)) {
    hooks[event] = [...(hooks[event] ?? []), ...entries];
  }

  const settings = {
    // Default model: Opus for planning, Sonnet for execution.
    model: "opusplan",
    // Bypass permission prompts at the project level. Must be top-level so that
    // this project settings object does not lose the flag when it shadows the
    // global `permissions` object entirely (which would strip any `defaultMode`
    // nested inside global permissions).
    defaultMode: "bypassPermissions",
    // Default reasoning effort to MAX. `effortLevel` in settings.json only
    // persists up to "xhigh"; `max` is session-only, so it's set via the env
    // var Claude Code reads for the same purpose.
    env: { CLAUDE_CODE_EFFORT_LEVEL: "max", CLAUDE_CODE_DISABLE_ADAPTIVE_THINKING: "1" },
    showClearContextOnPlanAccept: true,
    autoMemoryEnabled: true,
    skipDangerousModePermissionPrompt: true,
    permissions: {
      allow: [...allow].sort(),
      deny: ["Read(./.env)", "Read(./.env.*)", "Read(./**/.env)", "Read(./**/.env.*)", "Read(./secrets/**)"],
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
    $comment: "Personal, gitignored. MCP-server credentials (env vars referenced by .mcp.json) — project secrets belong in .env/.env.local. Do not commit secrets.",
    env,
  };
  return JSON.stringify(local, null, 2) + "\n";
}
