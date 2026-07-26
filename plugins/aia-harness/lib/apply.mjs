/**
 * Apply a harness plan to disk. Safe by default: never overwrites an existing,
 * differing file unless `force` is set; updates `.gitignore` idempotently.
 *
 * @module apply
 */
import fs from "node:fs";
import path from "node:path";
import { readText, isDir } from "./util/fs.mjs";
import { GITIGNORE_HEADER } from "./util/gitignore.mjs";
import { detectAssetType, validateFrontmatter } from "./validate/frontmatter.mjs";

/**
 * @typedef {Object} ApplyResult
 * @property {string[]} created
 * @property {string[]} updated
 * @property {string[]} skipped
 * @property {{ path: string, error: string }[]} errors
 * @property {boolean} dryRun
 * @property {{ id: string, relPath: string, category: string }[]} differs  Legacy: the pre-merge-default skip-and-report list. Populated only when a caller passes `merge: false` explicitly — the CLI never does, so `apply --json` output always has this empty. See `conflicts` instead.
 * @property {{ id: string, relPath: string, category: string, pendingPath: string }[]} conflicts
 */

/**
 * Merge incoming settings.json content into existing settings.json content.
 * Pure function — no IO. Purely additive, exactly like the hook merge this
 * function generalizes: for every key below, once a value already exists in
 * `existing` it always wins — this function only ever ADDS what's missing,
 * it never repairs or overwrites a value the target already has (see
 * `.claude/memory/merge-settings-hooks-dedup-key.md`).
 *
 * Merge rules, applied key by key:
 *   - `permissions.allow` / `permissions.deny` / `permissions.additionalDirectories`
 *     — array union: existing entries are kept in their existing order, then
 *     any incoming entry not already present (exact string match) is appended.
 *   - `env` / `enabledPlugins` / `extraKnownMarketplaces` — object union by
 *     key: an incoming key absent from existing is added; a key that already
 *     exists in existing is left exactly as it is, never overwritten.
 *   - `hooks` — matcher groups are unioned by matcher string; within each
 *     group, hooks[] entries are unioned by serialized {command, args}
 *     identity (see `hookKey` below). Unchanged from before this function
 *     was generalized from hooks-only to every settings.json key.
 *   - every other key (`$schema`, `model`, `permissions.defaultMode`,
 *     `worktree`, the top-level booleans, ...) — the existing value is kept
 *     when the key is already present; the incoming value is added only when
 *     the key is entirely absent from existing.
 *
 * Exception: wherever a merge step below expects a particular shape from
 * `existing` — a plain object at a handled top-level key (`permissions`;
 * `env` / `enabledPlugins` / `extraKnownMarketplaces`; `hooks`), an array at
 * `permissions.allow` / `.deny` / `.additionalDirectories`, or an array at
 * either level inside `hooks` (an event's matcher-group list, or one
 * group's own `hooks[]`) — an existing value of the wrong shape is not
 * preserved. It is discarded, and that position is rebuilt from `incoming`
 * alone: "existing always wins" holds only for a value that already has the
 * shape the merge expects. This is the opposite of `mergeMcpJson`'s choice
 * for a malformed `existing.mcpServers`, which is left untouched verbatim —
 * see that function's docstring for why. The catch-all "every other key"
 * rule below never inspects a value's shape, so it has no such exception.
 *
 * @param {string} existingJson
 * @param {string} incomingJson
 * @returns {string} merged JSON string (2-space indent, trailing newline)
 */
