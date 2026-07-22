import { cwd } from "node:process";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";
import { stat } from "node:fs/promises";

import { FormatterResolutionError } from "./errors.ts";

export interface NormalizedPaths {
  projectRoot: string;
  filePath: string;
}

export function normalizePaths(
  filePath: string,
  projectRoot = cwd(),
): NormalizedPaths {
  if (!filePath || typeof filePath !== "string") {
    throw new FormatterResolutionError("filePath must be a non-empty string", {
      code: "INVALID_OPTIONS",
    });
  }
  const root = resolve(projectRoot);
  const target = isAbsolute(filePath)
    ? resolve(filePath)
    : resolve(root, filePath);
  const fromRoot = relative(root, target);
  if (
    fromRoot === ".." || fromRoot.startsWith(`..${sep}`) ||
    isAbsolute(fromRoot)
  ) {
    throw new FormatterResolutionError(
      `Intended file path must stay within projectRoot: ${filePath}`,
      {
        code: "INVALID_OPTIONS",
        filePath: target,
        projectRoot: root,
      },
    );
  }
  return { projectRoot: root, filePath: target };
}

export function ancestorDirectories(
  filePath: string,
  projectRoot: string,
): string[] {
  const directories: string[] = [];
  let current = dirname(filePath);
  while (true) {
    directories.push(current);
    if (current === projectRoot) return directories;
    const parent = dirname(current);
    if (parent === current) return directories;
    current = parent;
  }
}

export async function nearestExistingDirectory(
  path: string,
  projectRoot: string,
): Promise<string> {
  let current = path;
  while (true) {
    try {
      if ((await stat(current)).isDirectory()) return current;
    } catch {
      // Generated destinations commonly do not exist yet.
    }
    if (current === projectRoot) return projectRoot;
    const parent = dirname(current);
    if (parent === current) return projectRoot;
    current = parent;
  }
}
