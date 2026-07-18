#!/usr/bin/env node
// PreToolUse[Agent]: force `sonnet` when a subagent dispatch has neither an
// explicit `model` nor a frontmatter-declared one, so a generic/ad-hoc
// dispatch never silently inherits the orchestrator's (often pricier) model.
//
// Rules:
//   1. Explicit `model` on the call            -> respected, no rewrite.
//   2. `.claude/agents/<type>.md` (project) or
//      `~/.claude/agents/<type>.md` (user) has
//      a `model:` in its frontmatter           -> respected, no rewrite.
//   3. Namespaced plugin agent (`plugin:name`) -> not rewritten: its
//      frontmatter lives under the plugin's own install path, which is
//      version-pinned and not reliably resolvable from here; forcing a
//      model here risks silently overriding a legitimate plugin-declared
//      one, which is worse than the gap it would close.
//   4. Anything else (built-in generic types, unset subagent_type, or a
//      project/user agent file with no `model:` key) -> forced to `sonnet`.
import { readFileSync, existsSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";

function readStdin() {
  try {
    return readFileSync(0, "utf8");
  } catch {
    return "";
  }
}

/** @param {string} file @returns {boolean} */
function hasFrontmatterModel(file) {
  if (!existsSync(file)) return false;
  const text = readFileSync(file, "utf8");
  if (!text.startsWith("---")) return false;
  const frontmatter = text.split("\n---")[0];
  return /^model:[ \t]*\S/m.test(frontmatter);
}

try {
  const event = JSON.parse(readStdin() || "{}");
  const t = event.tool_input ?? {};

  if (t.model) process.exit(0); // rule 1: explicit choice on the call

  const type =
    typeof t.subagent_type === "string" && t.subagent_type ? t.subagent_type : "general-purpose";

  if (type.includes(":")) process.exit(0); // rule 3: plugin agent, don't guess
  if (!/^[\w.-]+$/.test(type)) process.exit(0); // unexpected shape, don't guess

  const cwdArg = typeof event.cwd === "string" && event.cwd ? event.cwd : "";
  const projectDir = cwdArg || process.env.CLAUDE_PROJECT_DIR || process.cwd();

  const candidates = [
    path.join(projectDir, ".claude", "agents", `${type}.md`),
    path.join(homedir(), ".claude", "agents", `${type}.md`),
  ];
  if (candidates.some(hasFrontmatterModel)) process.exit(0); // rule 2: frontmatter wins

  process.stdout.write(
    JSON.stringify({
      hookSpecificOutput: {
        hookEventName: "PreToolUse",
        updatedInput: { ...t, model: "sonnet" },
      },
    }),
  );
  process.exit(0);
} catch {
  process.exit(0); // fail-open: never block a subagent dispatch
}
