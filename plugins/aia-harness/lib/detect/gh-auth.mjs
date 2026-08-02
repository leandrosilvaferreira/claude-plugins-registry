/**
 * GitHub CLI authentication and OAuth scope detection.
 *
 * The deps engine only ever verified that the `gh` binary exists. It never
 * asked whether the stored token can actually do anything, so a login missing
 * the `project` or `workflow` scope stayed invisible until an unrelated command
 * failed with "token has not been granted the required scopes".
 *
 * FAIL-OPEN, scoped to environmental failure: the binary missing, a non-zero
 * exit, unparseable output, or spawn itself throwing all return a well-formed
 * result rather than throwing. This must never be the reason a harness
 * operation stops. `required` itself is trusted, not validated — see
 * checkGhAuth's own docstring below.
 *
 * @module detect/gh-auth
 */
import fs from "node:fs";
import { spawnSync } from "node:child_process";
import { ghRefreshCommand } from "../data/gh-scopes.mjs";
import { findBinary } from "./system-deps.mjs";

/** @typedef {import("../profile.mjs").GhAuthCheck} GhAuthCheck */

/**
 * Pull the scopes out of a `gh auth status` transcript.
 *
 * The relevant line looks like:
 *   `  - Token scopes: 'gist', 'project', 'read:org', 'repo', 'workflow'`
 *
 * Pure, and exported so tests can drive it with fixtures rather than depending
 * on the developer's own login.
 *
 * @param {string|undefined} output
 * @returns {string[]}
 */
export function parseScopes(output) {
  const match = /Token scopes:\s*(.+)/.exec(output ?? "");
  if (!match) return [];
  return [...match[1].matchAll(/'([^']+)'/g)].map((m) => m[1]);
}

/**
 * Scopes in `required` that `granted` does not include.
 * Pure and exported so the scope diff — this module's actual purpose — is
 * testable without spawning anything; the same reason parseScopes is separate.
 *
 * @param {readonly string[]} required
 * @param {readonly string[]} granted
 * @returns {string[]}
 */
export function diffScopes(required, granted) {
  return required.filter((s) => !granted.includes(s));
}

/**
 * Check whether the active `gh` login carries `required`.
 *
 * Fail-open covers environmental failure only — the binary missing, a
 * non-zero exit, unparseable output, or spawn itself throwing. `required` is
 * trusted to be an array of scope strings, as its type declares; it is never
 * validated at runtime.
 *
 * @param {readonly string[]} required
 * @param {{ binPath?: string, env?: Record<string, string|undefined> }} [opts]
 *   `binPath` should be the path already resolved by `findBinary` so Windows
 *   shims resolve correctly; it defaults to a bare `gh` on PATH.
 * @returns {GhAuthCheck}
 */
export function checkGhAuth(required, opts = {}) {
  const env = opts.env ?? process.env;
  const bin = opts.binPath ?? "gh";
  const refreshCmd = ghRefreshCommand(required);

  // `gh` prefers GH_TOKEN/GITHUB_TOKEN over the keyring account, so an
  // environment token makes `gh auth status` describe a credential that
  // `gh auth refresh` cannot touch at all. Callers surface an `unset` for this
  // case instead of a refresh that would silently change nothing.
  const envTokenOverride = Boolean(env.GH_TOKEN || env.GITHUB_TOKEN);

  /** @type {GhAuthCheck} */
  const unavailable = {
    available: false,
    authenticated: false,
    scopes: [],
    missing: diffScopes(required, []),
    envTokenOverride,
    refreshCmd,
  };

  // `binPath` may be a Windows .bat/.cmd shim resolved by findBinary
  // (lib/detect/system-deps.mjs tries [".exe", ".cmd", ".bat", ""] there). A
  // .bat/.cmd is not a PE image, so Windows' CreateProcess cannot launch it
  // directly — spawnSync without a shell silently fails to start it, which the
  // fail-open check below then reads as "unavailable" rather than "never ran".
  // Confirmed on real Windows CI for the equivalent PHPStan case (see
  // templates/hooks/phpstan-on-edit.mjs); shell:true is Node's documented fix,
  // scoped to win32 only so POSIX behavior here is unchanged. With shell:true,
  // Node needs ONE pre-quoted command string rather than a separate args array
  // — a non-empty args array alongside shell:true trips DEP0190 and mis-joins
  // the arguments. No allow-list gate is needed here the way
  // phpstan-on-edit.mjs gates its file argument: "auth" and "status" are
  // static literals, never user input — only `bin` itself needs quoting, since
  // a real install path can contain spaces (e.g. "C:\Program Files\...").
  const isWin = process.platform === "win32";

  // shell:true also destroys ENOENT: cmd.exe starts fine whatever it is asked
  // to run, and reports an unresolvable command through error text that is
  // localized and version-dependent, so neither result.error nor the exit code
  // can be trusted to mean "never ran" — a missing gh would come back
  // available with no scopes, i.e. blamed for missing OAuth scopes instead of
  // not being installed. Resolve up front instead: callers pass an already
  // resolved absolute path, and the bare-name default falls back to the same
  // PATH+extension search every other dep goes through.
  if (isWin && !fs.existsSync(bin) && !findBinary(bin, "win32", env)) return unavailable;

  const authArgs = ["auth", "status"];
  const [cmd, cmdArgs] = isWin
    ? [[bin, ...authArgs].map((s) => `"${s}"`).join(" "), []]
    : [bin, authArgs];

  /** @type {import("node:child_process").SpawnSyncReturns<string>} */
  let result;
  try {
    result = spawnSync(cmd, cmdArgs, {
      encoding: "utf8",
      timeout: 10_000,
      windowsHide: true,
      shell: isWin,
    });
  } catch {
    return unavailable;
  }
  // status === null means the process was killed or never started (ENOENT
  // surfaces as result.error rather than a throw).
  if (result.error || result.status === null) return unavailable;

  // gh writes the status transcript to stderr on some versions and stdout on
  // others; read both rather than guessing.
  const scopes = parseScopes(`${result.stdout ?? ""}\n${result.stderr ?? ""}`);
  return {
    available: true,
    authenticated: result.status === 0,
    scopes,
    missing: diffScopes(required, scopes),
    envTokenOverride,
    refreshCmd,
  };
}
