/**
 * Markdown section-merge for promoting daily-note content into a
 * template-shaped note (any of the four PARA folders) without free-form
 * append. Splits a note body by H2 headings, matches new content's target
 * headings against the existing note's headings by exact (trimmed)
 * equality, and produces the full, correctly-shaped next version of the
 * note — safe to write back via a controlled REPLACE (never a partial
 * destructive one), because the merge itself already computed the complete
 * correct content.
 *
 * Two dedup strategies are used, deliberately NOT unified into one generic
 * function: prose bullets dedup by normalized-whitespace exact text match;
 * "Related" links dedup by wikilink slug, where the first non-empty
 * relation annotation for a given slug wins and a bare (unannotated) link
 * never overwrites an already-annotated one. These are structurally
 * different identities (text vs. link-target) — collapsing them into one
 * comparison is exactly where the swapo precedent this ports from broke
 * once already (a duplicate "## Related" section consolidation silently
 * discarded the annotation on first append).
 *
 * Pure module — no IO. .claude/scripts/compile-runner.mjs is the only
 * caller, from inside a PreToolUse hook (see that file's `hooks.PreToolUse`).
 *
 * @module hooks/vault-note-merge
 */

/**
 * @typedef {{ heading: string, bodyLines: string[] }} Section
 * @typedef {{ slug: string, relation: string }} RelatedLink
 */

/**
 * Splits a note body into a preamble (everything before the first H2) and an
 * ordered list of {heading, bodyLines} sections. Only "^## " lines count as
 * section boundaries — H1 titles and H3+ subheadings stay inside whichever
 * section's bodyLines they fall under.
 * @param {string} body
 * @returns {{ preamble: string[], sections: Section[] }}
 */
export function splitByH2(body) {
  const lines = body.split("\n");
  /** @type {string[]} */
  const preamble = [];
  /** @type {Section[]} */
  const sections = [];
  /** @type {Section | null} */
  let current = null;
  for (const line of lines) {
    const match = /^## (.+)$/.exec(line);
    if (match) {
      current = { heading: match[1].trim(), bodyLines: [] };
      sections.push(current);
    } else if (current) {
      current.bodyLines.push(line);
    } else {
      preamble.push(line);
    }
  }
  return { preamble, sections };
}

/**
 * Reassembles a full note body from a preamble and an ordered section list —
 * the inverse of splitByH2 after mergeSections has run. Whitespace is
 * normalized (3+ consecutive blank lines collapse to 2, exactly one trailing
 * newline) since the merge already changed section content; exact original
 * byte-for-byte spacing elsewhere is not preserved, and is not the point —
 * the server re-validates required headings and frontmatter, not whitespace.
 * @param {string[]} preamble
 * @param {Section[]} sections
 * @returns {string}
 */
export function joinSections(preamble, sections) {
  const parts = [preamble.join("\n")];
  for (const section of sections) {
    parts.push(`## ${section.heading}\n${section.bodyLines.join("\n")}`);
  }
  return `${parts
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trimEnd()}\n`;
}

/**
 * Normalizes a line for bullet-dedup comparison: collapses internal
 * whitespace runs to a single space and trims. Only "- " bullets are
 * recognized as bullets at all — a "*" bullet is invisible to this
 * comparison by design (see module doc comment).
 * @param {string} line
 * @returns {string | null} the normalized bullet text, or null if `line`
 *   isn't a "- " bullet line
 */
export function normalizeBulletLine(line) {
  const trimmed = line.trim();
  if (!trimmed.startsWith("- ")) return null;
  return trimmed.replace(/\s+/g, " ");
}

/**
 * Appends each of `newBullets` (plain "- text" lines) to `existingLines`,
 * skipping any whose normalized text already appears among the existing
 * "- " bullets. Non-bullet lines in `existingLines` (including "*" bullets)
 * are left exactly as-is and never compared against.
 * @param {string[]} existingLines
 * @param {string[]} newBullets
 * @returns {string[]}
 */
