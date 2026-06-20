/**
 * Add all hook artifacts (static files, stack-specific, and generated) to a plan.
 * Extracted from plan.mjs to keep that orchestrator under 350 lines.
 * @module plan/hook-artifacts
 */
import path from "node:path";
import { renderFormatOnEdit } from "../generate/format-hook.mjs";
import { PROJECT_HOOK_FILES } from "../data/asset-catalog.mjs";

/** @typedef {import('../profile.mjs').ProjectProfile} ProjectProfile */

/**
 * @typedef {{ files: string[], settings: Record<string, any[]> }} StackHooks
 */

/**
 * @typedef {(a: any) => void} AddFn
 */

/**
 * Add all hook artifacts to the plan.
 *
 * @param {AddFn} add
 * @param {string} pluginRoot
 * @param {ProjectProfile} profile
 * @param {{ strict: boolean, verifyOnStopSrc: string|null, stackHooks: StackHooks }} opts
 */
export function addHookArtifacts(add, pluginRoot, profile, { strict, verifyOnStopSrc, stackHooks }) {
  const hooksDir = path.join(pluginRoot, "templates", "hooks");

  for (const f of PROJECT_HOOK_FILES) {
    add({
      id: `hook:${f}`,
      relPath: `.claude/hooks/${f}`,
      title: `Hook: ${f}`,
      category: "hooks",
      rationale: "JS hook script / node-resolver wrapper.",
      contextCost: 0,
      defaultSelected: true,
      copyFrom: path.join(hooksDir, f),
      executable: f.endsWith(".sh"),
    });
  }

  for (const f of stackHooks.files) {
    add({
      id: `hook:${f}`,
      relPath: `.claude/hooks/${f}`,
      title: `Hook: ${f}`,
      category: "hooks",
      rationale: "Stack-specific first-party hook (wired in settings.json).",
      contextCost: 0,
      defaultSelected: true,
      copyFrom: path.join(hooksDir, f),
    });
  }

  add({
    id: "hook:format-on-edit.mjs",
    relPath: ".claude/hooks/format-on-edit.mjs",
    title: "Hook: format-on-edit.mjs",
    category: "hooks",
    rationale: "PostToolUse: formats files on edit using language-aware formatter discovery.",
    contextCost: 0,
    defaultSelected: true,
    content: renderFormatOnEdit(profile),
  });

  if (strict) {
    add({
      id: "hook:verify-on-stop.mjs",
      relPath: ".claude/hooks/verify-on-stop.mjs",
      title: "Hook: verify-on-stop.mjs (strict)",
      category: "hooks",
      rationale: "Strict Stop hook: runs lint + typecheck, blocks until they pass so Claude self-corrects.",
      contextCost: 0,
      defaultSelected: true,
      content: verifyOnStopSrc,
    });
  } else {
    add({
      id: "hook:verify-on-stop.mjs",
      relPath: ".claude/hooks/verify-on-stop.mjs",
      title: "Hook: verify-on-stop.mjs",
      category: "hooks",
      rationale: "Non-blocking Stop reminder to run lint & tests before wrapping up.",
      contextCost: 0,
      defaultSelected: true,
      copyFrom: path.join(hooksDir, "verify-on-stop.mjs"),
    });
  }

  add({
    id: "hook:set-files-changed.mjs",
    relPath: ".claude/hooks/set-files-changed.mjs",
    title: "Hook: set-files-changed.mjs",
    category: "hooks",
    rationale: "Records session-edited files for Stop hooks (verify-on-stop, large-file-warning, memory-stop).",
    contextCost: 0,
    defaultSelected: true,
    copyFrom: path.join(hooksDir, "set-files-changed.mjs"),
  });
}
