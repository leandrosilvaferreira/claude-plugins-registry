// Status band above the prompt: worktree, branch, open PR and PM shortcut buttons.
// Engine rules: one `register`, one matcher-less hook per event, `$` never crosses an import
// (functions that take `$` live here; ./lib/*.mjs stay pure), every hook ends in `.catch(next)`.
// No recurring timer, no background process: state refreshes on events only. The one exception
// is a one-shot, cancellable `$.clock.after` that reverts the two-click confirm label.
import { atom, read, update } from "claude-code";

import { isBandEnabled } from "./lib/marker.mjs";
import { isHomeDir } from "./lib/home-guard.mjs";
import { resolveWorktree } from "./lib/worktree.mjs";
import { createGitSource } from "./lib/git-source.mjs";
import { availableButtons, buildModel } from "./lib/layout.mjs";

/**
 * @typedef {import("./types/index.js").StatusBandState} State
 * @typedef {import("./lib/layout.mjs").ButtonId} ButtonId
 */

const CONFIRM_MS = 5000;

/** @type {Record<ButtonId, string>} */
const COMMANDS = {
  "issue-work-loop": "pm:issue-work-in-loop",
  "issue-work": "pm:issue-work",
  "commit-pr": "pm:commit-push-pr",
  "merge-pr": "pm:pr-merge",
  "remove-worktree": "pm:worktree-remove",
};
/** Buttons that need a second click within CONFIRM_MS. */
const CONFIRMED = new Set(["merge-pr", "remove-worktree"]);

/** @type {State} */
const EMPTY = {
  enabled: false,
  pmFiles: [],
  worktree: "",
  branch: "",
  pr: null,
  confirm: null,
  rev: 0,
};
const band = atom({ plugin: "aia-harness", key: "statusBand" }, EMPTY);

/**
 * What a confirm click acts on: the PR number (merge-pr) or the worktree name (remove-worktree).
 * @param {{ pr: { number: number } | null, worktree: string }} s
 * @param {string} id
 * @returns {string}
 */
const targetOf = (s, id) =>
  id === "merge-pr"
    ? s.pr
      ? String(s.pr.number)
      : ""
    : id === "remove-worktree"
      ? s.worktree
      : "";

/**
 * Keeps an armed confirm only while its target is still the current one.
 * @param {State["confirm"]} c @param {{ pr: { number: number } | null, worktree: string }} s
 * @returns {State["confirm"]}
 */
const stillArmed = (c, s) => (c && c.target === targetOf(s, c.id) ? c : null);

/** @param {any} $ @returns {Promise<State>} */
const load = async ($) => ({ ...EMPTY, ...(await read($, band)) });

/**
 * Link refuses the whole tree on a bad href, so only a canonical https URL becomes a Link.
 * @param {string} url
 */
function safeHref(url) {
  try {
    return /^https:\/\/[\x21-\x7e]+$/.test(url) && !url.includes("@") && new URL(url).href === url;
  } catch {
    return false;
  }
}

/**
 * Worktree of a directory. `resolveWorktree` is synchronous, so the `.git` candidates it
 * asks about are collected first, checked through `$.fs`, then asked again with the answers.
 * @param {any} $ @param {string} cwd
 */
async function worktreeOf($, cwd) {
  /** @type {string[]} */
  const asked = [];
  resolveWorktree(cwd, (p) => (asked.push(p), false));
  const found = new Set();
  for (const p of asked) if (await $.fs.exists(p).catch(() => false)) found.add(p);
  return resolveWorktree(cwd, (p) => found.has(p));
}

/** @param {import("./lib/git-source.mjs").PullRequest | undefined} pr */
const prValue = (pr) => (pr ? { number: pr.number, url: pr.url } : null);

