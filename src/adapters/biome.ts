import { arch, platform } from "node:process";
import { dirname, relative, sep } from "node:path";

import { parseJsonc, readTextIfPresent } from "../fs.ts";
import { isIncluded } from "../glob.ts";
import { resolveProjectPackage } from "../package.ts";
import { runCommand } from "../process.ts";
import type { AdapterContext, FormatterAdapter } from "../types.ts";
import { configFileEvidence, packageEvidence } from "./discovery.ts";

const configNames = ["biome.json", "biome.jsonc"] as const;

/** Built-in project-local Biome CLI adapter. */
export const biomeAdapter: FormatterAdapter = {
  name: "biome",
  priority: 30,

  async discover(directory) {
    return [
      ...await configFileEvidence("biome", directory, configNames),
      ...await packageEvidence("biome", directory, {
        packages: ["@biomejs/biome", "@biomejs/js-api"],
        commandPattern:
          /(?:^|[\s;&|])(?:npx\s+|pnpm\s+(?:exec\s+)?|yarn\s+|bunx\s+)?biome(?:\s|$)/,
      }),
    ];
  },

  async probe(context) {
    const implementation = resolveBiome(context);
    if (!implementation) {
      return {
        available: false,
        reason: "Could not resolve a project-local @biomejs/biome CLI",
      };
    }
    try {
      const version = await biomeVersion(implementation, context);
      return { available: true, implementation, version };
    } catch (cause) {
      return {
        available: false,
        implementation,
        reason: cause instanceof Error ? cause.message : String(cause),
      };
    }
  },

  async format(source, context) {
    const implementation = resolveBiome(context);
    if (!implementation) {
      throw new Error("Could not resolve a project-local @biomejs/biome CLI");
    }
    if (await isIgnored(context)) return { source, ignored: true };
    const result = await runCommand(
      implementation,
      ["format", "--stdin-file-path", context.filePath],
      { cwd: context.configRoot, input: source },
    );
    if (result.code !== 0 || result.signal) {
      const error = new Error(
        `Biome exited ${result.signal ?? result.code ?? "without a status"}`,
      ) as Error & { stderr?: string };
      error.stderr = result.stderr;
      throw error;
    }
    return {
      source: result.stdout || source,
      ignored: isIgnoredMessage(result.stderr),
      stderr: result.stderr || undefined,
    };
  },
};

function resolveBiome(context: AdapterContext): string | null {
  const shim = resolveProjectPackage(
    "@biomejs/biome/bin/biome",
    context.configRoot,
    context.projectRoot,
  );
  if (!shim) return null;
  const packageNames: Record<string, Partial<Record<string, string[]>>> = {
    darwin: {
      arm64: ["@biomejs/cli-darwin-arm64/biome"],
      x64: ["@biomejs/cli-darwin-x64/biome"],
    },
    linux: {
      arm64: [
        "@biomejs/cli-linux-arm64/biome",
        "@biomejs/cli-linux-arm64-musl/biome",
      ],
      x64: [
        "@biomejs/cli-linux-x64/biome",
        "@biomejs/cli-linux-x64-musl/biome",
      ],
    },
    win32: {
      arm64: ["@biomejs/cli-win32-arm64/biome.exe"],
      x64: ["@biomejs/cli-win32-x64/biome.exe"],
    },
  };
  for (const specifier of packageNames[platform]?.[arch] ?? []) {
    const resolved = resolveProjectPackage(
      specifier,
      dirname(shim),
      context.projectRoot,
    );
    if (resolved) return resolved;
  }
  return null;
}

async function biomeVersion(
  implementation: string,
  context: AdapterContext,
): Promise<string | undefined> {
  const result = await runCommand(implementation, ["--version"], {
    cwd: context.configRoot,
  });
  const match = result.stdout.match(/\d+\.\d+\.\d+(?:-[\w.-]+)?/);
  return match?.[0];
}

function isIgnoredMessage(stderr: string): boolean {
  return /(?:ignored|no files were processed)/i.test(stderr);
}

async function isIgnored(context: AdapterContext): Promise<boolean> {
  const configPath = context.evidence.find((item) =>
    item.formatter === "biome" && item.kind === "config"
  )?.path;
  if (!configPath) return false;
  const text = await readTextIfPresent(configPath);
  if (text === null) return false;
  const config = parseJsonc(text) as Record<string, unknown>;
  const files = record(config.files);
  const formatter = record(config.formatter);
  if (formatter.enabled === false) return true;
  const path = relative(dirname(configPath), context.filePath).split(sep).join(
    "/",
  );
  return !isIncluded(strings(files.includes), path) ||
    !isIncluded(strings(formatter.includes), path);
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object"
    ? value as Record<string, unknown>
    : {};
}

function strings(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}