export function dedupeMergeBullets(existingLines, newBullets) {
  const existingNormalized = new Set(
    existingLines.map(normalizeBulletLine).filter((/** @type {string | null} */ b) => b !== null),
  );
  const merged = existingLines.slice();
  for (const bullet of newBullets) {
    const normalized = normalizeBulletLine(bullet);
    if (normalized !== null && existingNormalized.has(normalized)) continue;
    merged.push(bullet);
    if (normalized !== null) existingNormalized.add(normalized);
  }
  return merged;
}

/**
 * Merges `additions` (heading -> new bullet lines to add) into `sections`
 * (from splitByH2), using `templateOrder` (the folder's required headings,
 * in order) to place a heading absent from the note:
 *   - An existing heading is matched by exact trimmed equality; if the same
 *     heading text appears more than once, only the FIRST occurrence
 *     receives the merge — later duplicates are left untouched.
 *   - A heading with additions but absent from `sections` is inserted
 *     immediately before the next `templateOrder` heading that already
 *     exists; if none of the later template headings exist either, it is
 *     inserted before "Related" (if present) or at the very end.
 *   - A section whose heading is not in `additions` is left completely
 *     untouched, in its original position — this covers legacy headings
 *     that aren't part of the template at all.
 *   - Existing headings are never reordered relative to each other.
 * @param {Section[]} sections
 * @param {Record<string, string[]>} additions
 * @param {string[]} templateOrder
 * @returns {Section[]}
 */
export function mergeSections(sections, additions, templateOrder) {
  const result = sections.map((s) => ({ heading: s.heading, bodyLines: s.bodyLines.slice() }));
  for (const heading of Object.keys(additions)) {
    const newBullets = additions[heading];
    if (!newBullets || newBullets.length === 0) continue;
    const firstMatchIndex = result.findIndex((s) => s.heading === heading);
    if (firstMatchIndex !== -1) {
      result[firstMatchIndex].bodyLines = dedupeMergeBullets(
        result[firstMatchIndex].bodyLines,
        newBullets,
      );
      continue;
    }
    const templateIndex = templateOrder.indexOf(heading);
    let insertBeforeIndex = result.length;
    if (templateIndex !== -1) {
      for (let i = templateIndex + 1; i < templateOrder.length; i++) {
        const foundAt = result.findIndex((s) => s.heading === templateOrder[i]);
        if (foundAt !== -1) {
          insertBeforeIndex = foundAt;
          break;
        }
      }
    }
    if (insertBeforeIndex === result.length) {
      const relatedAt = result.findIndex((s) => s.heading === "Related");
      if (relatedAt !== -1) insertBeforeIndex = relatedAt;
    }
    result.splice(insertBeforeIndex, 0, { heading, bodyLines: newBullets.slice() });
  }
  return result;
}

/**
 * Parses the bullet lines of a "Related" section into {slug, relation}
 * pairs. Expected shape: "- [[slug]] — relation text" or a bare
 * "- [[slug]]" with no relation. Lines that don't match a wikilink pattern
 * are left out of the result entirely (never throws on unexpected content).
 * @param {string[]} bodyLines
 * @returns {RelatedLink[]}
 */
export function parseRelatedLinks(bodyLines) {
  /** @type {RelatedLink[]} */
  const links = [];
  for (const line of bodyLines) {
    const match = /^-\s*\[\[([^\]]+)\]\]\s*(?:—|-)?\s*(.*)$/.exec(line.trim());
    if (match) links.push({ slug: match[1].trim(), relation: match[2].trim() });
  }
  return links;
}

/**
 * Merges `newLinks` into `existingLinks`, deduped by slug. The first
 * non-empty relation annotation for a given slug wins; a bare (empty
 * relation) link never overwrites an already-annotated one.
 * @param {RelatedLink[]} existingLinks
 * @param {RelatedLink[]} newLinks
 * @returns {RelatedLink[]}
 */
