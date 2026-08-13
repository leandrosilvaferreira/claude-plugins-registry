/**
 * GitHub CLI authentication, OAuth scope detection, and repo secret listing.
 *
 * The deps engine only ever verified that the `gh` binary exists. It never
 * asked whether the stored token can actually do anything, so a login missing
 * the `project` or `workflow` scope stayed invisible until an unrelated command
 * failed with "token has not been granted the required scopes". `listGhSecretNames`
 * closes the same gap one layer up: a workflow can also silently no-op because the
 * repo secret it reads was never created at all.
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
 * Run a `gh` subcommand safely across platforms. Shared by every function in
 * this module that shells out to `gh` — factored out so the Windows-shim
 * dance below is written, and has to be reasoned about, exactly once.
 *
 * `binPath` may be a Windows .bat/.cmd shim resolved by findBinary
 * (lib/detect/system-deps.mjs tries [".exe", ".cmd", ".bat", ""] there). A
 * .bat/.cmd is not a PE image, so Windows' CreateProcess cannot launch it
 * directly — spawnSync without a shell silently fails to start it, which the
 * fail-open check below then reads as "unavailable" rather than "never ran".
 * Confirmed on real Windows CI for the equivalent PHPStan case (see
 * templates/hooks/phpstan-on-edit.mjs); shell:true is Node's documented fix,
 * scoped to win32 only so POSIX behavior here is unchanged. With shell:true,
 * Node needs ONE pre-quoted command string rather than a separate args array
 * — a non-empty args array alongside shell:true trips DEP0190 and mis-joins
 * the arguments. No allow-list gate is needed here the way
 * phpstan-on-edit.mjs gates its file argument: every `args` entry passed by
 * this module's callers is a static literal, never user input — only `bin`
 * itself needs quoting, since a real install path can contain spaces (e.g.
 * "C:\Program Files\...").
 *
 * shell:true also destroys ENOENT: cmd.exe starts fine whatever it is asked
 * to run, and reports an unresolvable command through error text that is
 * localized and version-dependent, so neither result.error nor the exit code
 * can be trusted to mean "never ran" — a missing gh would come back looking
 * available with a real (non-zero) exit, i.e. blamed for the subcommand
 * failing instead of not being installed. Resolve up front instead: callers
 * pass an already resolved absolute path, and the bare-name default falls
 * back to the same PATH+extension search every other dep goes through.
 *
 * FAIL-OPEN: binary missing, non-zero exit is NOT swallowed here (callers
 * decide what a non-zero exit means), but spawn itself throwing, ENOENT, or
 * the process never starting all return `null` rather than throwing.
 *
 * @param {string} bin
 * @param {string[]} args
 * @param {Record<string, string|undefined>} env
 * @param {{ cwd?: string }} [opts]
 * @returns {{ status: number, stdout: string, stderr: string } | null}
 */
function runGh(bin, args, env, opts = {}) {
  const isWin = process.platform === "win32";
  if (isWin && !fs.existsSync(bin) && !findBinary(bin, "win32", env)) return null;

  const [cmd, cmdArgs] = isWin ? [[bin, ...args].map((s) => `"${s}"`).join(" "), []] : [bin, args];

  /** @type {import("node:child_process").SpawnSyncReturns<string>} */
  let result;
  try {
    result = spawnSync(cmd, cmdArgs, {
      encoding: "utf8",
      timeout: 10_000,
      windowsHide: true,
      shell: isWin,
      cwd: opts.cwd,
    });
  } catch {
    return null;
  }
  // status === null means the process was killed or never started (ENOENT
  // surfaces as result.error rather than a throw).
  if (result.error || result.status === null) return null;
  return { status: result.status, stdout: result.stdout ?? "", stderr: result.stderr ?? "" };
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

  const result = runGh(bin, ["auth", "status"], env);
  if (!result) return unavailable;

  // gh writes the status transcript to stderr on some versions and stdout on
  // others; read both rather than guessing.
  const scopes = parseScopes(`${result.stdout}\n${result.stderr}`);
  return {
    available: true,
    authenticated: result.status === 0,
    scopes,
    missing: diffScopes(required, scopes),
    envTokenOverride,
    refreshCmd,
  };
}

/**
 * List the names of every repository-level Actions secret, via
 * `gh secret list --json name`. Read-only — never creates, updates, or
 * removes a secret. Backs the GitHub PM smoke check's "pat-secret-exists"
 * guard (lib/pm-check.mjs): a workflow that reads a missing secret gets an
 * empty string for it and silently no-ops, with no error anywhere.
 *
 * FAIL-OPEN the same way checkGhAuth is: binary missing, a non-zero exit
 * (unauthenticated, no resolvable GitHub remote in `cwd`, or the
 * authenticated account lacking admin access to list secrets), or
 * unparseable output all come back `null` — callers must treat that as
 * "cannot verify", never as "confirmed absent".
 *
 * @param {{ binPath?: string, cwd?: string, env?: Record<string, string|undefined> }} [opts]
 *   `binPath` should be the path already resolved by `findBinary`, same as checkGhAuth.
 *   `cwd` should be the project root so gh can infer the repo from its git remote.
 * @returns {string[] | null}
 */
export function listGhSecretNames(opts = {}) {
  const env = opts.env ?? process.env;
  const bin = opts.binPath ?? "gh";

  const result = runGh(bin, ["secret", "list", "--json", "name"], env, { cwd: opts.cwd });
  if (!result || result.status !== 0) return null;

  try {
    const parsed = JSON.parse(result.stdout);
    if (!Array.isArray(parsed)) return null;
    return parsed
      .map((s) => (s && typeof s === "object" ? s.name : undefined))
      .filter((name) => typeof name === "string");
  } catch {
    return null;
  }
}
