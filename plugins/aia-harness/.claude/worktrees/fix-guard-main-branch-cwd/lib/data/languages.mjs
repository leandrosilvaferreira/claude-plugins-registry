/**
 * Extension → language map (Linguist-lite). Each entry classifies the language
 * so the detector can pick a primary *programming* language and ignore prose/data.
 *
 * @module data/languages
 */

/** @typedef {{ name: string, type: "programming"|"markup"|"data"|"prose"|"config" }} LangDef */

/** @type {Record<string, LangDef>} */
export const EXTENSION_LANGUAGES = {
  // JS / TS family
  ".js": { name: "JavaScript", type: "programming" },
  ".mjs": { name: "JavaScript", type: "programming" },
  ".cjs": { name: "JavaScript", type: "programming" },
  ".jsx": { name: "JavaScript", type: "programming" },
  ".ts": { name: "TypeScript", type: "programming" },
  ".mts": { name: "TypeScript", type: "programming" },
  ".cts": { name: "TypeScript", type: "programming" },
  ".tsx": { name: "TypeScript", type: "programming" },
  ".vue": { name: "Vue", type: "programming" },
  ".svelte": { name: "Svelte", type: "programming" },
  ".astro": { name: "Astro", type: "programming" },
  // PHP
  ".php": { name: "PHP", type: "programming" },
  ".phtml": { name: "PHP", type: "programming" },
  ".blade.php": { name: "PHP", type: "programming" },
  // Python
  ".py": { name: "Python", type: "programming" },
  ".pyi": { name: "Python", type: "programming" },
  // Go
  ".go": { name: "Go", type: "programming" },
  // Rust
  ".rs": { name: "Rust", type: "programming" },
  // JVM
  ".java": { name: "Java", type: "programming" },
  ".kt": { name: "Kotlin", type: "programming" },
  ".kts": { name: "Kotlin", type: "programming" },
  ".scala": { name: "Scala", type: "programming" },
  ".groovy": { name: "Groovy", type: "programming" },
  // Ruby
  ".rb": { name: "Ruby", type: "programming" },
  ".erb": { name: "Ruby", type: "programming" },
  // .NET
  ".cs": { name: "C#", type: "programming" },
  ".fs": { name: "F#", type: "programming" },
  ".vb": { name: "Visual Basic", type: "programming" },
  // C / C++
  ".c": { name: "C", type: "programming" },
  ".h": { name: "C", type: "programming" },
  ".cc": { name: "C++", type: "programming" },
  ".cpp": { name: "C++", type: "programming" },
  ".cxx": { name: "C++", type: "programming" },
  ".hpp": { name: "C++", type: "programming" },
  // Others
  ".swift": { name: "Swift", type: "programming" },
  ".m": { name: "Objective-C", type: "programming" },
  ".dart": { name: "Dart", type: "programming" },
  ".ex": { name: "Elixir", type: "programming" },
  ".exs": { name: "Elixir", type: "programming" },
  ".erl": { name: "Erlang", type: "programming" },
  ".clj": { name: "Clojure", type: "programming" },
  ".hs": { name: "Haskell", type: "programming" },
  ".lua": { name: "Lua", type: "programming" },
  ".r": { name: "R", type: "programming" },
  ".jl": { name: "Julia", type: "programming" },
  ".sh": { name: "Shell", type: "programming" },
  ".bash": { name: "Shell", type: "programming" },
  ".zsh": { name: "Shell", type: "programming" },
  ".ps1": { name: "PowerShell", type: "programming" },
  ".sql": { name: "SQL", type: "programming" },
  // Markup / styling
  ".html": { name: "HTML", type: "markup" },
  ".htm": { name: "HTML", type: "markup" },
  ".css": { name: "CSS", type: "markup" },
  ".scss": { name: "SCSS", type: "markup" },
  ".sass": { name: "Sass", type: "markup" },
  ".less": { name: "Less", type: "markup" },
  // Data / config
  ".json": { name: "JSON", type: "data" },
  ".jsonc": { name: "JSON", type: "data" },
  ".yaml": { name: "YAML", type: "data" },
  ".yml": { name: "YAML", type: "data" },
  ".toml": { name: "TOML", type: "config" },
  ".ini": { name: "INI", type: "config" },
  ".xml": { name: "XML", type: "data" },
  ".env": { name: "Dotenv", type: "config" },
  // Prose
  ".md": { name: "Markdown", type: "prose" },
  ".mdx": { name: "MDX", type: "prose" },
  ".txt": { name: "Text", type: "prose" },
  ".rst": { name: "reStructuredText", type: "prose" },
};

/**
 * Resolve a file (by basename + ext) to a language definition.
 * Handles compound extensions like `.blade.php`.
 * @param {string} base lowercase basename
 * @param {string} ext lowercase extension
 * @returns {LangDef|null}
 */
export function classify(base, ext) {
  if (base.endsWith(".blade.php")) return EXTENSION_LANGUAGES[".blade.php"];
  return EXTENSION_LANGUAGES[ext] ?? null;
}
