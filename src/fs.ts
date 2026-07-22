import { readFile } from "node:fs/promises";

export async function readTextIfPresent(path: string): Promise<string | null> {
  try {
    return await readFile(path, "utf8");
  } catch (error) {
    if (isNotFound(error)) return null;
    throw error;
  }
}

export async function fileExists(path: string): Promise<boolean> {
  return (await readTextIfPresent(path)) !== null;
}

export function isNotFound(error: unknown): boolean {
  return error instanceof Error &&
    "code" in error &&
    (error as Error & { code?: string }).code === "ENOENT";
}

/** Minimal JSONC reader for formatter configuration inspection. */
export function parseJsonc(text: string): unknown {
  let output = "";
  let inString = false;
  let escaped = false;
  let lineComment = false;
  let blockComment = false;

  for (let index = 0; index < text.length; index++) {
    const char = text[index];
    const next = text[index + 1];
    if (lineComment) {
      if (char === "\n") {
        lineComment = false;
        output += char;
      } else {
        output += " ";
      }
      continue;
    }
    if (blockComment) {
      if (char === "*" && next === "/") {
        blockComment = false;
        output += "  ";
        index++;
      } else {
        output += char === "\n" ? "\n" : " ";
      }
      continue;
    }
    if (inString) {
      output += char;
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === '"') inString = false;
      continue;
    }
    if (char === '"') {
      inString = true;
      output += char;
    } else if (char === "/" && next === "/") {
      lineComment = true;
      output += "  ";
      index++;
    } else if (char === "/" && next === "*") {
      blockComment = true;
      output += "  ";
      index++;
    } else {
      output += char;
    }
  }

  let withoutTrailingCommas = "";
  inString = false;
  escaped = false;
  for (let index = 0; index < output.length; index++) {
    const char = output[index];
    if (inString) {
      withoutTrailingCommas += char;
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === '"') inString = false;
      continue;
    }
    if (char === '"') {
      inString = true;
      withoutTrailingCommas += char;
      continue;
    }
    if (char === ",") {
      let nextIndex = index + 1;
      while (/\s/.test(output[nextIndex] ?? "")) nextIndex++;
      if (output[nextIndex] === "}" || output[nextIndex] === "]") {
        withoutTrailingCommas += " ";
        continue;
      }
    }
    withoutTrailingCommas += char;
  }

  return JSON.parse(withoutTrailingCommas);
}

export async function readJsoncIfPresent(
  path: string,
): Promise<Record<string, unknown> | null> {
  const text = await readTextIfPresent(path);
  if (text === null) return null;
  const value = parseJsonc(text);
  return value && typeof value === "object"
    ? value as Record<string, unknown>
    : {};
}
