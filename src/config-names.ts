import { parse } from "@std/yaml";

import { readTextIfPresent } from "./fs.ts";

/** Prettier standalone configuration names in native search order. */
export const prettierConfigNames = [
  ".prettierrc",
  ".prettierrc.json",
  ".prettierrc.yml",
  ".prettierrc.yaml",
  ".prettierrc.json5",
  ".prettierrc.js",
  ".prettierrc.ts",
  ".prettierrc.mjs",
  ".prettierrc.mts",
  ".prettierrc.cjs",
  ".prettierrc.cts",
  ".prettierrc.toml",
  "prettier.config.js",
  "prettier.config.ts",
  "prettier.config.mjs",
  "prettier.config.mts",
  "prettier.config.cjs",
  "prettier.config.cts",
] as const;

/** Biome configuration names in native search order. */
export const biomeConfigNames = [
  "biome.json",
  "biome.jsonc",
  ".biome.json",
  ".biome.jsonc",
] as const;

/** Deno configuration names in native search order. */
export const denoConfigNames = ["deno.json", "deno.jsonc"] as const;

/** Formatter config filenames that are unconditional project markers. */
export const formatterProjectMarkerNames = [
  ...prettierConfigNames,
  ...biomeConfigNames,
  ...denoConfigNames,
] as const;

/** Whether package.yaml contains Prettier's truthy own configuration key. */
export async function packageYamlHasPrettier(path: string): Promise<boolean> {
  const text = await readTextIfPresent(path);
  if (text === null) return false;
  try {
    const value = parse(text);
    return value !== null && typeof value === "object" &&
      !Array.isArray(value) && Object.hasOwn(value, "prettier") &&
      Boolean((value as Record<string, unknown>).prettier);
  } catch {
    return false;
  }
}
