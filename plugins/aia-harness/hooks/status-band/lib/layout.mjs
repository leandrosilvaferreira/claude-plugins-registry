/** @typedef {'issue-work-loop' | 'issue-work' | 'commit-pr' | 'merge-pr' | 'remove-worktree'} ButtonId */
/** @typedef {{ kind: 'worktree' | 'branch' | 'pr', text: string }} Item */
/** @typedef {{ id: ButtonId, label: string }} DrawnButton `label` is the drawn (possibly truncated) text. */
/** @typedef {{ buttonRows: DrawnButton[][], infoRows: Item[][] }} BandModel The close button leads the first row: the first button row, or the first info row when there are no buttons. */

/** Button label per id; the rendered form is `[label]`. */
export const BUTTON_LABELS = {
  "issue-work-loop": "Issue work loop",
  "issue-work": "Issue work",
  "commit-pr": "Commit+PR",
  "merge-pr": "Merge PR",
  "remove-worktree": "Remove worktree",
};

// Icon cell widths (the tree emoji takes two cells) + one space after the icon.
/** @type {Record<string, number>} */
const ICON_WIDTH = { worktree: 3, branch: 2 };
const GAP = 2;
const CLOSE_WIDTH = 2; // the "✕" that leads the first row, plus one space
// On an info row the ✕ is followed by the row gap (2), not one space.
const CLOSE_INFO_WIDTH = 1 + GAP;
const MAX_ROWS = 4;

/**
 * @param {string[]} entries File names in `.claude/commands/pm/`.
 * @returns {boolean} True when the project has any PM command file.
 */
export function hasPmCommands(entries) {
  return entries.length > 0;
}

/**
 * @param {string[]} files File names in `.claude/commands/pm/`.
 * @param {{ hasPr: boolean, inWorktree: boolean }} ctx
 * @returns {ButtonId[]} Buttons in the spec's fixed order.
 */
export function availableButtons(files, ctx) {
  const has = (/** @type {string} */ f) => files.includes(f);
  /** @type {ButtonId[]} */
  const out = [];
  if (has("issue-work-in-loop.md")) out.push("issue-work-loop");
  else if (has("issue-work.md")) out.push("issue-work");
  if (has("commit-push-pr.md")) out.push("commit-pr");
  if (ctx.hasPr && has("pr-merge.md")) out.push("merge-pr");
  if (ctx.inWorktree && has("worktree-remove.md")) out.push("remove-worktree");
  return out;
}

/**
 * Drawn text of a button; an armed one asks for the second click.
 * @param {ButtonId} id
 * @param {boolean} armed
 * @param {number | undefined} prNumber
 * @returns {string}
 */
export function buttonLabel(id, armed, prNumber) {
  const ask = !armed ? "" : id === "merge-pr" && prNumber !== undefined ? ` #${prNumber}?` : "?";
  return `[${BUTTON_LABELS[id]}${ask}]`;
}

/**
 * Middle truncation: keeps the start and the end around a `…`, so a branch
 * name stays recognisable (`feat/31-…cash-out`). Width is counted in code points.
 * Below 4 cells there is no room for two ends: the first `max - 1` chars and `…`.
 * @param {string} text
 * @param {number} max Maximum width in cells.
 * @returns {string}
 */
export function truncate(text, max) {
  const chars = [...text];
  if (chars.length <= max) return text;
  if (max <= 0) return "";
  if (max < 4) return chars.slice(0, max - 1).join("") + "…";
  const keep = max - 1;
  const head = Math.ceil(keep / 2);
  return chars.slice(0, head).join("") + "…" + chars.slice(chars.length - (keep - head)).join("");
}

/**
 * @param {Item} item
 * @returns {number} Display width of the item.
 */
function itemWidth(item) {
  return (ICON_WIDTH[item.kind] ?? 0) + [...item.text].length;
}

/**
 * Greedy row packing: an item that does not fit starts a new row.
 * @param {number[]} widths
 * @param {number} gap
 * @param {number} columns
 * @param {number} lead Cells already taken at the start of the first row.
 * @returns {number[][]} Item indexes per row.
 */
