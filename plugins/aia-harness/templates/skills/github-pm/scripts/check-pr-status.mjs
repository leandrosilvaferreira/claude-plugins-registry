#!/usr/bin/env node
// Cross-platform replacement for check-pr-status.sh
// Uses gh CLI + Node.js JSON parsing (no python3 dependency)
import { execFileSync } from "node:child_process";

const [, , prNumber, ownerRepo] = process.argv;

if (!prNumber || !ownerRepo) {
  process.stderr.write(`Usage: node check-pr-status.mjs <PR_NUMBER> <OWNER/REPO>\n`);
  process.exit(3);
}

// Fetch PR data via gh CLI
let prData;
try {
  const out = execFileSync(
    "gh",
    [
      "pr",
      "view",
      prNumber,
      "--repo",
      ownerRepo,
      "--json",
      "state,isDraft,mergeStateStatus,statusCheckRollup,reviewDecision,reviewRequests",
    ],
    { encoding: "utf8", windowsHide: true },
  );
  prData = JSON.parse(out);
} catch {
  process.stderr.write(`PR #${prNumber} not found in ${ownerRepo}\n`);
  process.exit(3);
}

// Validate state
if (prData.state !== "OPEN") {
  process.stderr.write(`PR #${prNumber} is ${prData.state} (not OPEN)\n`);
  process.exit(3);
}
if (prData.isDraft) {
  process.stderr.write(`PR #${prNumber} is a draft\n`);
  process.exit(3);
}

// Evaluate CI rollup
/** @type {Array<{conclusion?: string, state?: string}>} */
const checks = prData.statusCheckRollup ?? [];
let rollup = "NONE";
if (checks.length > 0) {
  const states = checks.map((c) => c.conclusion ?? c.state ?? "PENDING");
  const failing = ["FAILURE", "ERROR", "TIMED_OUT", "CANCELLED"];
  const pending = ["PENDING", "QUEUED", "IN_PROGRESS", "WAITING", "REQUESTED", "EXPECTED"];
  if (states.some((s) => failing.includes(s))) rollup = "FAILING";
  else if (states.some((s) => pending.includes(s))) rollup = "PENDING";
  else rollup = "SUCCESS";
}

if (rollup === "FAILING") {
  process.stderr.write(`CI checks are failing for PR #${prNumber}\n`);
  try {
    execFileSync("gh", ["pr", "checks", prNumber, "--repo", ownerRepo], {
      stdio: ["ignore", "inherit", "inherit"],
      windowsHide: true,
    });
  } catch {
    // display helper may fail; process.exit(1) follows
  }
  process.exit(1);
}
if (rollup === "PENDING") {
  process.stderr.write(`CI checks still pending for PR #${prNumber}\n`);
  process.exit(2);
}

// Check review decision
const review = prData.reviewDecision ?? "NONE";
if (review !== "APPROVED" && review !== "NONE") {
  process.stderr.write(`PR #${prNumber}: checks OK but review not approved (status: ${review})\n`);
  process.exit(4);
}

// reviewDecision never reflects a COMMENTED review (Codex, Claude Code, and most AI
// reviewers leave feedback this way, never CHANGES_REQUESTED) or a reviewer who was
// requested but hasn't submitted yet. Check both explicitly before declaring the PR clean.
/** @type {Array<{login?: string, name?: string}>} */
const reviewRequests = prData.reviewRequests ?? [];
const pendingReviewers = reviewRequests.map((r) => r.login ?? r.name).filter(Boolean);

/** @type {string[]} */
let unresolvedThreadAuthors = [];
try {
  const [owner, name] = ownerRepo.split("/");
  const graphqlOut = execFileSync(
    "gh",
    [
      "api",
      "graphql",
      "-f",
      `query=query($owner:String!,$name:String!,$number:Int!){
        repository(owner:$owner,name:$name){
          pullRequest(number:$number){
            reviewThreads(first:100){
              nodes{ isResolved comments(first:1){ nodes{ author{ login } } } }
            }
          }
        }
      }`,
      "-f",
      `owner=${owner}`,
      "-f",
      `name=${name}`,
      "-F",
      `number=${prNumber}`,
    ],
    { encoding: "utf8", windowsHide: true },
  );
  /** @type {Array<{isResolved: boolean, comments: {nodes: Array<{author?: {login?: string}}>}}>} */
  const threads = JSON.parse(graphqlOut).data.repository.pullRequest.reviewThreads.nodes;
  unresolvedThreadAuthors = threads
    .filter((t) => !t.isResolved)
    .map((t) => t.comments.nodes[0]?.author?.login ?? "unknown");
} catch (err) {
  const detail = /** @type {{ stderr?: string, message?: string }} */ (err);
  process.stderr.write(
    `warning: could not check review threads: ${detail.stderr ?? detail.message ?? String(err)}\n`,
  );
}

if (unresolvedThreadAuthors.length > 0 || pendingReviewers.length > 0) {
  if (unresolvedThreadAuthors.length > 0) {
    process.stderr.write(
      `PR #${prNumber}: ${unresolvedThreadAuthors.length} unresolved review thread(s) from: ${unresolvedThreadAuthors.join(", ")}\n`,
    );
  }
  if (pendingReviewers.length > 0) {
    process.stderr.write(
      `PR #${prNumber}: review requested but not yet submitted from: ${pendingReviewers.join(", ")}\n`,
    );
  }
  process.exit(5);
}

process.stderr.write(`PR #${prNumber}: all checks passed\n`);
process.exit(0);
