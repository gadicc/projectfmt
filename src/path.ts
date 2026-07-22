import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { readdir, readFile, stat } from "node:fs/promises";

import { FormatterResolutionError } from "./errors.ts";
import {
  formatterProjectMarkerNames,
  packageYamlHasPrettier,
} from "./config-names.ts";
import { parseJsonc } from "./fs.ts";

export interface NormalizedPaths {
  projectRoot: string;
  filePath: string;
}

interface DetectedProjectRoot {
  root: string;
  kind: "boundary" | "fallback";
}

const rootCache = new Map<string, DetectedProjectRoot>();
const rootDetectionInFlight = new Map<string, Promise<DetectedProjectRoot>>();
let rootCacheGeneration = 0;

const workspaceMarkers = new Set([
  "lerna.json",
  "pnpm-workspace.yaml",
  "rush.json",
]);

const projectMarkers = new Set([
  "package.json",
  "jsr.json",
  "jsr.jsonc",
  "package-lock.json",
  "pnpm-lock.yaml",
  "yarn.lock",
  "bun.lock",
  "bun.lockb",
  "deno.lock",
  ...formatterProjectMarkerNames,
]);

export async function normalizePaths(
  filePath: string,
  projectRoot?: string,
): Promise<NormalizedPaths> {
  if (!filePath || typeof filePath !== "string") {
    throw new FormatterResolutionError("filePath must be a non-empty string", {
      code: "INVALID_OPTIONS",
    });
  }
  if (
    projectRoot !== undefined &&
    (typeof projectRoot !== "string" || !projectRoot)
  ) {
    throw new FormatterResolutionError(
      "projectRoot must be a non-empty string when provided",
      { code: "INVALID_OPTIONS" },
    );
  }
  if (projectRoot === undefined && !isAbsolute(filePath)) {
    throw new FormatterResolutionError(
      "projectRoot is required when filePath is relative",
      { code: "INVALID_OPTIONS", filePath },
    );
  }

  const target = isAbsolute(filePath)
    ? resolve(filePath)
    : resolve(projectRoot!, filePath);
  const root = projectRoot === undefined
    ? (await inferProjectRoot(target)).root
    : resolve(projectRoot);
  if (target === root) {
    throw new FormatterResolutionError(
      `Intended path must name a file below projectRoot: ${filePath}`,
      {
        code: "INVALID_OPTIONS",
        filePath: target,
        projectRoot: root,
      },
    );
  }
  if (!isWithinProjectRoot(target, root)) {
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

/** Clear project roots inferred for absolute intended file paths. */
export function clearProjectRootCache(): void {
  rootCacheGeneration++;
  rootCache.clear();
  rootDetectionInFlight.clear();
}

async function inferProjectRoot(
  filePath: string,
): Promise<DetectedProjectRoot> {
  const start = dirname(filePath);
  const cached = rootCache.get(start);
  if (cached) return cached;

  const existing = rootDetectionInFlight.get(start);
  if (existing) return await existing;

  const generation = rootCacheGeneration;
  const detection = detectProjectRoot(start, filePath, generation);
  rootDetectionInFlight.set(start, detection);
  try {
    return await detection;
  } finally {
    if (rootDetectionInFlight.get(start) === detection) {
      rootDetectionInFlight.delete(start);
    }
  }
}

async function detectProjectRoot(
  start: string,
  filePath: string,
  generation: number,
): Promise<DetectedProjectRoot> {
  const traversed: string[] = [];
  let nearestProjectMarker: string | null = null;
  let current = start;

  while (true) {
    traversed.push(current);
    let markers: Awaited<ReturnType<typeof inspectProjectMarkers>>;
    try {
      markers = await inspectProjectMarkers(current);
    } catch (cause) {
      if (nearestProjectMarker) {
        // Scoped Deno permissions may make ancestors above a valid project
        // unreadable. The nearest marker remains a conservative boundary.
        return cacheDetectedRoot(traversed, {
          root: nearestProjectMarker,
          kind: "fallback",
        }, generation);
      }
      throw cause;
    }
    if (markers.boundary) {
      return cacheDetectedRoot(traversed, {
        root: current,
        kind: "boundary",
      }, generation);
    }
    if (markers.project && nearestProjectMarker === null) {
      nearestProjectMarker = current;
    }

    const cached = rootCache.get(current);
    if (cached) {
      const detected = cached.kind === "fallback" && nearestProjectMarker
        ? { root: nearestProjectMarker, kind: "fallback" as const }
        : cached;
      return cacheDetectedRoot(traversed, detected, generation);
    }

    const parent = dirname(current);
    if (parent === current) {
      if (nearestProjectMarker) {
        return cacheDetectedRoot(traversed, {
          root: nearestProjectMarker,
          kind: "fallback",
        }, generation);
      }
      throw new FormatterResolutionError(
        `Could not infer projectRoot for absolute filePath ${
          JSON.stringify(filePath)
        }; pass projectRoot explicitly`,
        { code: "INVALID_OPTIONS", filePath },
      );
    }
    current = parent;
  }
}

function cacheDetectedRoot(
  directories: readonly string[],
  detected: DetectedProjectRoot,
  generation: number,
): DetectedProjectRoot {
  if (generation !== rootCacheGeneration) return detected;
  for (const directory of directories) {
    const fromRoot = relative(detected.root, directory);
    if (
      fromRoot === "" ||
      (!isAbsolute(fromRoot) && fromRoot !== ".." &&
        !fromRoot.startsWith(`..${sep}`))
    ) {
      rootCache.set(directory, detected);
    }
  }
  return detected;
}

/** @internal Inspect one directory while inferring a project boundary. */
export async function inspectProjectMarkers(
  directory: string,
): Promise<{ boundary: boolean; project: boolean }> {
  let entries: string[];
  try {
    entries = await readdir(directory);
  } catch (cause) {
    if (isMissingPath(cause)) return { boundary: false, project: false };
    throw new FormatterResolutionError(
      `Failed to inspect ${directory} while inferring projectRoot`,
      { code: "INVALID_OPTIONS", projectRoot: directory, cause },
    );
  }
  const names = new Set(entries);
  if (names.has(".git") || names.has(".hg")) {
    return { boundary: true, project: true };
  }

  let workspace = [...workspaceMarkers].some((name) => names.has(name));
  if (!workspace && names.has("package.json")) {
    workspace = await manifestHasKey(
      join(directory, "package.json"),
      "workspaces",
    );
  }
  if (!workspace) {
    for (const name of ["deno.json", "deno.jsonc"]) {
      if (
        names.has(name) &&
        await manifestHasKey(join(directory, name), "workspace")
      ) {
        workspace = true;
        break;
      }
    }
  }
  const packageYamlProject = names.has("package.yaml") &&
    await packageYamlHasPrettier(join(directory, "package.yaml"));
  return {
    boundary: workspace,
    project: workspace || packageYamlProject ||
      [...projectMarkers].some((name) => names.has(name)),
  };
}

async function manifestHasKey(path: string, key: string): Promise<boolean> {
  try {
    const value = parseJsonc(await readFile(path, "utf8"));
    return value !== null && typeof value === "object" && key in value;
  } catch {
    // A malformed manifest is still a project marker, just not a workspace one.
    return false;
  }
}

function isMissingPath(error: unknown): boolean {
  return error instanceof Error && "code" in error &&
    ((error as Error & { code?: unknown }).code === "ENOENT" ||
      (error as Error & { code?: unknown }).code === "ENOTDIR");
}

export function ancestorDirectories(
  filePath: string,
  projectRoot: string,
): string[] {
  const directories: string[] = [];
  let current = dirname(filePath);
  if (!isWithinProjectRoot(current, projectRoot)) return directories;
  while (true) {
    directories.push(current);
    if (current === projectRoot) return directories;
    const parent = dirname(current);
    if (parent === current || !isWithinProjectRoot(parent, projectRoot)) {
      return directories;
    }
    current = parent;
  }
}

function isWithinProjectRoot(path: string, projectRoot: string): boolean {
  const fromRoot = relative(projectRoot, path);
  return fromRoot === "" ||
    (!isAbsolute(fromRoot) && fromRoot !== ".." &&
      !fromRoot.startsWith(`..${sep}`));
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