// shortcut: module-level state assumes ONE module instance per Claude Code process; if that
// stops holding, key it by `$.session.id()`.
/** @type {Map<string, { mtime: number, enabled: boolean, pmFiles: string[] }>} */
const markers = new Map();
/** True only after an interactive `session.start`: headless sessions never refresh. */
let active = false;
/** True while any button press runs: taken synchronously at the top of `press`. */
let busy = false;
/** The `/aia-bar` command is registered once, after the first refresh that finds the mark. */
let commandRegistered = false;
/** Project root of the last refresh. */
let lastRoot = "";
/** The pending revert of the confirm label. */
/** @type {{ cancel: () => void } | undefined} */
let confirmTimer;
/** Directory git and gh run in: the session cwd, or the worktree a tool entered or left. */
let cwd = "";
/** Clock reading of the last refresh: the git source needs a synchronous `now`. */
let lastNow = 0;
/** @type {{ run: (argv: string[], opts: { timeoutMs: number }) => Promise<any>, now: () => Promise<number> } | undefined} */
let io;
// Every git/gh call gets the project cwd and its timeout (the git source passes `timeoutMs`).
const gitSource = createGitSource({
  run: (argv, opts) => /** @type {NonNullable<typeof io>} */ (io).run(argv, opts),
  now: () => lastNow,
});

function cancelConfirmTimer() {
  confirmTimer?.cancel();
  confirmTimer = undefined;
}

/**
 * Arms the confirm and the one-shot timer that clears it after CONFIRM_MS.
 * @param {any} $ @param {number} until
 */
function armConfirmTimer($, until) {
  cancelConfirmTimer();
  confirmTimer = $.clock.after(CONFIRM_MS, () => {
    confirmTimer = undefined;
    update($, band, (/** @type {State} */ x) => ({
      ...EMPTY,
      ...x,
      confirm: x.confirm && x.confirm.until === until ? null : x.confirm,
    })).catch(() => {});
  });
}

/** @param {any} $ */
async function dropConfirm($) {
  cancelConfirmTimer();
  await update($, band, (/** @type {State} */ x) => ({ ...EMPTY, ...x, confirm: null })).catch(
    () => {},
  );
}

/**
 * Marker result per project root, valid while settings.json keeps its mtime.
 * @param {any} $ @param {string} root
 */
async function marker($, root) {
  const file = `${root}/.claude/settings.json`;
  const mtime = await $.fs.stat(file).then(
    (/** @type {any} */ st) => st.mtimeMs,
    () => -1,
  );
  const hit = markers.get(root);
  if (hit && hit.mtime === mtime) return hit;
  const enabled = mtime >= 0 && isBandEnabled(await $.fs.read(file).catch(() => undefined));
  const entries = enabled ? await $.fs.list(`${root}/.claude/commands/pm`).catch(() => []) : [];
  const value = {
    mtime,
    enabled,
    pmFiles: entries
      .filter((/** @type {any} */ f) => f.kind === "file")
      .map((/** @type {any} */ f) => f.name),
  };
  markers.set(root, value);
  return value;
}

/**
 * Refreshes branch and PR into the atom. Without the mark nothing but the mark check runs.
 * @param {any} $ @param {string} [dir]
 */
