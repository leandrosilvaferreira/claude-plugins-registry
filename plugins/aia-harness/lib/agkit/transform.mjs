/**
 * Pure transforms applied to ag-kit files when vendoring them into
 * templates/ag-kit/. ag-kit targets Antigravity, so frontmatters are
 * converted to Claude Code conventions. No IO here -> unit-testable.
 *
 * @module agkit/transform
 */
import { splitFrontmatter } from "../ecc/transform.mjs";
import { parseFrontmatter, renderFrontmatter } from "../util/frontmatter-yaml.mjs";
import { applyCanonicalDescription } from "../validate/agent-description.mjs";
import { allAgkitAssets } from "../data/agkit-catalog.mjs";

export { parseFrontmatter, renderFrontmatter };

/** @param {string} sourcePath @param {string} commit @returns {string} */
function provenanceComment(sourcePath, commit) {
  return `<!-- Vendored from ag-kit (github.com/vudovn/ag-kit) @ ${commit} :: ${sourcePath}. MIT (c) vudovn. -->\n`;
}

/**
 * Agent names ag-kit only ships for a matching detected stack (see
 * AGKIT_BY_STACK in lib/data/agkit-catalog.mjs: frontend-specialist/
 * seo-specialist -> web, mobile-developer -> mobile, game-developer ->
 * games). AGKIT_COMMON files (installed for every project) that mention one
 * of these read as if the agent always exists, so a backend-only project
 * following the routing table would try to invoke an agent that was never
 * installed. Detected by content, not by file path, so the note tracks
 * whichever files actually mention these names as ag-kit is re-vendored.
 * backend-specialist is deliberately not in this list even though it is
 * also stack-gated: every AGKIT_BY_STACK branch ships it, so it is never
 * actually conditional in practice, unlike the four below.
 */
const CONDITIONAL_AGENTS = [
  "frontend-specialist",
  "mobile-developer",
  "seo-specialist",
  "game-developer",
];

const CONDITIONAL_AGENT_RE = new RegExp(`\\b(?:${CONDITIONAL_AGENTS.join("|")})\\b`);

const CONDITIONAL_AGENT_NAMES_PROSE =
  CONDITIONAL_AGENTS.slice(0, -1)
    .map((n) => `\`${n}\``)
    .join(", ") + `, and \`${CONDITIONAL_AGENTS[CONDITIONAL_AGENTS.length - 1]}\``;

const AGENT_AVAILABILITY_NOTE =
  `> **Note on specialist agents:** names like ${CONDITIONAL_AGENT_NAMES_PROSE} mentioned below are only installed when your ` +
  "project's detected stack matches (web, mobile, or games respectively) - check " +
  "`.claude/agents/` for what is actually present before assuming one of these ran.\n\n";

/**
 * Prepend {@link AGENT_AVAILABILITY_NOTE} when the body mentions a
 * stack-conditional specialist agent.
 * @param {string} body
 * @returns {string}
 */
export function withAgentAvailabilityNote(body) {
  return CONDITIONAL_AGENT_RE.test(body) ? AGENT_AVAILABILITY_NOTE + body : body;
}

/**
 * ag-kit's `orchestrator` and `project-planner` agents each ship a setup
 * block instructing the model to check for a `.code-review-graph/`
 * directory and to `pip install`/run the third-party `code-review-graph`
 * CLI to build a local code map. This harness vendors graphify instead and
 * never installs code-review-graph, so shipping this block verbatim would
 * instruct an agent to install a tool the harness deliberately excludes.
 * Swapped for the equivalent graphify instructions.
 *
 * Implemented as literal string swaps (not a regex) because the two
 * upstream blocks have genuinely different prose (different header text,
 * different Step 1-3 wording) -- matching on the exact known text means a
 * future unrelated upstream edit to either file just makes the swap a safe
 * no-op instead of risking a corrupted substitution.
 */
