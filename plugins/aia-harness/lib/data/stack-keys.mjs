/**
 * Pure stack-key resolver — shared by ecc-catalog and agkit-catalog.
 * Extracted here to avoid circular imports (agkit-catalog imports this,
 * ecc-catalog can therefore import agkit-catalog without a cycle).
 *
 * @module data/stack-keys
 */

/**
 * Resolve ECC-compatible stack keys for a project profile.
 * @param {import('../profile.mjs').ProjectProfile} profile
 * @returns {string[]}
 */
export function stackKeys(profile) {
  /** @type {string[]} */
  const keys = [];
  const fw = profile.frameworks.map((f) => f.name);
  const has = (/** @type {string} */ n) => fw.includes(n);

  switch (profile.primaryLanguage) {
    case "Go":
      keys.push("go");
      break;
    case "Rust":
      keys.push("rust");
      break;
    case "TypeScript":
    case "JavaScript":
      keys.push("typescript");
      if (has("React") || has("Next.js") || has("Nest.js")) keys.push("react");
      if (has("Next.js")) keys.push("next");
      if (has("Vue") || has("Nuxt")) keys.push("vue");
      break;
    case "Java":
      if (has("Quarkus")) keys.push("java-quarkus");
      else if (has("Spring Boot")) keys.push("java-spring");
      else keys.push("java");
      break;
    case "Kotlin":
      keys.push("kotlin");
      break;
    case "PHP":
      if (has("Laravel")) keys.push("php-laravel");
      else if (has("Adianti")) keys.push("php-adianti");
      else keys.push("php");
      break;
    case "Python":
      keys.push("python");
      if (has("Django")) keys.push("django");
      if (has("FastAPI")) keys.push("fastapi");
      break;
    case "C#":
      keys.push("csharp");
      break;
    case "C++":
      keys.push("cpp");
      break;
    case "Dart":
      keys.push("dart");
      break;
    default:
      break;
  }
  return keys;
}