async function refresh($, dir) {
  if (!active) return;
  io = { run: (argv, opts) => $.process.run(argv, { ...opts, cwd }), now: () => $.clock.now() };
  lastNow = await $.clock.now();
  cwd = dir || cwd || (await $.session.cwd());
  const hidden = (await $.store.get("hidden")) === true;
  const wt = await worktreeOf($, cwd);
  const root = wt ? wt.root : cwd;
  lastRoot = root;
  // The home directory is never a project: its .claude/settings.json is the user's own.
  const home = {
    home: await $.env.get("HOME").catch(() => undefined),
    userProfile: await $.env.get("USERPROFILE").catch(() => undefined),
    homeDrive: await $.env.get("HOMEDRIVE").catch(() => undefined),
    homePath: await $.env.get("HOMEPATH").catch(() => undefined),
  };
  const m = isHomeDir(root, home) ? { enabled: false, pmFiles: [] } : await marker($, root);
  if (!m.enabled) {
    cancelConfirmTimer();
    if (JSON.stringify(await load($)) !== JSON.stringify(EMPTY)) {
      await update($, band, () => ({ ...EMPTY }));
    }
    return;
  }
  if (!commandRegistered) {
    commandRegistered = true;
    try {
      await $.command.register({
        name: "aia-bar",
        description: "Show or hide the aia-harness status band",
        argumentHint: "[on|off]",
      });
    } catch {
      // Registering the command is a convenience.
    }
  }
  // A hidden band does no git/gh work; /aia-bar on refreshes when it comes back.
  if (hidden) return;
  const branch = (await gitSource.branch(root)) ?? "";
  const pr = branch ? await gitSource.pr(root, branch) : undefined;
  const next = { worktree: wt ? wt.name : "", pr: prValue(pr) };
  if (!stillArmed((await load($)).confirm, next)) cancelConfirmTimer();
  await update($, band, (/** @type {State} */ s) => ({
    ...EMPTY,
    ...s,
    enabled: true,
    pmFiles: m.pmFiles,
    branch,
    ...next,
    confirm: stillArmed(s.confirm, next),
  }));
}

/** @param {any} $ @param {string} [dir] */
async function refreshSafe($, dir) {
  try {
    await refresh($, dir);
  } catch {
    // The band is a convenience: a failed refresh leaves the last state.
  }
}