export function mergeRelatedLinks(existingLinks, newLinks) {
  /** @type {Map<string, RelatedLink>} */
  const bySlug = new Map();
  for (const link of [...existingLinks, ...newLinks]) {
    const prior = bySlug.get(link.slug);
    if (!prior) {
      bySlug.set(link.slug, link);
    } else if (!prior.relation && link.relation) {
      bySlug.set(link.slug, link);
    }
  }
  return [...bySlug.values()];
}

/**
 * Renders {slug, relation} pairs back into "Related" section bullet lines.
 * @param {RelatedLink[]} links
 * @returns {string[]}
 */
export function renderRelatedLinks(links) {
  return links.map((l) => (l.relation ? `- [[${l.slug}]] — ${l.relation}` : `- [[${l.slug}]]`));
}

/**
 * Drops any proposed related link whose slug isn't in `validSlugs` — the
 * model may only link notes confirmed to exist (injected into its prompt
 * from its own search results), never a note it merely assumes exists.
 * @param {RelatedLink[]} links
 * @param {string[]} validSlugs
 * @returns {RelatedLink[]}
 */
export function filterValidRelatedLinks(links, validSlugs) {
  const valid = new Set(validSlugs);
  return links.filter((l) => valid.has(l.slug));
}

/**
 * Computes the full, correctly-merged next version of a note's body, given
 * its current on-disk content and a model's proposed replacement content —
 * both shaped by the same folder template. Every bullet under a heading in
 * `proposedBody` not already present (dedupeMergeBullets' normalized-exact
 * comparison) under the matching heading in `currentBody` is merged in as
 * new content; "Related" is merged via the slug-aware link rules instead of
 * plain bullet dedup. A template heading present in `proposedBody` but
 * absent from `currentBody` is inserted per mergeSections' insertion rule.
 * @param {string} currentBody
 * @param {string} proposedBody
 * @param {string[]} templateOrder
 * @param {string[]} validRelatedSlugs
 * @returns {string}
 */
export function mergeIntoTemplate(currentBody, proposedBody, templateOrder, validRelatedSlugs) {
  const current = splitByH2(currentBody);
  const proposed = splitByH2(proposedBody);
  /** @type {Record<string, string[]>} */
  const additions = {};
  for (const proposedSection of proposed.sections) {
    if (proposedSection.heading === "Related") continue;
    const currentSection = current.sections.find((s) => s.heading === proposedSection.heading);
    const currentNormalized = new Set(
      (currentSection ? currentSection.bodyLines : [])
        .map(normalizeBulletLine)
        .filter((/** @type {string | null} */ b) => b !== null),
    );
    const newBullets = proposedSection.bodyLines
      .map((line) => ({ line, normalized: normalizeBulletLine(line) }))
      .filter(({ normalized }) => normalized !== null && !currentNormalized.has(normalized))
      .map(({ line }) => line);
    if (newBullets.length > 0) additions[proposedSection.heading] = newBullets;
  }
  let mergedSections = mergeSections(current.sections, additions, templateOrder);

  const proposedRelated = proposed.sections.find((s) => s.heading === "Related");
  if (proposedRelated) {
    const currentRelatedIndex = mergedSections.findIndex((s) => s.heading === "Related");
    const currentLinks =
      currentRelatedIndex !== -1
        ? parseRelatedLinks(mergedSections[currentRelatedIndex].bodyLines)
        : [];
    const proposedLinks = filterValidRelatedLinks(
      parseRelatedLinks(proposedRelated.bodyLines),
      validRelatedSlugs,
    );
    const mergedLinks = mergeRelatedLinks(currentLinks, proposedLinks);
    const renderedLines = renderRelatedLinks(mergedLinks);
    if (currentRelatedIndex !== -1) {
      mergedSections[currentRelatedIndex] = { heading: "Related", bodyLines: renderedLines };
    } else if (renderedLines.length > 0) {
      mergedSections = mergeSections(mergedSections, { Related: renderedLines }, templateOrder);
    }
  }

  return joinSections(current.preamble, mergedSections);
}

