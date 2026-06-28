/**
 * Cross-platform system dependency detection.
 *
 * findBinary   — resolves a binary name to an absolute path (PATH + fallbacks).
 * checkSystemDeps — checks a list of deps and returns a DepsReport.
 * resolveDepsFromProfile — infers which deps to check from a ProjectProfile.
 *
 * @module detect/system-deps
 */
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { ENGINE_DEPS, STACK_DEPS, TOOL_DEPS, INSTALL_HINTS } from "../data/deps-catalog.mjs";
import { TOOLS } from "../data/tools-catalog.mjs";

/** @typedef {import('../profile.mjs').DepEntry} DepEntry */
/** @typedef {import('../profile.mjs').DepCheck} DepCheck */
/** @typedef {import('../profile.mjs').DepsReport} DepsReport */

/**
 * Extra candidate paths to check beyond PATH, per binary name.
 * @param {string} name
 * @param {string} platform
 * @param {Record<string,string|undefined>} env
 * @returns {string[]}
 */
function extraCandidates(name, platform, env) {
  const home = env.HOME ?? env.USERPROFILE ?? "";
  if (name === "node") {
    const c = [];
    if (env.FNM_DIR) c.push(path.join(env.FNM_DIR, "aliases", "default", "bin", "node"));
    if (platform === "win32") {
      const ap = env.APPDATA ?? "";
      c.push(path.join(ap, "fnm", "aliases", "default", "node.exe"));
    }
    return c;
  }
  if (name === "python3" || name === "python") {
    const c = [];
    if (env.PYENV_ROOT) c.push(path.join(env.PYENV_ROOT, "shims", "python3"));
    if (platform === "win32") {
      const la = env.LOCALAPPDATA ?? "";
      c.push(path.join(la, "Programs", "Python", "Python312", "python.exe"));
      c.push(path.join(la, "Programs", "Python", "Python311", "python.exe"));
    }
    return c;
  }
  if (name === "uv" || name === "cargo" || name === "rustup") {
    const cargoHome = env.CARGO_HOME ?? (home ? path.join(home, ".cargo") : "");
    if (!cargoHome) return [];
    return [path.join(cargoHome, "bin", name)];
  }
  if (name === "pip3" || name === "pip") {
    const c = [];
    if (env.PYENV_ROOT) c.push(path.join(env.PYENV_ROOT, "shims", name));
    if (home) c.push(path.join(home, ".local", "bin", name));
    return c;
  }
  if (name === "graphify") {
    const c = [];
    // uv tool bin-dir: ~/.local/bin (Linux/macOS) or %APPDATA%\uv\bin (Windows)
    if (home) {
      c.push(path.join(home, ".local", "bin", "graphify"));
      c.push(path.join(home, ".local", "bin", "graphify.exe"));
    }
    const ap = env.APPDATA ?? "";
    if (ap) c.push(path.join(ap, "uv", "bin", "graphify.exe"));
    const la = env.LOCALAPPDATA ?? "";
    if (la) c.push(path.join(la, "uv", "bin", "graphify.exe"));
    return c;
  }
  if (name === "rtk") {
    const c = [];
    // curl installer default: ~/.local/bin (Linux/macOS)
    if (home) c.push(path.join(home, ".local", "bin", "rtk"));
    // cargo source build: $CARGO_HOME/bin or ~/.cargo/bin
    const cargoHome = env.CARGO_HOME ?? (home ? path.join(home, ".cargo") : "");
    if (cargoHome) c.push(path.join(cargoHome, "bin", "rtk"));
    if (platform === "darwin") {
      // Hardcoded Homebrew prefixes: Apple Silicon uses /opt/homebrew, Intel Macs use
      // /usr/local. These are the only two standard Homebrew installation prefixes on macOS.
      // Dynamic resolution via `brew --prefix` was considered but avoided — it would add a
      // subprocess call on every session start and fail if Homebrew itself is not on PATH.
      // These paths are supplemental fallbacks; PATH lookup already ran before this function.
      c.push("/opt/homebrew/bin/rtk");
      c.push("/usr/local/bin/rtk");
    }
    if (platform === "win32") {
      // manual extract to %USERPROFILE%\.local\bin
      const up = env.USERPROFILE ?? home;
      if (up) c.push(path.join(up, ".local", "bin", "rtk.exe"));
    }
    return c;
  }
  return [];
}

/**
 * Resolve a binary name to its absolute path, or null if not found.
 * Searches PATH first, then platform-specific fallback locations.
 *
 * @param {string} name
 * @param {string} platform  process.platform value
 * @param {Record<string,string|undefined>} env  pass process.env for real use; custom env for tests
 * @returns {string|null}
 */
export function findBinary(name, platform, env) {
  const sep = platform === "win32" ? ";" : ":";
  const exts = platform === "win32" ? [".exe", ".cmd", ".bat", ""] : [""];
  const pathDirs = (env.PATH ?? "").split(sep).filter(Boolean);

  // Search PATH dirs: join dir + name + ext for each combination.
  for (const dir of pathDirs) {
    for (const ext of exts) {
      const candidate = path.join(dir, name + ext);
      try {
        fs.accessSync(candidate, fs.constants.F_OK);
        return candidate;
      } catch {
        /* not found here */
      }
    }
  }

  // Extra candidates are always full paths (may use a different base name,
  // e.g. python.exe for python3 on Windows) — try each as-is.
  for (const fullPath of extraCandidates(name, platform, env)) {
    try {
      fs.accessSync(fullPath, fs.constants.F_OK);
      return fullPath;
    } catch {
      /* not found here */
    }
  }

  return null;
}

