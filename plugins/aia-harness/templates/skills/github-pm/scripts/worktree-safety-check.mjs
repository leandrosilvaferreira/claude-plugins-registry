#!/usr/bin/env node
// Cross-platform replacement for worktree-safety-check.sh
// Uses Node.js + git/gh CLI — no bash required (works on Mac, Linux, Windows)
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const [,, target = '', ownerRepo = ''] = process.argv;

/** Run a git command, return stdout string or null on failure */
function git(...args) {
  const r = spawnSync('git', args, { encoding: 'utf8' });
  return r.status === 0 ? r.stdout.trim() : null;
}

/** Run a gh command, return stdout string or null on failure */
function gh(...args) {
  const r = spawnSync('gh', args, { encoding: 'utf8' });
  return r.status === 0 ? r.stdout.trim() : null;
}

/** Parse `git worktree list --porcelain` output into [{path, branch}] */
function parseWorktrees(porcelain) {
  const entries = [];
  let cur = {};
  for (const line of porcelain.split('\n')) {
    if (line.startsWith('worktree ')) cur.path = line.slice(9);
    else if (line.startsWith('branch ')) cur.branch = line.slice('branch refs/heads/'.length);
    else if (line === '') {
      if (cur.path) entries.push({ path: cur.path, branch: cur.branch ?? '' });
      cur = {};
    }
  }
  if (cur.path) entries.push({ path: cur.path, branch: cur.branch ?? '' });
  return entries;
}

/** Find worktree by path, branch name, or issue number; skip main worktree */
function resolveWorktree(worktrees, tgt, mainPath) {
  for (const wt of worktrees) {
    if (wt.path === mainPath) continue; // skip main worktree
    if (
      wt.path === tgt ||
      wt.branch === tgt ||
      (tgt && (wt.branch.includes(`/${tgt}-`) || wt.branch.endsWith(`/${tgt}`)))
    ) return wt;
  }
  return null;
}

// --- Main ---

const porcelain = git('worktree', 'list', '--porcelain');
if (!porcelain) {
  process.stderr.write('Not a git repo\n');
  process.exit(2);
}

const worktrees = parseWorktrees(porcelain);
const mainPath = git('rev-parse', '--show-toplevel') ?? '';

let wtPath, wtBranch;

if (!target) {
  const cwd = process.cwd();
  if (cwd === mainPath) {
    process.stderr.write('Already in main worktree — nothing to remove\n');
    process.exit(2);
  }
  wtPath = cwd;
  wtBranch = git('branch', '--show-current') ?? '';
} else {
  const wt = resolveWorktree(worktrees, target, mainPath);
  if (!wt) {
    process.stderr.write(`Worktree not found for: ${target}\n`);
    process.exit(2);
  }
  wtPath = wt.path;
  wtBranch = wt.branch;
}

if (!wtPath || !wtBranch) {
  process.stderr.write(`Could not resolve worktree for: ${target}\n`);
  process.exit(2);
}

let blocked = false;

// 1. Working tree clean
const status = git('-C', wtPath, 'status', '--porcelain');
if (status === null || status.length > 0) {
  process.stderr.write(`❌ Uncommitted changes in ${wtPath}\n`);
  blocked = true;
} else {
  process.stderr.write('✅ Working tree clean\n');
}

// 2. Nothing committed without push
const unpushedOut = git('-C', wtPath, 'log', `origin/${wtBranch}..${wtBranch}`, '--oneline');
const unpushed = unpushedOut ? unpushedOut.split('\n').filter(Boolean).length : 0;
if (unpushed > 0) {
  process.stderr.write(`❌ ${unpushed} commit(s) not pushed to origin/${wtBranch}\n`);
  blocked = true;
} else {
  process.stderr.write('✅ All commits pushed\n');
}

// 3. Branch has a PR (only if ownerRepo provided)
if (ownerRepo) {
  const prNumberOut = gh('pr', 'list', '--repo', ownerRepo, '--head', wtBranch, '--json', 'number', '--jq', '.[0].number');
  const prNumber = prNumberOut ? prNumberOut.trim() : '';

  if (!prNumber) {
    process.stderr.write(`❌ No PR found for branch ${wtBranch}\n`);
    blocked = true;
  } else {
    process.stderr.write(`✅ PR #${prNumber} found\n`);

    // 4. CI status via check-pr-status.mjs
    const scriptDir = path.dirname(fileURLToPath(import.meta.url));
    const checkScript = path.join(scriptDir, 'check-pr-status.mjs');
    const ciResult = spawnSync(process.execPath, [checkScript, prNumber, ownerRepo], { encoding: 'utf8' });
    if (ciResult.status === 1) {
      process.stderr.write(`❌ CI checks failing on PR #${prNumber}\n`);
      blocked = true;
    } else if (ciResult.status === 2) {
      process.stderr.write(`❌ CI checks still pending on PR #${prNumber}\n`);
      blocked = true;
    } else {
      process.stderr.write('✅ CI checks OK\n');
    }

    // 5. PR merged
    const prState = gh('pr', 'view', prNumber, '--repo', ownerRepo, '--json', 'state', '--jq', '.state') ?? 'UNKNOWN';
    if (prState !== 'MERGED') {
      process.stderr.write(`❌ PR #${prNumber} not merged (state: ${prState})\n`);
      blocked = true;
    } else {
      process.stderr.write(`✅ PR #${prNumber} merged\n`);
    }
  }
}

if (blocked) process.exit(1);

process.stdout.write(`RESULT_WT_PATH=${wtPath}\n`);
process.stdout.write(`RESULT_WT_BRANCH=${wtBranch}\n`);
process.exit(0);
