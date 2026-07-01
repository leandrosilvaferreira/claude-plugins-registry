/**
 * Shared utility for hook compliance tests.
 * Runs a hook file as a subprocess with controlled stdin and returns
 * stdout, stderr, and exit code without throwing on non-zero exits.
 */
import { spawnSync } from "node:child_process";
import { execSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

/**
 * @typedef {{ stdout: string, stderr: string, exitCode: number }} HookResult
 */

/**
 * Run a hook file with a JSON event on stdin.
 *
 * @param {string} hookPath  - absolute path to the hook .mjs file
 * @param {any}    event     - object serialised as JSON and piped to stdin
 * @param {{ env?: Record<string,string>, args?: string[] }} [opts]
 * @returns {HookResult}
 */
export function runHook(hookPath, event, opts = {}) {
  const result = spawnSync(process.execPath, [hookPath, ...(opts.args ?? [])], {
    input: JSON.stringify(event),
    encoding: "utf8",
    env: { ...process.env, ...opts.env },
  });
  return {
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
    exitCode: result.status ?? 0,
  };
}

/**
 * Run a hook with raw string stdin (for invalid-JSON tests).
 *
 * @param {string} hookPath
 * @param {string} rawInput
 * @param {{ env?: Record<string,string>, args?: string[] }} [opts]
 * @returns {HookResult}
 */
export function runHookRaw(hookPath, rawInput, opts = {}) {
  const result = spawnSync(process.execPath, [hookPath], {
    input: rawInput,
    encoding: "utf8",
    env: { ...process.env, ...opts.env },
  });
  return {
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
    exitCode: result.status ?? 0,
  };
}

/**
 * Create a temp directory with a git repo initialised on the given branch.
 * Returns the directory path. Caller is responsible for cleanup.
 *
 * @param {string} branchName
 * @returns {string}
 */
export function mkGitRepo(branchName) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "aia-hook-git-"));
  execSync(`git init -b "${branchName}"`, { cwd: dir, stdio: "pipe" });
  execSync(`git config user.email "test@test.com"`, { cwd: dir, stdio: "pipe" });
  execSync(`git config user.name "Test"`, { cwd: dir, stdio: "pipe" });
  // An empty commit so the branch is fully initialised.
  execSync(`git commit --allow-empty -m init`, { cwd: dir, stdio: "pipe" });
  return dir;
}