/**
 * Get a version string for a resolved binary using spawnSync.
 * Tries '--version' then 'version' (as subcommand) to cover most CLIs.
 * @param {string} name     Binary name (used to pick the right flag).
 * @param {string} binPath  Resolved absolute path.
 * @returns {string|null}
 */
function getVersion(name, binPath) {
  /** @type {Record<string, string[][]>} */
  const flagSets = {
    go: [["version"]],
    php: [["-v"]],
    mvn: [["--version"]],
  };
  const attempts = flagSets[name] ?? [["--version"], ["version"]];
  for (const args of attempts) {
    const r = spawnSync(binPath, args, { timeout: 5000, encoding: "utf8", windowsHide: true });
    const combined = (r.stdout ?? "") + (r.stderr ?? "");
    const m = combined.match(/\d+\.\d+[\d.]*/);
    if (m) return m[0];
  }
  return null;
}

/**
 * Check whether each dep is available on this platform.
 *
 * @param {DepEntry[]} deps      List produced by resolveDepsFromProfile.
 * @param {string}     platform  process.platform: 'win32'|'darwin'|'linux'
 * @returns {DepsReport}
 */
export function checkSystemDeps(deps, platform) {
  /** @type {DepCheck[]} */
  const checks = [];
  /** @type {string[]} */
  const missing = [];

  for (const dep of deps) {
    const resolvedPath = findBinary(dep.name, platform, process.env) ?? "";
    const found = resolvedPath.length > 0;
    const version = found ? getVersion(dep.name, resolvedPath) : null;
    const hints = INSTALL_HINTS[dep.name] ?? { win32: "", darwin: "", linux: "" };

    checks.push({
      name: dep.name,
      found,
      version,
      resolvedPath,
      level: dep.level,
      installHint: hints,
    });

    if (!found && dep.level === "required") missing.push(dep.name);
  }

  // warn only when there are no required-missing (would be block) but also no
  // required deps at all — i.e. every missing dep is recommended-only.
  const hasAnyRequired = checks.some((c) => c.level === "required");
  const allRequiredFound =
    !hasAnyRequired || checks.every((c) => c.level !== "required" || c.found);
  const missingRecommendedOnly =
    allRequiredFound && checks.some((c) => !c.found && c.level === "recommended");
  const hasFoundRequired = checks.some((c) => c.level === "required" && c.found);
  const status =
    missing.length > 0 ? "block" : missingRecommendedOnly && !hasFoundRequired ? "warn" : "ok";

  return { status, checks, missing };
}

/**
 * Derive which system deps to check from a project profile + installed tools.
 * Engine deps (node) are always included.
 *
 * @param {{ primaryLanguage: string|null, packageManagers: Array<{ ecosystem: string }> }} profile
 * @param {string[]} installedTools  Tool names, e.g. ['rtk', 'graphify'].
 * @returns {DepEntry[]}
 */
export function resolveDepsFromProfile(profile, installedTools = []) {
  /** @type {Map<string, DepEntry>} */
  const seen = new Map();

  /** @param {DepEntry[]} deps */
  function add(deps) {
    for (const d of deps) {
      if (!seen.has(d.name)) seen.set(d.name, d);
    }
  }

  add(ENGINE_DEPS);

  const ecosystems = new Set((profile.packageManagers ?? []).map((pm) => pm.ecosystem));
  const lang = (profile.primaryLanguage ?? "").toLowerCase();

  if (lang === "python" || ecosystems.has("python")) add(STACK_DEPS.python ?? []);
  if (lang === "go" || ecosystems.has("go")) add(STACK_DEPS.go ?? []);
  if (lang === "php" || ecosystems.has("php")) add(STACK_DEPS.php ?? []);
  if (lang === "ruby" || ecosystems.has("ruby")) add(STACK_DEPS.ruby ?? []);
  if (["java", "kotlin", "scala", "groovy"].includes(lang) || ecosystems.has("jvm"))
    add(STACK_DEPS.java ?? []);
  if (lang === "rust" || ecosystems.has("rust")) add(STACK_DEPS.rust ?? []);
  if (lang === "c#" || ecosystems.has("dotnet")) add(STACK_DEPS.dotnet ?? []);

  for (const tool of installedTools) {
    add(TOOL_DEPS[tool] ?? []);
  }

  return [...seen.values()];
}

/**
 * Detect which tools from the TOOLS catalog are installed in a project directory.
 *
 * - Vendor tools: detected by presence of a hook script in `<dir>/.claude/hooks/`.
 * - CLI tools: detected by presence of `tool.detectIn` path relative to `<dir>`.
 * - Plugin / empty-deps tools: skipped — no project artifact to probe.
 *
 * @param {string} dir  Project root to probe.
 * @returns {string[]}  Installed tool IDs (subset of TOOLS[].id).
 */
export function detectInstalledTools(dir) {
  /** @type {string[]} */
  const installed = [];
  for (const tool of TOOLS) {
    if (tool.deps.length === 0) continue;

    if (tool.strategy === "vendor") {
      const script = tool.hooks.find((h) => h.script)?.script;
      if (script && fs.existsSync(path.join(dir, ".claude", "hooks", script))) {
        installed.push(tool.id);
      }
    } else if (tool.strategy === "cli" && tool.detectIn) {
      if (fs.existsSync(path.join(dir, tool.detectIn))) {
        installed.push(tool.id);
      }
    }
  }
  return installed;
}
