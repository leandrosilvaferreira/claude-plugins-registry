/**
 * The marker `applyPlan` writes above the block of `.gitignore` entries this
 * plugin manages.
 *
 * It lives in `lib/util/` rather than in `lib/apply.mjs` because both sides of
 * the pipeline need it and the dependency has to point inward: `apply.mjs`
 * (the write edge) emits it, and `lib/plan/vendored-artifacts.mjs` (pure) has
 * to skip it when seeding `.graphifyignore` from the project `.gitignore`, so
 * that seed is a fixed point across re-applies. Importing it from `apply.mjs`
 * would make a pure plan module depend on the IO edge.
 *
 * @module util/gitignore
 */

export const GITIGNORE_HEADER = "# aia-harness";
