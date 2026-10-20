/** @typedef {'issue-work-loop' | 'issue-work' | 'commit-pr' | 'merge-pr' | 'remove-worktree'} ButtonId */
/** @typedef {{ kind: 'worktree' | 'branch' | 'pr', text: string }} Item */
/** @typedef {{ buttons: ButtonId[], labels: string[], info: Item[] }} BandModel `labels[i]` is the drawn text of `buttons[i]`. */

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
const CLOSE_WIDTH = 2; // the "✕" at the end of the info line, plus one space

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
 * @param {Item} item
 * @returns {number} Display width of the item.
 */
function itemWidth(item) {
  return (ICON_WIDTH[item.kind] ?? 0) + [...item.text].length;
}

/**
 * @param {Item[]} info
 * @returns {number} Width of the info line, close button included.
 */
function infoWidth(info) {
  const sum = info.reduce((n, i) => n + itemWidth(i), 0);
  return sum + GAP * Math.max(0, info.length - 1) + CLOSE_WIDTH;
}

/**
 * @param {string[]} labels Drawn button texts.
 * @returns {number} Width of the button line.
 */
function buttonsWidth(labels) {
  const sum = labels.reduce((n, l) => n + l.length, 0);
  return sum + Math.max(0, labels.length - 1);
}

/**
 * @param {BandModel} model
 * @returns {{ buttons: number, info: number }} Width of each line.
 */
export function bandWidths(model) {
  return { buttons: buttonsWidth(model.labels), info: infoWidth(model.info) };
}

/**
 * Builds the band model, dropping items that do not fit in `columns`:
 * buttons first, then branch, then worktree. The PR goes last.
 * @param {{ worktree?: string, branch?: string, pr?: { number: number, url: string }, buttons: ButtonId[], columns: number, armed?: ButtonId }} input
 * @returns {BandModel}
 */
export function buildModel({ worktree, branch, pr, buttons, columns, armed }) {
  /** @type {Item[]} */
  let info = [];
  if (worktree) info.push({ kind: "worktree", text: worktree });
  if (branch) info.push({ kind: "branch", text: branch });
  if (pr) info.push({ kind: "pr", text: `#${pr.number} ↗` });

  let kept = [...buttons];
  /** @param {ButtonId[]} ids */
  const labelsOf = (ids) => ids.map((b) => buttonLabel(b, b === armed, pr?.number));
  if (infoWidth(info) > columns) kept = [];
  while (kept.length && buttonsWidth(labelsOf(kept)) > columns) kept.pop();
  for (const kind of ["branch", "worktree"]) {
    if (infoWidth(info) <= columns) break;
    info = info.filter((i) => i.kind !== kind);
  }
  return { buttons: kept, labels: labelsOf(kept), info };
}