const CODE_REVIEW_GRAPH_SETUP_SWAPS = [
  {
    from: [
      "2.  **Graph integration check (opt-in):** If `.code-review-graph/` directory is missing:",
      "    - **Step 1:** Check availability: `Get-Command code-review-graph` (Win) or `which code-review-graph` (Mac/Linux).",
      "    - **Step 2:** If installed but the index is missing, ask the user before running `code-review-graph build` (it scans the whole project).",
      '    - **Step 3:** If not installed and project is > 200 files: **ASK the user** "Would you like me to run `pip install code-review-graph` to build a local map and cut token usage for this project?"',
    ].join("\n"),
    to: [
      "2. **Graph integration check (opt-in):** If `graphify-out/` directory is missing:",
      "    - **Step 1:** Check availability: `which graphify` (Mac/Linux) or `where graphify` (Win).",
      "    - **Step 2:** If installed but graph is missing, ask the user before running `graphify .` (scans the whole project).",
      '    - **Step 3:** If not installed and project is > 200 files: **ASK the user** "Would you like me to run `uv tool install graphifyy && graphify install --project && graphify .` to build a local code graph and cut token usage?"',
      "    - **Step 4:** When graph is available, prefer `graphify query` to retrieve targeted context before reading files.",
    ].join("\n"),
  },
  {
    from: [
      "4.  **Auto-Integration Check (MANDATORY TOOL USE):** If `.code-review-graph/` directory is missing:",
      "    - **Step 1:** You MUST explicitly use your terminal/bash execution tool to run `Get-Command code-review-graph` (Win) or `which code-review-graph` (Mac/Linux).",
      "    - **Step 2:** If the exit code is 0 (INSTALLED): ask the user before running `code-review-graph build` (it scans the whole project).",
      '    - **Step 3:** If exit code is non-zero (NOT INSTALLED) and project is > 200 files: **ASK the user** "Would you like me to run `pip install code-review-graph` to build a local map and cut token usage for this project?"',
    ].join("\n"),
    to: [
      "4. **Graph integration check (opt-in):** If `graphify-out/` directory is missing:",
      "    - **Step 1:** Check availability: `which graphify` (Mac/Linux) or `where graphify` (Win).",
      "    - **Step 2:** If installed: ask the user before running `graphify .` (scans the whole project).",
      '    - **Step 3:** If not installed and project is > 200 files: **ASK the user** "Would you like me to run `uv tool install graphifyy && graphify install --project && graphify .` to build a local code graph?"',
      "    - **Step 4:** After tasks that modify code structure, remind the user to run `graphify update` to keep the graph current.",
    ].join("\n"),
  },
];

/**
 * Apply {@link CODE_REVIEW_GRAPH_SETUP_SWAPS}. A no-op on any body that
 * doesn't contain one of the exact known blocks.
 * @param {string} body
 * @returns {string}
 */
export function swapCodeReviewGraphSetup(body) {
  let out = body;
  for (const { from, to } of CODE_REVIEW_GRAPH_SETUP_SWAPS) out = out.split(from).join(to);
  return out;
}

/** Skill names ag-kit actually vendors under some stack (see agkit-catalog.mjs). */
const VENDORED_SKILL_NAMES = new Set(allAgkitAssets().skills);

/**
 * ag-kit source markdown (e.g. clean-code/SKILL.md's "Agent -> Script
 * Mapping" table) has rows pointing at `.agents/skills/<name>/...` for skill
 * names ag-kit does not vendor under any stack -- no catalog entry in
 * agkit-catalog.mjs ships them -- and a stale upstream `.agents/` path even
 * where they did exist. Strip any such row rather than ship a script path
 * that can never resolve. Checked dynamically against the real vendored
 * skill set (agkit-catalog.mjs), not a fixed name list, so a name that goes
 * dead -- or becomes vendored -- never needs a matching code change here.
 * @param {string} body
 * @returns {string}
 */
export function stripDeadSkillReferences(body) {
  return body.replace(/^\|.*\.agents\/skills\/([A-Za-z0-9_-]+)\/.*\|[ \t]*\r?\n?/gm, (row, name) =>
    VENDORED_SKILL_NAMES.has(name) ? row : "",
  );
}

/** @param {string} v @returns {string} */
function unquote(v) {
  const t = v.trim();
  if ((t.startsWith('"') && t.endsWith('"')) || (t.startsWith("'") && t.endsWith("'"))) {
    return t.slice(1, -1);
  }
  return t;
}

/**
 * Convert an ag-kit agent markdown for Claude Code: drop `skills:` and
 * `tools:` (unrestricted tool/MCP access instead of the vendored allowlist --
 * validateFrontmatter treats a missing `tools:` as a warning, not an error),
 * force `model: sonnet`, stamp provenance.
 * @param {string} content
 * @param {{ sourcePath: string, commit: string }} meta
 * @returns {string}
 */
export function cleanAgentMarkdown(content, meta) {
  const { frontmatter, body } = splitFrontmatter(content);
  let entries = parseFrontmatter(frontmatter).filter(
    (e) => e.key !== "skills" && e.key !== "model" && e.key !== "tools",
  );
  const name = entries.find((e) => e.key === "name")?.value ?? "";
  entries = applyCanonicalDescription(entries, name);
  entries.push({ key: "model", value: "sonnet" });
  const fm = renderFrontmatter(entries, { fold: new Set(["description"]) });
  let cleanedBody = stripDeadSkillReferences(body.replace(/^\n+/, ""));
  cleanedBody = swapCodeReviewGraphSetup(cleanedBody);
  cleanedBody = withAgentAvailabilityNote(cleanedBody);
  return `${fm}${provenanceComment(meta.sourcePath, meta.commit)}\n${cleanedBody}`;
}

