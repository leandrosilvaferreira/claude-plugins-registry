// Pure check: is a project root the user's home directory? No `$`, no Node-only imports.

/**
 * Canonical form for comparing paths across Linux, macOS, Windows and Git Bash.
 * @param {string} p
 * @returns {{ path: string, windows: boolean }}
 */
function normalize(p) {
  let s = p.replace(/\\/g, "/").replace(/\/+/g, "/");
  // Git Bash / MSYS drive path: /c/Users/x -> C:/Users/x
  s = s.replace(/^\/([a-zA-Z])(?=\/|$)/, (_, d) => `${d}:`);
  if (s.length > 1 && s.endsWith("/")) s = s.slice(0, -1);
  const windows = /^[a-zA-Z]:/.test(s);
  if (windows) s = s[0].toUpperCase() + s.slice(1);
  return { path: s, windows };
}

/**
 * @param {string} root
 * @param {{ home?: string, userProfile?: string, homeDrive?: string, homePath?: string }} env
 * @returns {boolean}
 */
export function isHomeDir(root, env) {
  const candidates = [
    env.home,
    env.userProfile,
    env.homeDrive && env.homePath ? env.homeDrive + env.homePath : undefined,
  ].filter((c) => typeof c === "string" && c !== "");
  const r = normalize(root);
  return candidates.some((c) => {
    const h = normalize(/** @type {string} */ (c));
    return r.windows && h.windows
      ? r.path.toLowerCase() === h.path.toLowerCase()
      : r.path === h.path;
  });
}