export function mergeSettingsJson(existingJson, incomingJson) {
  const existing = JSON.parse(existingJson);
  const incoming = JSON.parse(incomingJson);

  /** @param {unknown} v */
  const isPlainObject = (v) => v != null && typeof v === "object" && !Array.isArray(v);

  const merged = { ...existing };

  // permissions.{allow,deny,additionalDirectories}: array union. Every other
  // key inside permissions (e.g. defaultMode) follows the generic keep-
  // existing/add-if-absent rule below, same as any other top-level key.
  const ARRAY_UNION_PERMISSION_KEYS = ["allow", "deny", "additionalDirectories"];
  if (isPlainObject(incoming.permissions)) {
    const mergedPerms = { ...(isPlainObject(merged.permissions) ? merged.permissions : {}) };
    for (const key of ARRAY_UNION_PERMISSION_KEYS) {
      if (!Array.isArray(incoming.permissions[key])) continue;
      const existingArr = Array.isArray(mergedPerms[key]) ? mergedPerms[key] : [];
      const seen = new Set(existingArr);
      const unioned = [...existingArr];
      for (const v of incoming.permissions[key]) {
        if (!seen.has(v)) {
          seen.add(v);
          unioned.push(v);
        }
      }
      mergedPerms[key] = unioned;
    }
    for (const [k, v] of Object.entries(incoming.permissions)) {
      if (ARRAY_UNION_PERMISSION_KEYS.includes(k)) continue;
      if (!(k in mergedPerms)) mergedPerms[k] = v;
    }
    merged.permissions = mergedPerms;
  }

  // env / enabledPlugins / extraKnownMarketplaces: object union by key.
  for (const key of ["env", "enabledPlugins", "extraKnownMarketplaces"]) {
    if (!isPlainObject(incoming[key])) continue;
    const mergedObj = { ...(isPlainObject(merged[key]) ? merged[key] : {}) };
    for (const [k, v] of Object.entries(incoming[key])) {
      if (!(k in mergedObj)) mergedObj[k] = v;
    }
    merged[key] = mergedObj;
  }

  // hooks: unchanged behaviour from before this function covered anything
  // beyond hooks.
  if (isPlainObject(incoming.hooks)) {
    if (!isPlainObject(merged.hooks)) merged.hooks = {};

    /**
     * Normalizes placeholder bracing for key computation ONLY — the stored
     * hook object (whichever one wins) is never rewritten by this function.
     * A bare $CLAUDE_PROJECT_DIR and a braced ${CLAUDE_PROJECT_DIR} refer to
     * the same hook; without this, a routine re-apply after a placeholder
     * fix would add a duplicate instead of recognizing the hook as already
     * present.
     * @param {unknown} v
     */
    const normalizePlaceholders = (v) =>
      typeof v === "string"
        ? v.replace(
            /\$(?!\{)(CLAUDE_PROJECT_DIR|CLAUDE_PLUGIN_ROOT|CLAUDE_PLUGIN_DATA)\b/g,
            "${$1}",
          )
        : v;

    /** @param {{ command?: unknown, args?: unknown }} h */
    const hookKey = (h) =>
      JSON.stringify({
        command: normalizePlaceholders(h.command),
        args: Array.isArray(h.args) ? h.args.map(normalizePlaceholders) : h.args,
      });

    for (const [eventKey, incomingGroups] of Object.entries(incoming.hooks)) {
      if (!Array.isArray(incomingGroups)) continue;

      if (!Array.isArray(merged.hooks[eventKey])) {
        merged.hooks[eventKey] = incomingGroups;
        continue;
      }

      const existingGroups = merged.hooks[eventKey];
      const result = [...existingGroups];

      for (const inGroup of incomingGroups) {
        const matcherStr = inGroup.matcher ?? "";
        const exIdx = result.findIndex((g) => (g.matcher ?? "") === matcherStr);

        if (exIdx === -1) {
          result.push(inGroup);
          continue;
        }

        const exGroup = result[exIdx];
        const exHooks = Array.isArray(exGroup.hooks) ? exGroup.hooks : [];
        const inHooks = Array.isArray(inGroup.hooks) ? inGroup.hooks : [];

        const seen = new Set(exHooks.map(hookKey));
        const unioned = [...exHooks];
        for (const h of inHooks) {
          const key = hookKey(h);
          if (!seen.has(key)) {
            seen.add(key);
            unioned.push(h);
          }
        }

        result[exIdx] = { ...exGroup, hooks: unioned };
      }

      merged.hooks[eventKey] = result;
    }
  }

  // Every other key: keep the existing value when present, add the incoming
  // value only when the key is entirely absent from existing.
  const HANDLED_TOP_LEVEL_KEYS = new Set([
    "permissions",
    "env",
    "enabledPlugins",
    "extraKnownMarketplaces",
    "hooks",
  ]);
  for (const [k, v] of Object.entries(incoming)) {
    if (HANDLED_TOP_LEVEL_KEYS.has(k)) continue;
    if (!(k in merged)) merged[k] = v;
  }

  return JSON.stringify(merged, null, 2) + "\n";
}

/**
 * Merge incoming `.mcp.json` content into existing `.mcp.json` content. Pure
 * function — no IO. Same additive-only contract as `mergeSettingsJson`: once a
 * server is already declared in `existing`, it always wins — its `env`
 * placeholders and args are the user's — this function only ever ADDS a
 * server that's missing, it never repairs or overwrites one the target
 * already has.
 *
 * Merge rules:
 *   - `mcpServers` — object union by server key: an incoming server absent
 *     from existing is added; a server that already exists in existing is
 *     left exactly as it is, never overwritten.
 *   - every other top-level key — the existing value is kept when the key is
 *     already present; the incoming value is added only when the key is
 *     entirely absent from existing.
 *
 * Deliberate choice for a malformed `existing.mcpServers` (present but not a
 * plain object — e.g. hand-edited into a string or array): it is left
 * completely untouched rather than discarded. This differs from how the
 * array/object-union keys in `mergeSettingsJson` handle the same situation
 * (they coerce a malformed existing value to `{}` and rebuild it from
 * incoming, silently discarding whatever was there) — here, a value that
 * isn't a usable object has no defined slot to add an incoming server into,
 * so nothing is added and the existing (malformed) value survives verbatim.
 * "Existing always wins" is read literally, including when existing is
 * malformed.
 *
 * @param {string} existingJson
 * @param {string} incomingJson
 * @returns {string} merged JSON string (2-space indent, trailing newline)
 */
export function mergeMcpJson(existingJson, incomingJson) {
  const existing = JSON.parse(existingJson);
  const incoming = JSON.parse(incomingJson);

  /** @param {unknown} v */
  const isPlainObject = (v) => v != null && typeof v === "object" && !Array.isArray(v);

  const merged = { ...existing };

  if (isPlainObject(incoming.mcpServers)) {
    if (isPlainObject(merged.mcpServers)) {
      const mergedServers = { ...merged.mcpServers };
      for (const [name, cfg] of Object.entries(incoming.mcpServers)) {
        if (!(name in mergedServers)) mergedServers[name] = cfg;
      }
      merged.mcpServers = mergedServers;
    } else if (!("mcpServers" in merged)) {
      merged.mcpServers = incoming.mcpServers;
    }
    // else: existing.mcpServers is present but not a plain object — left
    // exactly as the initial spread copied it; see docstring above.
  }

  // Every other top-level key: keep the existing value when present, add
  // the incoming value only when the key is entirely absent from existing.
  for (const [k, v] of Object.entries(incoming)) {
    if (k === "mcpServers") continue;
    if (!(k in merged)) merged[k] = v;
  }

  return JSON.stringify(merged, null, 2) + "\n";
}

/**
 * Append any line present in `incoming` but missing (exact trimmed match) from
 * `existing`, preserving existing content/order/user edits untouched. Used for
 * line-list manifests (e.g. `.worktreeinclude`) so a tool installed *after* the
 * file already exists (e.g. graphify added via `/add-tools` post-`/init`) still
 * gets its required line patched in on the next `apply`, without clobbering
 * anything the user added by hand.
 * @param {string} existingContent
 * @param {string} incomingContent
 * @returns {string}
 */
export function mergeLines(existingContent, incomingContent) {
  const existingSet = new Set(existingContent.split(/\r?\n/).map((l) => l.trim()));
  const missing = incomingContent
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l !== "" && !existingSet.has(l));
  if (missing.length === 0) return existingContent;
  const base = existingContent.endsWith("\n") ? existingContent : `${existingContent}\n`;
  return base + missing.join("\n") + "\n";
}

