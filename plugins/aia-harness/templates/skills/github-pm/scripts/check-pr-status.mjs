#!/usr/bin/env node
// Cross-platform replacement for check-pr-status.sh
// Uses gh CLI + Node.js JSON parsing (no python3 dependency)
import { execFileSync } from 'node:child_process';

const [,, prNumber, ownerRepo] = process.argv;

if (!prNumber || !ownerRepo) {
  process.stderr.write(`Usage: node check-pr-status.mjs <PR_NUMBER> <OWNER/REPO>\n`);
  process.exit(3);
}

// Fetch PR data via gh CLI
let prData;
try {
  const out = execFileSync('gh', [
    'pr', 'view', prNumber,
    '--repo', ownerRepo,
    '--json', 'state,isDraft,mergeStateStatus,statusCheckRollup,reviewDecision'
  ], { encoding: 'utf8' });
  prData = JSON.parse(out);
} catch {
  process.stderr.write(`PR #${prNumber} not found in ${ownerRepo}\n`);
  process.exit(3);
}

// Validate state
if (prData.state !== 'OPEN') {
  process.stderr.write(`PR #${prNumber} is ${prData.state} (not OPEN)\n`);
  process.exit(3);
}
if (prData.isDraft) {
  process.stderr.write(`PR #${prNumber} is a draft\n`);
  process.exit(3);
}

// Evaluate CI rollup
const checks = prData.statusCheckRollup ?? [];
let rollup = 'NONE';
if (checks.length > 0) {
  const states = checks.map(c => c.conclusion ?? c.state ?? 'PENDING');
  const failing = ['FAILURE', 'ERROR', 'TIMED_OUT', 'CANCELLED'];
  const pending = ['PENDING', 'QUEUED', 'IN_PROGRESS', 'WAITING', 'REQUESTED', 'EXPECTED'];
  if (states.some(s => failing.includes(s))) rollup = 'FAILING';
  else if (states.some(s => pending.includes(s))) rollup = 'PENDING';
  else rollup = 'SUCCESS';
}

if (rollup === 'FAILING') {
  process.stderr.write(`CI checks are failing for PR #${prNumber}\n`);
  try { execFileSync('gh', ['pr', 'checks', prNumber, '--repo', ownerRepo], { stdio: ['ignore', 'inherit', 'inherit'] }); } catch {}
  process.exit(1);
}
if (rollup === 'PENDING') {
  process.stderr.write(`CI checks still pending for PR #${prNumber}\n`);
  process.exit(2);
}

// Check review decision
const review = prData.reviewDecision ?? 'NONE';
if (review === 'APPROVED' || review === 'NONE') {
  process.stderr.write(`PR #${prNumber}: all checks passed\n`);
  process.exit(0);
}
process.stderr.write(`PR #${prNumber}: checks OK but review not approved (status: ${review})\n`);
process.exit(4);
