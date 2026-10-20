// State the status band reads when it draws. Declared for `atom`/`read`/`update`.
export type StatusBandState = {
  /** True when the project carries the aia-harness mark. */
  enabled: boolean;
  /** File names in `.claude/commands/pm/`. */
  pmFiles: string[];
  /** Worktree name, empty outside a worktree. */
  worktree: string;
  /** Current git branch, empty when unknown. */
  branch: string;
  /** Open pull request of the branch. */
  pr: { number: number; url: string } | null;
  /** Armed two-click confirmation: the button, what it acts on (PR number or worktree name) and the time it expires (ms). */
  confirm: { id: string; target: string; until: number } | null;
  /** Bumped when only visibility changes, so the band redraws. */
  rev: number;
};

declare module "claude-code" {
  interface PluginState {
    "aia-harness": { statusBand: StatusBandState };
  }
}