/**
 * Cut `content` into blocks, starting a new one before every heading of level
 * `maxLevel` or shallower (fewer/equal `#`). A shallower heading therefore
 * always starts its own block and can never be absorbed into — and deleted
 * with — a block being replaced; deeper headings stay inside their block.
 * Empty blocks are dropped. Pure.
 *
 * Heading-shaped lines **inside a fenced code block** (```` ``` ````/`~~~`) are
 * not headings and never start a block: callers rejoin blocks with a blank line
 * between them, so splitting on a `# install deps` comment inside a shell fence
 * injects blank lines into the middle of the user's fence. Hence the line walk
 * instead of the one-line `content.split(/(?=^#{1,N} .+$)/m)` this replaced.
 * @param {string} content
 * @param {number} maxLevel  Deepest heading level (1-6) that starts a new block.
 * @returns {string[]}
 */
function splitOnHeadings(content, maxLevel) {
  const headingRe = new RegExp(`^#{1,${maxLevel}} .+$`);
  const fenceRe = /^ {0,3}(`{3,}|~{3,})/;
  /** @type {string[][]} */
  const blocks = [];
  /** @type {string[]} */
  let current = [];
  /** @type {string|null} */
  let openFence = null;

  for (const line of content.split("\n")) {
    const fence = line.match(fenceRe)?.[1] ?? null;
    if (openFence !== null) {
      // A closing fence uses the same character and is at least as long.
      if (fence && fence[0] === openFence[0] && fence.length >= openFence.length) openFence = null;
    } else if (fence !== null) {
      openFence = fence;
    } else if (headingRe.test(line) && current.length > 0) {
      blocks.push(current);
      current = [];
    }
    current.push(line);
  }
  blocks.push(current);

  return blocks.map((b) => b.join("\n")).filter((b) => b.trim() !== "");
}

/**
 * Ensure a single markdown section from `incoming` is present and current
 * inside `existing`, touching no other section. The level is taken from
 * `incoming` itself (its first `#`-`######` line), so callers are not limited
 * to top-level (`# `) sections. If a section with the same header already
 * exists, its block is replaced in place; otherwise the incoming block is
 * appended. Used so a vendored tool (e.g. graphify) can keep its trigger
 * section current in a shared, hand-editable file (root `CLAUDE.md`,
 * `.claude/CLAUDE.md`) across re-applies without clobbering sibling sections a
 * user wrote by hand — and, at a nested level (e.g. `## `), so one subsection
 * of a larger document (e.g. one heading inside
 * `.claude/memory/INSTRUCTIONS.md`) can be refreshed without touching the rest.
 *
 * A section's block runs from its heading until the next heading of the **same
 * or shallower** level (fewer/equal `#`), so a `## ` section being replaced
 * never swallows a following `# ` sibling (e.g. merging a `## graphify` block
 * into a root `CLAUDE.md` must not delete a later `# obsidian-vault` section).
 * Deeper headings (more `#`) stay within the section, as intended.
 *
 * Also reports `sectionPresent`: whether `header` already had a block in
 * `existingContent` (replaced) vs. not (freshly appended). `applyPlan`'s
 * `merge-section` branch needs that distinction under `merge: true`, to tell
 * "nothing to lose, safe to append" apart from "would discard the existing
 * block's content, park as a conflict instead" — this function already
 * computes it internally (`idx === -1` vs not), so it's exposed here rather
 * than re-derived at the call site. `mergeMarkdownSection` below is a thin
 * wrapper that keeps the plain-string return its existing callers rely on.
 *
 * Blocks come from `splitOnHeadings` above, which is also what keeps a
 * heading-shaped line inside a fenced code block from being treated as a
 * heading — see its docstring.
 * @param {string} existingContent
 * @param {string} incomingContent  Exactly one heading-led section, any level `#` through `######`.
 * @returns {{ merged: string, sectionPresent: boolean }}
 */
export function mergeMarkdownSectionStatus(existingContent, incomingContent) {
  const headerMatch = incomingContent.match(/^(#{1,6}) .+$/m);
  if (!headerMatch) return { merged: existingContent, sectionPresent: false };
  const level = headerMatch[1];
  const header = headerMatch[0];
  const incomingBlock = incomingContent.trim();
  if (!existingContent.trim()) return { merged: incomingBlock + "\n", sectionPresent: false };

  const blocks = splitOnHeadings(existingContent, level.length);
  const idx = blocks.findIndex((b) => b.split("\n")[0] === header);
  const sectionPresent = idx !== -1;
  if (idx === -1) blocks.push(incomingBlock);
  else blocks[idx] = incomingBlock;

  return { merged: blocks.map((b) => b.trim()).join("\n\n") + "\n", sectionPresent };
}

/**
 * `mergeMarkdownSectionStatus(existingContent, incomingContent).merged` —
 * same merge, minus the `sectionPresent` flag. Kept as the stable, pure,
 * string-returning entry point for callers (and unit tests) that only need
 * the merged content.
 * @param {string} existingContent
 * @param {string} incomingContent  Exactly one heading-led section, any level `#` through `######`.
 * @returns {string}
 */
export function mergeMarkdownSection(existingContent, incomingContent) {
  return mergeMarkdownSectionStatus(existingContent, incomingContent).merged;
}

const PENDING_DIR = ".claude/.aia-harness-pending";

/**
 * Absolute path where a conflicting artifact's freshly rendered content is
 * parked for review: `.claude/.aia-harness-pending/<id-slug>/<relPath>`.
 *
 * Keyed by **artifact id**, not by `relPath` alone, because several artifacts
 * legitimately target the same file — root `CLAUDE.md` is written by
 * `claude-md-root` and refreshed by the `claude-md:graphify-root` /
 * `obsidian:claude-md` merge-sections; `.claude/memory/INSTRUCTIONS.md` by
 * `claude-md:memory-instructions` and `obsidian:memory-instructions` — and a
 * single apply run routinely conflicts on more than one of them. With
 * a `relPath`-only path the second conflict silently overwrote the first, so the
 * user adjudicated a diff that did not describe the artifact it was labelled
 * with, and the other artifact's content was gone with nothing in `errors`.
 *
 * The id is slugified into one path segment: `:` (in `claude-md:graphify-root`)
 * is illegal in a Windows filename and `/` (in `rule:.claude/rules/x.md`) is a
 * separator everywhere, so every run of characters outside `[A-Za-z0-9._-]`
 * collapses to a single `-`.
 * @param {string} root
 * @param {string} id
 * @param {string} relPath
 * @returns {string}
 */
function pendingPathFor(root, id, relPath) {
  return path.join(root, PENDING_DIR, id.replace(/[^A-Za-z0-9._-]+/g, "-"), relPath);
}

/**
 * @param {string} root
 * @param {string[]} entries
 * @param {boolean} dryRun
 * @returns {boolean} whether the gitignore was (or would be) changed
 */
function ensureGitignore(root, entries, dryRun) {
  const file = path.join(root, ".gitignore");
  const current = readText(file) ?? "";
  const lines = new Set(current.split(/\r?\n/).map((l) => l.trim()));
  const missing = entries.filter((e) => !lines.has(e));
  if (missing.length === 0) return false;
  if (!dryRun) {
    const addition = `${current && !current.endsWith("\n") ? "\n" : ""}${GITIGNORE_HEADER}\n${missing.join("\n")}\n`;
    fs.appendFileSync(file, addition);
  }
  return true;
}

/**
 * @param {import('./plan.mjs').HarnessPlan} plan
 * @param {string} root
 * @param {{ selected?: Set<string>, dryRun?: boolean, force?: boolean, merge?: boolean }} [opts]
 * @returns {ApplyResult}
 */
export function applyPlan(plan, root, opts = {}) {
  const dryRun = opts.dryRun ?? false;
  const force = opts.force ?? false;
  // Merge is the default: a caller that wants the legacy skip-and-report
  // path (populating `differs` instead of `conflicts`) must pass
  // `merge: false` explicitly.
  const merge = opts.merge ?? true;
  const selected = opts.selected;

  /** @type {ApplyResult} */
  const result = {
    created: [],
    updated: [],
    skipped: [],
    errors: [],
    dryRun,
    differs: [],
    conflicts: [],
  };

  for (const a of plan.artifacts) {
    if (selected ? !selected.has(a.id) : !a.defaultSelected) continue;

    const target = path.join(root, a.relPath);

    // Directory artifact (e.g. a vendored ECC skill or mirrored rule dir).
    if (a.content == null && a.copyFrom && isDir(a.copyFrom)) {
      const dirExists = fs.existsSync(target);
      // Existing dirs are left intact unless `force` (refresh: rm + recopy —
      // the deliberate, narrowly-scoped escape hatch for a full vendored
      // skill/hook dir refresh) or `merge` (per-file: create/skip-identical/
      // park a conflict for anything the user changed — same precedence as
      // the single-file path, `force` wins outright).
      if (dirExists && !force) {
        if (merge) {
          mergeDirectory(a, a.copyFrom, target, root, dryRun, result);
        } else {
          result.skipped.push(`${a.relPath}/ (exists)`);
        }
        continue;
      }
      if (!dryRun) {
        if (dirExists) fs.rmSync(target, { recursive: true, force: true });
        fs.cpSync(a.copyFrom, target, { recursive: true });
      }
      result[dirExists ? "updated" : "created"].push(`${a.relPath}/`);
      continue;
    }

    let content = a.content;
    if (content == null && a.copyFrom) content = readText(a.copyFrom);
    if (content == null) {
      result.errors.push({ path: a.relPath, error: "no inline content and source file missing" });
      continue;
    }

    // Normalize frontmatter for distributed .md assets before writing.
    // Errors are auto-fixed silently; warnings are a dev-time concern already
    // resolved in templates by scripts/normalize-frontmatter.mjs.
    if (a.relPath.endsWith(".md")) {
      // relPath in target project is like .claude/agents/foo.md — extract the
      // segment that detectAssetType understands (agents/, skills/, etc.)
      const segMatch = a.relPath.match(/\/(agents|skills|commands|rules)\//);
      if (segMatch) {
        const fakeRel = `x/${segMatch[1]}/${path.basename(a.relPath)}`;
        const type = detectAssetType(fakeRel);
        if (type) {
          const { valid, errors: fmErrors, normalized } = validateFrontmatter(content, type);
          if (!valid) {
            process.stderr.write(
              `[apply] frontmatter: ${a.relPath}: auto-fixed: ${fmErrors.join("; ")}\n`,
            );
            content = normalized;
          }
        }
      }
    }

    if (fs.existsSync(target)) {
      const cur = readText(target);
      if (cur === content) {
        result.skipped.push(`${a.relPath} (identical)`);
        continue;
      }
      if (!force) {
        if (a.mergeStrategy === "merge-settings") {
          if (cur == null) {
            result.errors.push({
              path: a.relPath,
              error: "could not read existing file for merge",
            });
            continue;
          }
          try {
            content = mergeSettingsJson(cur, content);
          } catch (e) {
            result.errors.push({
              path: a.relPath,
              error: `mergeSettingsJson failed: ${e instanceof Error ? e.message : String(e)}`,
            });
            continue;
          }
          if (content === cur) {
            result.skipped.push(`${a.relPath} (identical after merge)`);
            continue;
          }
          // fall through to write
        } else if (a.mergeStrategy === "merge-mcp") {
          if (cur == null) {
            result.errors.push({
              path: a.relPath,
              error: "could not read existing file for merge",
            });
            continue;
          }
          try {
            content = mergeMcpJson(cur, content);
          } catch (e) {
            result.errors.push({
              path: a.relPath,
              error: `mergeMcpJson failed: ${e instanceof Error ? e.message : String(e)}`,
            });
            continue;
          }
          if (content === cur) {
            result.skipped.push(`${a.relPath} (identical after merge)`);
            continue;
          }
          // fall through to write
        } else if (a.mergeStrategy === "merge-lines") {
          if (cur == null) {
            result.errors.push({
              path: a.relPath,
              error: "could not read existing file for merge",
            });
            continue;
          }
          content = mergeLines(cur, content);
          if (content === cur) {
            result.skipped.push(`${a.relPath} (identical after merge)`);
            continue;
          }
          // fall through to write
        } else if (a.mergeStrategy === "merge-section") {
          if (cur == null) {
            result.errors.push({
              path: a.relPath,
              error: "could not read existing file for merge",
            });
            continue;
          }
          const { merged, sectionPresent } = mergeMarkdownSectionStatus(cur, content);
          if (merged === cur) {
            result.skipped.push(`${a.relPath} (identical after merge)`);
            continue;
          }
          if (merge && sectionPresent) {
            // The section exists and differs: replacing it in place (as the
            // branch below still does outside merge mode) would silently
            // discard whatever the user wrote inside it — the exact
            // data-loss this flag exists to prevent. Park the merged
            // *file* (not the lone incoming section) at the pending path,
            // so the adjudication diff shows only what the replacement would
            // actually change, not "delete everything else in the file".
            const pendingPath = pendingPathFor(root, a.id, a.relPath);
            // Deliberately unguarded, unlike mergeDirectory's per-entry try/catch:
            // every read of the *target* on this path already went through the
            // guarded `readText`, and `pendingPath` is a fresh file this run
            // creates under `.claude/`, not a user file that can be locked.
            if (!dryRun) writeFile(pendingPath, merged, a.executable);
            result.conflicts.push({
              id: a.id,
              relPath: a.relPath,
              category: a.category,
              pendingPath,
            });
            result.skipped.push(`${a.relPath} (conflict — pending review)`);
            continue;
          }
          content = merged;
          // fall through to write (section absent -> mechanical append, same
          // as always; section present and merge:false -> replace in place,
          // same as always)
        } else if (merge) {
          // No mechanical merge strategy for this artifact: don't overwrite the
          // target. Park the freshly rendered content for manual review instead.
          const pendingPath = pendingPathFor(root, a.id, a.relPath);
          // Unguarded for the same reason as the merge-section branch above.
          if (!dryRun) writeFile(pendingPath, content, a.executable);
          result.conflicts.push({
            id: a.id,
            relPath: a.relPath,
            category: a.category,
            pendingPath,
          });
          result.skipped.push(`${a.relPath} (conflict — pending review)`);
          continue;
        } else {
          result.differs.push({ id: a.id, relPath: a.relPath, category: a.category });
          result.skipped.push(`${a.relPath} (exists, differs — left unchanged)`);
          continue;
        }
      }
      if (!dryRun) writeFile(target, content, a.executable);
      result.updated.push(a.relPath);
      continue;
    }

    if (!dryRun) writeFile(target, content, a.executable);
    result.created.push(a.relPath);
  }

  ensureGitignore(root, plan.gitignore, dryRun);
  return result;
}

/**
 * @param {string} target
 * @param {string} content
 * @param {boolean} executable
 */
function writeFile(target, content, executable) {
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, content);
  if (executable) fs.chmodSync(target, 0o755);
}

/**
 * Merge a source directory into an already-existing target directory, one
 * file at a time, reusing the same classification the single-file `merge`
 * branch above uses: missing in target -> copy; present and identical ->
 * skip; present and differs -> leave the target untouched and park the
 * freshly rendered file at the pending path as a `conflicts[]` entry. Files
 * present only in the target (user-added) are never visited, so they are
 * never touched or reported.
 *
 * Recurses with `fs.readdirSync` + `fs.statSync` rather than a single
 * `fs.cpSync` call: `fs.cpSync`'s `dereference` option only resolves the
 * top-level `src` argument, not a symlink found while walking nested
 * directory contents (confirmed empirically on Node v24 — see
 * `copyDereferenced()` in `templates/hooks/worktree-create.mjs` for the same
 * pattern). Using `statSync` (which follows symlinks) instead of
 * `Dirent.isDirectory()` for the type check, and `copyFileSync` per file
 * (which preserves the source file's own mode) sidesteps that gap file by
 * file instead of relying on a single recursive dereference. A dangling
 * symlink (the `statSync` call itself throwing) is caught and reported as
 * an error for that one entry, same as `copyDereferenced()` does.
 *
 * A source/target type mismatch — a directory where the target has a plain
 * file, or vice versa (e.g. a vendored skill restructured between catalog
 * versions while the user's installed copy still has the old shape) — has
 * no meaningful file diff to park as a `conflicts[]` pending review, so it
 * is reported via `result.errors` instead of attempted. The directory-side
 * check sits once at the top of the function so every recursive call
 * re-enters through it, covering every depth including the artifact's own
 * root; the reverse (file-side) check sits in the per-entry loop below.
 *
 * Every other fs call that can throw for a single entry — reading the
 * source directory listing, and the create/compare/park operations for one
 * file (`readFileSync`, `copyFileSync`, `mkdirSync`) — is likewise caught
 * and reported via `result.errors` for that one entry (or, for the listing
 * itself, that one directory) rather than propagating out of `applyPlan`.
 * A permission-restricted file is the realistic POSIX trigger; on Windows,
 * a file locked by an editor, antivirus, or OneDrive.
 *
 * `relPath` is normalized to forward slashes (`path.relative` yields
 * OS-native separators) to match every other `relPath` in this system.
 *
 * @param {import('./plan.mjs').Artifact} artifact  The directory artifact (for `id`/`category` on conflicts).
 * @param {string} srcDir     Absolute path to the source directory being walked.
 * @param {string} targetDir  Absolute path to the matching target directory.
 * @param {string} root       Project root, for root-relative paths in the result.
 * @param {boolean} dryRun
 * @param {ApplyResult} result
 */
function mergeDirectory(artifact, srcDir, targetDir, root, dryRun, result) {
  if (fs.existsSync(targetDir) && !isDir(targetDir)) {
    result.errors.push({
      path: path.relative(root, targetDir).split(path.sep).join("/"),
      error: "target exists and is not a directory — source expects a directory here, skipped",
    });
    return;
  }

  let names;
  try {
    names = fs.readdirSync(srcDir);
  } catch (err) {
    result.errors.push({
      path: path.relative(root, targetDir).split(path.sep).join("/"),
      error: `could not read source directory: ${err instanceof Error ? err.message : String(err)}`,
    });
    return;
  }

  for (const name of names) {
    const srcPath = path.join(srcDir, name);
    const targetPath = path.join(targetDir, name);
    const relPath = path.relative(root, targetPath).split(path.sep).join("/");

    let st;
    try {
      st = fs.statSync(srcPath); // follows symlinks, unlike Dirent.isDirectory()
    } catch (err) {
      result.errors.push({
        path: relPath,
        error: `could not stat source entry (dangling symlink?): ${err instanceof Error ? err.message : String(err)}`,
      });
      continue;
    }

    if (st.isDirectory()) {
      mergeDirectory(artifact, srcPath, targetPath, root, dryRun, result);
      continue;
    }

    if (fs.existsSync(targetPath) && isDir(targetPath)) {
      result.errors.push({
        path: relPath,
        error: "target exists and is a directory — source expects a file here, skipped",
      });
      continue;
    }

    // A locked/permission-restricted file (an editor, antivirus, or OneDrive
    // hold on Windows; a permission bit on POSIX) can make any of the reads
    // or writes below throw. Guarded per-entry, same as the statSync above,
    // so one bad file is reported and the rest of the directory still merges.
    try {
      if (!fs.existsSync(targetPath)) {
        if (!dryRun) {
          fs.mkdirSync(path.dirname(targetPath), { recursive: true });
          fs.copyFileSync(srcPath, targetPath);
        }
        result.created.push(relPath);
        continue;
      }

      if (fs.readFileSync(srcPath).equals(fs.readFileSync(targetPath))) {
        result.skipped.push(`${relPath} (identical)`);
        continue;
      }

      const pendingPath = pendingPathFor(root, artifact.id, relPath);
      if (!dryRun) {
        fs.mkdirSync(path.dirname(pendingPath), { recursive: true });
        fs.copyFileSync(srcPath, pendingPath);
      }
      result.conflicts.push({ id: artifact.id, relPath, category: artifact.category, pendingPath });
      result.skipped.push(`${relPath} (conflict — pending review)`);
    } catch (err) {
      result.errors.push({
        path: relPath,
        error: `could not merge file: ${err instanceof Error ? err.message : String(err)}`,
      });
    }
  }
}