function pack(widths, gap, columns, lead) {
  /** @type {number[][]} */
  const rows = [];
  let used = 0;
  widths.forEach((w, i) => {
    const row = rows[rows.length - 1];
    if (row && used + gap + w <= columns) {
      row.push(i);
      used += gap + w;
    } else {
      rows.push([i]);
      used = (rows.length === 1 ? lead : 0) + w;
    }
  });
  return rows;
}

/**
 * @param {BandModel} model
 * @returns {{ buttonRows: number[], infoRows: number[] }} Width of each row; the close button counts on the first row.
 */
export function bandWidths(model) {
  const sum = (/** @type {number[]} */ ws, /** @type {number} */ gap) =>
    ws.reduce((n, w) => n + w, 0) + gap * Math.max(0, ws.length - 1);
  const closeOnButtons = model.buttonRows.length > 0;
  return {
    buttonRows: model.buttonRows.map(
      (r, i) =>
        sum(
          r.map((b) => [...b.label].length),
          1,
        ) + (closeOnButtons && i === 0 ? CLOSE_WIDTH : 0),
    ),
    infoRows: model.infoRows.map(
      (r, i) => sum(r.map(itemWidth), GAP) + (!closeOnButtons && i === 0 ? CLOSE_INFO_WIDTH : 0),
    ),
  };
}

/**
 * Builds the band model. Nothing is dropped: items are packed into rows of at
 * most `columns` cells and long texts are truncated with `…`. When more than
 * MAX_ROWS rows are needed, the longest text (never the PR) shrinks first.
 * @param {{ worktree?: string, branch?: string, pr?: { number: number, url: string }, buttons: ButtonId[], columns: number, armed?: ButtonId }} input
 * @returns {BandModel}
 */
export function buildModel({ worktree, branch, pr, buttons, columns, armed }) {
  /** @type {Item[]} */
  const info = [];
  if (worktree) info.push({ kind: "worktree", text: worktree });
  if (branch) info.push({ kind: "branch", text: branch });
  if (pr) info.push({ kind: "pr", text: `#${pr.number} ↗` });
  const labels = buttons.map((b) => buttonLabel(b, b === armed, pr?.number));

  // The close button leads the first row, so that row's first item gets less room.
  const closeOnButtons = buttons.length > 0;
  const infoCaps = info.map((i, n) =>
    Math.max(
      1,
      columns - (ICON_WIDTH[i.kind] ?? 0) - (!closeOnButtons && n === 0 ? CLOSE_INFO_WIDTH : 0),
    ),
  );
  const buttonCaps = labels.map((_, n) => Math.max(1, columns - (n === 0 ? CLOSE_WIDTH : 0)));

  const build = () => {
    const shownInfo = info.map((i, n) => ({ ...i, text: truncate(i.text, infoCaps[n]) }));
    const shownButtons = buttons.map((id, n) => ({
      id,
      label: truncate(labels[n], buttonCaps[n]),
    }));
    const buttonRows = pack(
      shownButtons.map((b) => [...b.label].length),
      1,
      columns,
      CLOSE_WIDTH,
    ).map((r) => r.map((n) => shownButtons[n]));
    const infoRows = pack(
      shownInfo.map(itemWidth),
      GAP,
      columns,
      closeOnButtons ? 0 : CLOSE_INFO_WIDTH,
    ).map((r) => r.map((n) => shownInfo[n]));
    // Nothing to show: an empty row still hosts the lone close button.
    if (!buttonRows.length && !infoRows.length) infoRows.push([]);
    return { buttonRows, infoRows, shownInfo, shownButtons };
  };

  let built = build();
  while (built.buttonRows.length + built.infoRows.length > MAX_ROWS) {
    // Shrink the widest shrinkable text by one cell.
    /** @type {{ w: number, caps: number[], n: number } | undefined} */
    let best;
    for (const [n, i] of built.shownInfo.entries()) {
      const w = [...i.text].length;
      if (i.kind !== "pr" && w > 1 && (!best || w > best.w)) best = { w, caps: infoCaps, n };
    }
    for (const [n, b] of built.shownButtons.entries()) {
      const w = [...b.label].length;
      if (w > 1 && (!best || w > best.w)) best = { w, caps: buttonCaps, n };
    }
    if (!best) break;
    best.caps[best.n] = best.w - 1;
    built = build();
  }
  return { buttonRows: built.buttonRows, infoRows: built.infoRows };
}
