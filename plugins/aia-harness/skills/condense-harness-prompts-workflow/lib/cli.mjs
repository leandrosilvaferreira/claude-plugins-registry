// cli.mjs — shared CLI argument/exit helpers for the condense-harness-prompts skill's
// deterministic layer. Split out of condense.mjs so enumerate.mjs, commit.mjs, and
// frontmatter.mjs can each use them without duplicating them.

/** @param {string[]} args @param {string} name @returns {string | null} */
export function flag(args, name) {
  const i = args.indexOf(name);
  return i >= 0 && i + 1 < args.length ? args[i + 1] : null;
}

/** @param {string} msg @returns {never} */
export function fail(msg) {
  process.stderr.write(`${msg}\n`);
  process.exit(1);
}