/**
 * Rewrites every [[wikilink]] whose target does not resolve into plain text,
 * leaving resolving links, embeds, and code untouched. Deterministic
 * sanitisation applied after a compile writes: the model can invent a
 * placeholder link despite the prompt forbidding it, and a broken wikilink is
 * a hard error under the server's strict wikilink policy.
 *
 * Code is skipped by splitting on a CAPTURING regex, so segments alternate
 * text/code and any segment starting with a backtick is a code span — a fenced
 * example containing [[foo]] is documentation, not a link.
 *
 * The (?<!!) lookbehind excludes ![[embed]] syntax, which addresses an
 * attachment rather than a note.
 *
 * @param {string} text
 * @param {Set<string>} validTargets every resolvable target: each note's
 *   basename and its vault-relative path, both without ".md"
 * @returns {{ text: string, count: number }} count is links rewritten
 */
export function unlinkBrokenWikilinks(text, validTargets) {
  let count = 0;
  const segments = text.split(/(```[\s\S]*?```|`[^`\n]+`)/);
  const rewritten = segments.map((segment) => {
    if (segment.startsWith("`")) return segment;
    return segment.replace(/(?<!!)\[\[([^\]]+)\]\]/g, (whole, inner) => {
      const target = inner.split("|")[0].split("#")[0].trim();
      if (!target || validTargets.has(target)) return whole;
      count += 1;
      const pipeIndex = inner.indexOf("|");
      // A #heading suffix is always discarded, never kept as plain text.
      return pipeIndex === -1 ? target : inner.slice(pipeIndex + 1).trim();
    });
  });
  return { text: rewritten.join(""), count };
}

/**
 * Collapses two or more "## Related" sections into a single one at the end of
 * the note, merging their links. Successive appends can each add their own
 * Related section; one note must end with exactly one.
 *
 * Link identity, dedup and the "first non-empty relation wins" rule are
 * delegated to this module's existing parseRelatedLinks / mergeRelatedLinks /
 * renderRelatedLinks rather than reimplemented — collapsing link identity into
 * a second, parallel implementation is exactly where the swapo precedent this
 * ports from lost annotations once already.
 *
 * A section runs from its heading to the next heading of ANY level (1-6,
 * whatever its text) or to EOF. Levels 4-6 terminate a span just like 1-3: an
 * `#### Subsection` following a Related heading is a sibling of the note's
 * content, not part of its link list, and a span that ran past it would excise
 * that subsection along with its whole body. Fewer than two Related headings is
 * a no-op, so a note that is already correct is returned byte-for-byte
 * unchanged.
 *
 * Everything inside a span that is not a wikilink bullet — prose, sub-bullets,
 * whatever the note's author put there — is carried into the consolidated
 * section rather than dropped. This runs over user-authored knowledge notes
 * that merely happen to have been appended to by a compile, so "not a link
 * line" must never mean "safe to delete"; only blank-line noise is discarded.
 * Recognising a link line is delegated to parseRelatedLinks so the two can
 * never disagree about what counts as one.
 *
 * @param {string} text
 * @returns {{ text: string, removed: number }} removed is sections eliminated
 */