/**
 * Convert an ag-kit SKILL.md for Claude Code: fold `when_to_use` into
 * `description` (Claude Code triggers on description, ignores when_to_use),
 * drop the when_to_use key, keep name/allowed-tools, stamp provenance.
 * @param {string} content
 * @param {{ sourcePath: string, commit: string }} meta
 * @returns {string}
 */
export function cleanSkillMarkdown(content, meta) {
  const { frontmatter, body } = splitFrontmatter(content);
  const entries = parseFrontmatter(frontmatter);
  const whenIdx = entries.findIndex((e) => e.key === "when_to_use");
  const descIdx = entries.findIndex((e) => e.key === "description");
  if (whenIdx !== -1) {
    const when = unquote(entries[whenIdx].value);
    if (descIdx !== -1 && when) {
      const desc = unquote(entries[descIdx].value);
      entries[descIdx].value = `${desc} ${when}`.trim();
    }
    entries.splice(whenIdx, 1);
  }
  const fm = renderFrontmatter(entries);
  let cleanedBody = body.replace(/^\n+/, "");
  cleanedBody = stripDeadSkillReferences(cleanedBody);
  cleanedBody = withAgentAvailabilityNote(cleanedBody);
  return `${fm}${provenanceComment(meta.sourcePath, meta.commit)}\n${cleanedBody}`;
}

/**
 * Shared assembly for provenance-stamped markdown: split frontmatter, run an
 * optional body transform, then stamp provenance after the frontmatter.
 * Internal -- stampMarkdown/cleanCommandMarkdown/cleanSkillSupportMarkdown
 * are the public entry points, each fixing a different bodyTransform.
 * @param {string} content
 * @param {{ sourcePath: string, commit: string }} meta
 * @param {(body: string) => string} [bodyTransform]
 * @returns {string}
 */
function stampBody(content, meta, bodyTransform = (b) => b) {
  const { frontmatter, body } = splitFrontmatter(content);
  const cleanedBody = bodyTransform(body.replace(/^\n+/, ""));
  return `${frontmatter}${provenanceComment(meta.sourcePath, meta.commit)}\n${cleanedBody}`;
}

/**
 * Stamp any markdown file with provenance after its optional frontmatter.
 * Works with or without a frontmatter block. Plain pass-through body --
 * cleanCommandMarkdown / cleanSkillSupportMarkdown are the variants that
 * also inject the availability note and/or strip dead skill references.
 * @param {string} content
 * @param {{ sourcePath: string, commit: string }} meta
 * @returns {string}
 */
export function stampMarkdown(content, meta) {
  return stampBody(content, meta);
}

/**
 * Keep a command verbatim (already Claude-Code-shaped: $ARGUMENTS, description
 * frontmatter) but stamp provenance after the frontmatter, and prepend the
 * same specialist-agent availability note as cleanAgentMarkdown/
 * cleanSkillMarkdown when the body mentions a stack-conditional agent —
 * AGKIT_COMMON commands (e.g. create.md, orchestrate.md) ship to every
 * project regardless of stack, same as common agents/skills.
 * @param {string} content
 * @param {{ sourcePath: string, commit: string }} meta
 * @returns {string}
 */
export function cleanCommandMarkdown(content, meta) {
  return stampBody(content, meta, withAgentAvailabilityNote);
}

/**
 * Clean a non-SKILL.md support file living inside a vendored skill directory
 * (e.g. app-builder/agent-coordination.md). sync-agkit.mjs only runs
 * cleanSkillMarkdown on a skill directory's SKILL.md; every sibling file
 * ships from the same upstream skill directory and can carry the same dead
 * script-path tables or conditional-agent mentions, so it gets the same two
 * body cleanups here.
 * @param {string} content
 * @param {{ sourcePath: string, commit: string }} meta
 * @returns {string}
 */
export function cleanSkillSupportMarkdown(content, meta) {
  return stampBody(content, meta, (b) => withAgentAvailabilityNote(stripDeadSkillReferences(b)));
}

/**
 * Strip "AG Kit" branding from a Python helper and stamp provenance (after the
 * shebang if present).
 * @param {string} content
 * @param {{ sourcePath: string, commit: string }} meta
 * @returns {string}
 */
export function cleanScript(content, meta) {
  const stripped = content.replace(/ ?- ?AG Kit/g, "").replace(/AG Kit/g, "ag-kit");
  const prov = `# Vendored from ag-kit (github.com/vudovn/ag-kit) @ ${meta.commit} :: ${meta.sourcePath}. MIT (c) vudovn.\n`;
  if (stripped.startsWith("#!")) {
    const nl = stripped.indexOf("\n");
    return stripped.slice(0, nl + 1) + prov + stripped.slice(nl + 1);
  }
  return prov + stripped;
}
