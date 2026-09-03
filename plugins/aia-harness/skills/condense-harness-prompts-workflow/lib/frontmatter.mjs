// frontmatter.mjs — condense-harness-prompts `frontmatter` subcommand: validate and
// auto-fix Claude Code frontmatter for a list of files.
// Pure move out of condense.mjs — see condense.mjs's header for the full subcommand list.

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { fail } from "./cli.mjs";

// ---------- frontmatter validate+fix ----------

/** @param {string[]} args */
export async function cmdFrontmatter(args) {
  const files = args.filter((a) => !a.startsWith("--"));
  if (!files.length) fail("frontmatter: pass one or more file paths");

  // Import the aia-harness frontmatter validator. Relative path:
  // skills/condense-harness-prompts-workflow/lib/ → 3 levels up → plugin root → lib/validate/.
  // Works both in development and at installed plugin path (~/.claude/plugins/aia-harness/).
  const pluginRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
  const { validateFrontmatter, detectAssetType } = await import(
    pathToFileURL(join(pluginRoot, "lib/validate/frontmatter.mjs")).href
  );

  const report = [];
  for (const f of files) {
    if (!existsSync(f)) {
      report.push({ file: f, status: "MISSING" });
      continue;
    }

    const type = detectAssetType(f);
    if (!type) {
      report.push({ file: f, status: "SKIP", reason: "unrecognized artifact type" });
      continue;
    }

    const content = readFileSync(f, "utf8");
    const { valid, errors, warnings, normalized } = validateFrontmatter(content, type);

    if (!valid) {
      writeFileSync(f, normalized);
      report.push({ file: f, status: "FIXED", type, errors, warnings });
    } else if (warnings.length) {
      report.push({ file: f, status: "OK_WARNINGS", type, errors: [], warnings });
    } else {
      report.push({ file: f, status: "OK", type, errors: [], warnings: [] });
    }
  }

  // Human report
  const line = "─".repeat(60);
  process.stdout.write(`\n${line}\n  frontmatter validation + fix report\n${line}\n`);
  let fixed = 0;
  for (const r of report) {
    if (r.status === "FIXED") {
      fixed++;
      process.stdout.write(`🔧 [${r.type}] ${r.file}\n   FIXED: ${r.errors.join("; ")}\n`);
      if (r.warnings.length) process.stdout.write(`   warn: ${r.warnings.join("; ")}\n`);
    } else if (r.status === "OK_WARNINGS") {
      process.stdout.write(`⚠️  [${r.type}] ${r.file}\n   warn: ${r.warnings.join("; ")}\n`);
    } else if (r.status === "OK") {
      process.stdout.write(`✅ [${r.type}] ${r.file}\n`);
    } else {
      process.stdout.write(`➖ ${r.file}  (${r.status}${r.reason ? ": " + r.reason : ""})\n`);
    }
  }
  const ok = report.filter((r) => r.status === "OK").length;
  const warnCount = report.filter((r) => r.status === "OK_WARNINGS").length;
  process.stdout.write(
    `${line}\n  ${fixed} fixed · ${ok} ok · ${warnCount} with warnings\n${line}\n`,
  );

  // Machine summary (last line, JSON) for the command to parse if needed.
  process.stdout.write("\nJSON " + JSON.stringify(report) + "\n");
}