export function consolidateRelatedSections(text) {
  const matches = [...text.matchAll(/^#{1,3}\s+Related\s*$/gim)];
  if (matches.length <= 1) return { text, removed: 0 };

  /** @type {RelatedLink[]} */
  let links = [];
  /** @type {string[]} */
  const carried = [];
  /** @type {string[]} */
  const kept = [];
  let cursor = 0;
  for (const match of matches) {
    const start = match.index ?? 0;
    kept.push(text.slice(cursor, start));
    const bodyStart = start + match[0].length;
    const nextHeading = /^#{1,6}\s/m.exec(text.slice(bodyStart));
    const bodyEnd = nextHeading ? bodyStart + (nextHeading.index ?? 0) : text.length;
    const spanLines = text.slice(bodyStart, bodyEnd).split("\n");
    links = mergeRelatedLinks(links, parseRelatedLinks(spanLines));
    for (const line of spanLines) {
      if (line.trim() === "") continue;
      if (parseRelatedLinks([line]).length > 0) continue;
      carried.push(line);
    }
    cursor = bodyEnd;
  }
  kept.push(text.slice(cursor));

  const body = kept
    .join("")
    .replace(/\n{3,}/g, "\n\n")
    .trimEnd();
  // A bare ISO date is metadata, not a relation — linking one pollutes the
  // graph and breaks the moment the compile deletes that daily note.
  const rendered = renderRelatedLinks(links.filter((l) => !/^\d{4}-\d{2}-\d{2}$/.test(l.slug)));
  const sectionBody = [...carried, ...rendered];
  const relatedBlock =
    sectionBody.length > 0 ? `## Related\n\n${sectionBody.join("\n")}\n` : "## Related\n";
  return { text: `${body}\n\n${relatedBlock}`, removed: matches.length - 1 };
}

/**
 * Number of lines, matching Python's `sum(1 for _ in fh)` over a text-mode
 * file: every newline terminates a line, and a final line without a trailing
 * newline still counts. `text.split("\n").length` is NOT equivalent — it
 * over-counts by one whenever the text ends in a newline, which is the normal
 * case for a note.
 * @param {string} text
 * @returns {number}
 */
export function countNoteLines(text) {
  if (!text) return 0;
  const newlines = text.split("\n").length - 1;
  return text.endsWith("\n") ? newlines : newlines + 1;
}

/**
 * Tokens too generic to make two slugs "the same topic". Ported from swapo's
 * _dedup.py SLUG_STOPWORDS, minus its Portuguese entries — this repo's source
 * is English-only, and a Portuguese stopword could never match a slug the
 * English-language prompt produces anyway.
 */
const SLUG_STOPWORDS = new Set([
  "guard",
  "guardrail",
  "check",
  "gate",
  "fix",
  "bug",
  "review",
  "code",
  "update",
  "final",
  "impl",
  "add",
  "set",
  "get",
  "use",
  "run",
  "api",
  "new",
  "old",
  "and",
  "the",
  "for",
  "with",
  "from",
  "into",
]);

/** Jaccard score at or above which two slugs are treated as the same topic. */
export const SLUG_SIM_THRESHOLD = 0.6;

/**
 * The significant tokens of a kebab-case slug: lowercased, split on hyphens,
 * with tokens under 3 characters and generic stopwords removed.
 * @param {string} slug
 * @returns {Set<string>}
 */
export function slugTokens(slug) {
  return new Set(
    String(slug)
      .toLowerCase()
      .split("-")
      .filter((token) => token.length >= 3 && !SLUG_STOPWORDS.has(token)),
  );
}

/**
 * Jaccard similarity of two slugs' significant tokens, in [0, 1]. A slug with
 * no significant tokens scores 0 against everything rather than dividing by
 * zero — "fix-the-bug" is not evidence of any topic.
 * @param {string} a
 * @param {string} b
 * @returns {number}
 */
export function slugSimilarity(a, b) {
  const tokensA = slugTokens(a);
  const tokensB = slugTokens(b);
  if (tokensA.size === 0 || tokensB.size === 0) return 0;
  let intersection = 0;
  for (const token of tokensA) if (tokensB.has(token)) intersection += 1;
  return intersection / (tokensA.size + tokensB.size - intersection);
}

/**
 * The existing slug that `candidateSlug` most likely duplicates, or null. An
 * exact match short-circuits; otherwise the highest-scoring slug at or above
 * `threshold` wins.
 * @param {string} candidateSlug
 * @param {Iterable<string>} existingSlugs
 * @param {number} [threshold]
 * @returns {string | null}
 */
export function findDuplicateSlug(candidateSlug, existingSlugs, threshold = SLUG_SIM_THRESHOLD) {
  /** @type {string | null} */
  let best = null;
  let bestScore = 0;
  for (const existing of existingSlugs) {
    if (existing === candidateSlug) return existing;
    const score = slugSimilarity(candidateSlug, existing);
    if (score >= threshold && score > bestScore) {
      bestScore = score;
      best = existing;
    }
  }
  return best;
}
