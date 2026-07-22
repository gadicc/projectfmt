/** Match the formatter configuration glob subset used by Deno and Biome. */
export function matchesGlob(pattern: string, path: string): boolean {
  const normalized = pattern.replace(/^!/, "").replace(/^\.\//, "")
    .replaceAll("\\", "/");
  if (normalized.endsWith("/")) return path.startsWith(normalized);
  let regex = "^";
  for (let index = 0; index < normalized.length; index++) {
    const char = normalized[index];
    if (char === "*" && normalized[index + 1] === "*") {
      index++;
      if (normalized[index + 1] === "/") {
        index++;
        regex += "(?:.*/)?";
      } else {
        regex += ".*";
      }
    } else if (char === "*") {
      regex += "[^/]*";
    } else if (char === "?") {
      regex += "[^/]";
    } else {
      regex += char.replace(/[|\\{}()[\]^$+?.]/g, "\\$&");
    }
  }
  return new RegExp(`${regex}(?:$|/)`).test(path);
}

/** Evaluate ordered include patterns with `!` exclusions and exceptions. */
export function isIncluded(patterns: readonly string[], path: string): boolean {
  if (patterns.length === 0) return true;
  let included = !patterns.some((pattern) => !pattern.startsWith("!"));
  for (const pattern of patterns) {
    if (matchesGlob(pattern, path)) included = !pattern.startsWith("!");
  }
  return included;
}