/** @type {import("claude-code").Register} */
export const register = (on) => {
  on("session.start", { isInteractive: true }, async ($, e, next) => {
    active = true;
    await refreshSafe($, e.cwd);
    return next(e);
  }).catch(($, e, next) => next(e));

  on("turn.complete", async ($, e, next) => {
    // A subagent's turn is not the session's: no refresh.
    if (e.agentId) return next(e);
    const r = await next(e);
    try {
      await refreshSafe($);
    } catch {
      // The band never breaks a turn.
    }
    return r;
  }).catch(($, e, next) => next(e));

  // The tool result holds the new directory; `$.session.cwd()` still answers the old one here.
  on("tool.call", { tool: ["EnterWorktree", "ExitWorktree"] }, async ($, e, next) => {
    if (e.agentId) return next(e);
    const r = await next(e);
    try {
      if (r.deny === undefined && !r.isError) {
        const result = /** @type {any} */ (r.result);
        // restoredCwd is originalCwd, or the fallback directory when originalCwd is gone.
        const dir =
          e.tool === "EnterWorktree"
            ? result?.worktreePath
            : (result?.restoredCwd ?? result?.originalCwd);
        await dropConfirm($);
        await refreshSafe($, dir);
      }
    } catch {
      // The band never breaks a tool call.
    }
    return r;
  }).catch(($, e, next) => next(e));

  // /clear and /resume start over; `hidden` lives in the store and stays.
  on("session.end", { reason: ["clear", "resume"] }, async ($, e, next) => {
    gitSource.reset();
    cancelConfirmTimer();
    await update($, band, (s) => ({ ...EMPTY, ...s, confirm: null })).catch(() => {});
    return next(e);
  }).catch(($, e, next) => next(e));

  on("command.run", { command: "aia-bar" }, async ($, e) => {
    const arg = String(e.args ?? "")
      .trim()
      .toLowerCase();
    const hidden =
      arg === "off" ? true : arg === "on" ? false : (await $.store.get("hidden")) !== true;
    await $.store.set("hidden", hidden);
    // `rev` changes the atom so the band redraws even when nothing else changed.
    await update($, band, (s) => ({ ...EMPTY, ...s, rev: s.rev + 1 }));
    if (!hidden) await refreshSafe($);
    return {
      text: hidden ? "Status band hidden. /aia-bar on shows it again." : "Status band shown.",
    };
  }).catch(($, e, next) => next(e));

  on("ui.render", { component: "AbovePrompt" }, async ($, e, next) => {
    if (e.props.hasSurvey) return next(e);
    let s;
    try {
      // Read the atom first: a render that never reads it is not redrawn when it changes.
      s = await load($);
      if ((await $.store.get("hidden")) === true) return next(e);
    } catch {
      return next(e);
    }
    if (!s.enabled) return next(e);
    // Draw ours above whatever other mods put in this slot; the harness rejects when nothing answers below.
    // next runs exactly once: a failed drawing below must not ask it again.
    const below = await next(e).catch(() => undefined);
    try {
      const now = await $.clock.now();
      const { Box, Text, Button, Link } = $.ui.resolve(e);
      const armed =
        s.confirm && now < s.confirm.until && s.confirm.target === targetOf(s, s.confirm.id)
          ? /** @type {ButtonId} */ (s.confirm.id)
          : undefined;
      const model = buildModel({
        worktree: s.worktree || undefined,
        branch: s.branch || undefined,
        pr: s.pr || undefined,
        buttons: availableButtons(s.pmFiles, { hasPr: !!s.pr, inWorktree: !!s.worktree }),
        columns: e.props.bodyColumns,
        armed,
      });

      /** @param {ButtonId} id */
      const press = async (id) => {
        // Taken before any await: a second click in the same tick sees it.
        if (busy) return;
        busy = true;
        try {
          const t = await $.clock.now();
          const until = t + CONFIRM_MS;
          let fire = false;
          let armedNow = false;
          // The updater may run again on a version miss: it recomputes `fire` from `x` each time.
          await update($, band, (/** @type {State} */ x) => {
            const target = targetOf(x, id);
            const c = x.confirm;
            const confirmed = !!c && c.id === id && c.target === target && t < c.until;
            fire = !CONFIRMED.has(id) || confirmed;
            armedNow = !fire && target !== "";
            return {
              ...EMPTY,
              ...x,
              confirm: fire ? null : armedNow ? { id, target, until } : x.confirm,
            };
          });
          if (!fire) {
            if (armedNow) armConfirmTimer($, until);
            return;
          }
          cancelConfirmTimer();
          try {
            await $.command.run({ command: COMMANDS[id] });
          } catch {
            $.ui.toast("aia-harness status band: could not run the command");
          }
          // After the command: a failure here must not look like a failed command.
          try {
            // A command can open the PR: the cached "no PR" must not hide it for 5 minutes.
            gitSource.invalidate(lastRoot, (await load($)).branch);
            await refreshSafe($);
          } catch {
            // The band keeps its last state.
          }
        } catch {
          // Arm step failed (state update): nothing ran.
          $.ui.toast("aia-harness status band: could not run the command");
        } finally {
          busy = false;
        }
      };
      const close = async () => {
        await $.store.set("hidden", true);
        await update($, band, (x) => ({ ...EMPTY, ...x, rev: x.rev + 1 }));
      };

      const rows = [];
      if (model.buttons.length) {
        rows.push(
          Box({
            flexDirection: "row",
            gap: 1,
            children: model.buttons.map((id, idx) =>
              Button({
                key: `btn-${id}`,
                plain: true,
                label: model.labels[idx],
                onPress: () => press(id),
              }),
            ),
          }),
        );
      }
      const items = model.info.map((i) => {
        if (i.kind === "pr") {
          return s.pr && safeHref(s.pr.url)
            ? Link({ href: s.pr.url, children: [Text({ children: i.text })] })
            : Text({ children: i.text });
        }
        return Text({
          dimColor: true,
          children: `${i.kind === "worktree" ? "\u{1F333}" : "⎇"} ${i.text}`,
        });
      });
      rows.push(
        Box({
          flexDirection: "row",
          gap: 2,
          width: e.props.bodyColumns,
          children: [
            ...items,
            Box({ flexGrow: 1 }),
            Button({ key: "close", plain: true, label: "✕", onPress: close }),
          ],
        }),
      );
      const mine = Box({ flexDirection: "column", children: rows });
      return below ? Box({ flexDirection: "column", children: [mine, below] }) : mine;
    } catch {
      return below;
    }
  }).catch(($, e, next) => next(e));
};
