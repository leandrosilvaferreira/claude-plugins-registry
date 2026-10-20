/**
 * Decides whether the status band is enabled for a project.
 * @param {string | undefined} settingsText Raw text of `<project>/.claude/settings.json`.
 * @returns {boolean} True when `enabledPlugins` has an `aia-harness@*` key set to `true`.
 */
export function isBandEnabled(settingsText) {
  if (typeof settingsText !== "string") return false;
  try {
    // A BOM makes JSON.parse throw, which disables the band on purpose.
    const plugins = JSON.parse(settingsText)?.enabledPlugins;
    if (!plugins || typeof plugins !== "object") return false;
    return Object.entries(plugins).some(
      ([key, value]) => key.startsWith("aia-harness@") && value === true,
    );
  } catch {
    return false;
  }
}
