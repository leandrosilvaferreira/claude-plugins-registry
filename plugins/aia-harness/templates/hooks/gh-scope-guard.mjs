#!/usr/bin/env node
/**
 * gh-scope-guard.mjs — PostToolUse hook (matcher: Bash)
 *
 * A `gh` command failing for a missing OAuth scope is not a code bug, but it
 * reliably produces the wrong reaction: prefixing GH_TOKEN with some personal
 * access token, hand-crafting a fine-grained PAT in the GitHub UI, or polling
 * manually — instead of the one-line fix. This detects the real error pattern
 * in the gh output and prescribes the right refresh.
 *
 * PostToolUse cannot undo the tool (it already ran), so the only channels are
 * systemMessage (for the user) and hookSpecificOutput.additionalContext (for
 * the agent). Exits 0 on every path.
 *
 * Shipped by aia-harness; wired only on projects with a github.com remote.
 * FAIL-OPEN.
 */
import { parseHookEvent, readStdinRaw } from "./hook-io.mjs";

// --- Kept in sync with lib/data/gh-scopes.mjs. Hooks ship standalone into
// --- target projects and cannot import from lib/. The sync is asserted
// --- behaviourally by tests/hook-gh-scope-guard.test.mjs, which compares the
// --- emitted command against ghRefreshCommand() from the real catalog.
const GH_SCOPES = ["admin:public_key", "gist", "project", "read:org", "repo", "workflow"];

/** @param {string[]} scopes @returns {string} */
function ghRefreshCommand(scopes) {
  return `gh auth refresh -h github.com -s ${scopes.join(",")}`;
}

const SCOPE_ERROR_RE =
  /requires (the following|additional) scopes?|token has not been granted|resource not accessible by (personal access token|integration)|insufficient (permission|scope)|missing (the )?required scopes?|gh auth refresh -s/i;

const event = parseHookEvent(readStdinRaw());
if (event === null) process.exit(0);

const command = event.tool_input?.command ?? "";
// Boundary class includes `\` (Windows path separator, e.g. C:\tools\gh) and the
// `.exe` suffix is optional (Windows commonly spells the binary gh.exe).
if (typeof command !== "string" || !/(^|[\s;&|(/\\`])gh(\.exe)?\s/.test(command)) process.exit(0);

const response = event.tool_response ?? {};
const output = `${response.stdout ?? ""}\n${response.stderr ?? ""}`;
if (!SCOPE_ERROR_RE.test(output)) process.exit(0);

const refreshCmd = ghRefreshCommand(GH_SCOPES);

// gh prefers GH_TOKEN/GITHUB_TOKEN over the keyring account, so when one is set
// the failing credential is the environment token — and `gh auth refresh`, which
// only ever touches the stored OAuth login, would change nothing at all.
const envTokenOverride = Boolean(process.env.GH_TOKEN || process.env.GITHUB_TOKEN);

const systemMessage = envTokenOverride
  ? [
      "⚠️ The gh command failed for a missing scope or permission, and GH_TOKEN/GITHUB_TOKEN",
      "is set in the environment — gh is using that token, not your keyring login, so a",
      "refresh would change nothing. Run in your terminal:",
      "",
      "  unset GH_TOKEN GITHUB_TOKEN",
      "",
      "Then re-run the command. Confirm the active credential with `gh auth status`.",
    ].join("\n")
  : [
      "⚠️ The gh command failed for a missing OAuth scope on your token. Run in your terminal:",
      "",
      `  ${refreshCmd}`,
      "",
      "It adds scopes without revoking the ones you already have. Confirm with",
      "`gh auth status`. Do not work around this with GH_TOKEN or a hand-made personal",
      "access token — the default gh login is the correct credential.",
    ].join("\n");

const additionalContext = envTokenOverride
  ? [
      "The previous gh command failed because GH_TOKEN/GITHUB_TOKEN in the environment is",
      "shadowing the user's keyring login, not because of a code bug. Do not attempt any",
      "workaround. Stop and ask the user to run `unset GH_TOKEN GITHUB_TOKEN` in their own",
      "terminal, and only retry the gh command after they confirm.",
    ].join(" ")
  : [
      "The previous gh command failed because the user's token is missing an OAuth scope,",
      "not because of a code bug. Do not attempt workarounds — never set GH_TOKEN or",
      "GITHUB_TOKEN, and never suggest generating a personal access token in the GitHub UI.",
      `Stop and ask the user to run this in their own terminal: ${refreshCmd}`,
      "Only retry the gh command after the user confirms they have done so.",
    ].join(" ");

process.stdout.write(
  JSON.stringify({
    systemMessage,
    hookSpecificOutput: { hookEventName: "PostToolUse", additionalContext },
  }),
);
process.exit(0);
