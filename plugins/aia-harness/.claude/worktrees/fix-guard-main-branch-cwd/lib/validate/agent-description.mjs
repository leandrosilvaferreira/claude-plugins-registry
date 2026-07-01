/**
 * Standard for agent routing descriptions + helpers to apply the canonical
 * description from the catalog maps onto parsed frontmatter entries. Pure — no IO.
 *
 * @module validate/agent-description
 */
import { resolveCanonicalDescription } from "../data/asset-catalog.mjs";

const MIN_LEN = 40;
const MAX_LEN = 600;
/** Signals that a description tells Claude WHEN to use the agent. */
const TRIGGER_RE =
  /\b(use proactively|MUST BE USED|use (this )?(agent )?(when|after|before|for)|proactively|when |after |before )/i;

/**
 * Validate one routing description against the best-practice standard.
 * @param {string} value
 * @returns {{ ok: boolean, violations: string[] }}
 */
export function checkAgentDescription(value) {
  /** @type {string[]} */
  const violations = [];
  const v = (value ?? "").trim();
  if (v.length < MIN_LEN)
    violations.push(`too short (<${MIN_LEN} chars) — describe when to use it`);
  if (v.length > MAX_LEN) violations.push(`too long (>${MAX_LEN} chars)`);
  if (v.includes("|")) violations.push("contains a raw pipe `|` — breaks the CLAUDE.md table");
  if (v.includes("\n")) violations.push("contains a newline — must fold to one logical line");
  if (!TRIGGER_RE.test(v))
    violations.push(
      'missing a trigger signal — add "Use proactively" + when/after/before conditions',
    );
  return { ok: violations.length === 0, violations };
}

/**
 * Replace/insert the `description` entry from the canonical map. No-op when the
 * agent is not catalogued (so an unknown agent is never clobbered with junk).
 * @param {{ key: string, value: string }[]} entries
 * @param {string} name
 * @returns {{ key: string, value: string }[]}
 */
export function applyCanonicalDescription(entries, name) {
  const canonical = resolveCanonicalDescription(name);
  if (!canonical) return entries;
  const i = entries.findIndex((e) => e.key === "description");
  if (i >= 0) entries[i] = { key: "description", value: canonical };
  else {
    const after = entries.findIndex((e) => e.key === "name");
    entries.splice(after >= 0 ? after + 1 : 0, 0, { key: "description", value: canonical });
  }
  return entries;
}
