---
name: readline-question-close-race
description: node:readline ask()-style helpers can lose a piped y/n answer to a close-event race — guard with an answered flag
metadata:
  type: architecture
---

A common interactive-prompt helper shape:

```js
const rl = createInterface({ input: process.stdin, output: process.stdout });
rl.on("close", () => res(""));           // fallback for EOF-without-answer
rl.question(question, (answer) => {
  rl.close();
  res(answer.trim());
});
```

On a piped, non-TTY stdin (e.g. `printf 'y\n' | node script.mjs`, or any agent/CI driving the
script non-interactively) this can resolve to `""` even though a real answer ("y") was sent.
`rl.close()` inside the question callback can fire the `'close'` handler before this same
callback reaches its own `res(answer)` line, so the empty fallback wins the resolve race and
the caller silently takes the "no" branch — `process.exit(0)` with no message, indistinguishable
from a hang from the outside.

**Why:** Bit `scripts/publish-to-registry.mjs`'s first prompt (dirty-tree "Continue anyway?",
the only one of its four `ask()` calls with no env-var bypass) — reproduced in isolation with a
5-line repro before trusting the fix, since the failure mode (silent exit 0, no error) looks
identical to "script just didn't get the memo" and is easy to misdiagnose as an environment or
piping problem rather than a code race.

**How to apply:** Any `ask()`/readline-question helper in this repo (or one you write) must set
an `answered` flag *before* calling `rl.close()`, and have the `'close'` fallback check it:
`rl.on("close", () => { if (!answered) res(""); })`, then `answered = true; rl.close();
res(answer.trim());` inside the question callback. Without the flag, non-interactive/piped
answers to that specific prompt are unreliable — real terminal use is unaffected either way,
which is why this can ship unnoticed for a long time. See [[publish-registry-command]].
