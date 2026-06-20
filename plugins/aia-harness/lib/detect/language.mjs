/**
 * Language detection by extension, weighted by bytes (Linguist-lite).
 * @module detect/language
 */
import { classify } from "../data/languages.mjs";

/**
 * @param {import('../util/fs.mjs').CollectedFile[]} files
 * @returns {{ languages: import('../profile.mjs').LanguageInfo[], primaryLanguage: string|null }}
 */
export function detectLanguages(files) {
  /** @type {Map<string, { name: string, type: import('../data/languages.mjs').LangDef["type"], bytes: number, files: number }>} */
  const byName = new Map();
  for (const f of files) {
    const def = classify(f.base.toLowerCase(), f.ext);
    if (!def) continue;
    const cur = byName.get(def.name) ?? { name: def.name, type: def.type, bytes: 0, files: 0 };
    cur.bytes += f.size;
    cur.files += 1;
    byName.set(def.name, cur);
  }

  const all = [...byName.values()];
  const progBytes = all
    .filter((l) => l.type === "programming")
    .reduce((sum, l) => sum + l.bytes, 0);
  const denom = progBytes || 1;

  /** @type {import('../profile.mjs').LanguageInfo[]} */
  const languages = all
    .map((l) => ({
      name: l.name,
      type: l.type,
      bytes: l.bytes,
      files: l.files,
      share: l.type === "programming" ? l.bytes / denom : 0,
    }))
    .sort((a, b) => b.bytes - a.bytes || (a.name < b.name ? -1 : 1));

  const programming = languages.filter((l) => l.type === "programming");
  const primaryLanguage = programming.length > 0 ? programming[0].name : null;
  return { languages, primaryLanguage };
}
