// enumerate.mjs — condense-harness-prompts `enumerate` subcommand: list target .md files
// for a given scope (one path per line), skipping sensitive/empty/oversized files.
// Pure move out of condense.mjs — see condense.mjs's header for the full subcommand list.

import { existsSync, readdirSync, statSync } from "node:fs";
import { join, resolve, isAbsolute, basename } from "node:path";
import { flag, fail } from "./cli.mjs";

// Safety guardrails adopted from caveman-compress compress.py.
const MAX_FILE_SIZE = 500_000; // 500KB — refuse oversized prompts.

// Hard denylist for files that must never be shipped to the model. Compressing
// sends raw bytes to a subagent (Anthropic API boundary); a .env / key / creds
// file pointed at via --file would otherwise leak. Ported from compress.py.
const SENSITIVE_BASENAME_RE =
  /^(\.env(\..+)?|\.netrc|credentials(\..+)?|secrets?(\..+)?|passwords?(\..+)?|id_(rsa|dsa|ecdsa|ed25519)(\.pub)?|authorized_keys|known_hosts|.*\.(pem|key|p12|pfx|crt|cer|jks|keystore|asc|gpg))$/i;
const SENSITIVE_PATH_COMPONENTS = new Set([".ssh", ".aws", ".gnupg", ".kube", ".docker"]);
const SENSITIVE_NAME_TOKENS = [
  "secret",
  "credential",
  "password",
  "passwd",
  "apikey",
  "accesskey",
  "token",
  "privatekey",
];
/** @param {string} p @returns {boolean} */
function isSensitivePath(p) {
  const name = basename(p);
  if (SENSITIVE_BASENAME_RE.test(name)) return true;
  const parts = p.split(/[/\\]/).map((s) => s.toLowerCase());
  if (parts.some((x) => SENSITIVE_PATH_COMPONENTS.has(x))) return true;
  const lower = name.toLowerCase().replace(/[_\-\s.]/g, "");
  return SENSITIVE_NAME_TOKENS.some((t) => lower.includes(t));
}

// ---------- file discovery ----------

/** @param {string} dir @returns {string[]} */
function listMd(dir) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true })
    .filter((d) => d.isFile() && d.name.endsWith(".md"))
    .map((d) => join(dir, d.name))
    .sort();
}

/** @param {string} dir @returns {string[]} */
function listMdRecursive(dir) {
  if (!existsSync(dir)) return [];
  const out = [];
  for (const d of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, d.name);
    if (d.isDirectory()) out.push(...listMdRecursive(p));
    else if (d.name.endsWith(".md")) out.push(p);
  }
  return out.sort();
}

/** @param {number} n @returns {string} */
function humanSize(n) {
  if (n < 1024) return `${n}b`;
  return `${(n / 1024).toFixed(1)}KB`;
}

// ---------- enumerate ----------

/** @param {string[]} args */
export function cmdEnumerate(args) {
  const root = flag(args, "--root") || process.cwd();
  const claude = join(root, ".claude");
  const fileArg = flag(args, "--file");
  const type = flag(args, "--type");
  const name = flag(args, "--name");
  const all = args.includes("--all");

  let files = [];

  if (fileArg) {
    const p = isAbsolute(fileArg) ? fileArg : resolve(root, fileArg);
    if (!existsSync(p)) fail(`File not found: ${p}`);
    files = [p];
  } else if (all) {
    files = [
      ...listMd(join(claude, "agents")),
      ...listMd(join(claude, "commands")),
      ...listMd(join(claude, "rules")),
    ];
  } else if (type === "agents" || type === "commands" || type === "rules") {
    files = listMd(join(claude, type));
  } else if (type === "skills") {
    // Skills: ONE skill per run. --name is the skill directory under .claude/skills.
    if (!name) fail("--type skills requires --name <skill-dir> (one skill at a time)");
    const skillDir = join(claude, "skills", name);
    if (!existsSync(skillDir)) fail(`Skill not found: ${skillDir}`);
    files = listMdRecursive(skillDir);
  } else {
    fail(
      "enumerate: pass --all | --type <agents|commands|rules|skills> [--name X] | --file <path>",
    );
  }

  // Never feed our own backup sidecars back in.
  files = files.filter((f) => !f.endsWith(".condensed.tmp"));

  // Guardrails (compress.py): refuse sensitive / empty / oversized files.
  // Excluded here so they are never sent to a subagent — note each on stderr
  // (not stdout) so the path list the skill consumes stays clean.
  const rows = [];
  const skipped = [];
  for (const f of files) {
    if (isSensitivePath(f)) {
      skipped.push([f, "sensitive (secret/PII heuristic)"]);
      continue;
    }
    const size = statSync(f).size;
    if (size === 0) {
      skipped.push([f, "empty"]);
      continue;
    }
    if (size > MAX_FILE_SIZE) {
      skipped.push([f, `too large (${size}b > ${MAX_FILE_SIZE}b)`]);
      continue;
    }
    rows.push({ path: f, size });
  }

  // Largest first — biggest prompts have the most to gain from condensing.
  rows.sort((a, b) => b.size - a.size);

  for (const [f, why] of skipped) process.stderr.write(`SKIP ${f} — ${why}\n`);

  // Output: "<bytes>\t<human>\t<path>" per line, already sorted desc.
  const out = rows.map((r) => `${r.size}\t${humanSize(r.size)}\t${r.path}`).join("\n");
  process.stdout.write(out + (rows.length ? "\n" : ""));
}
