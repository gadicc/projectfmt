import { dirname, join } from "node:path";
import { stat } from "node:fs/promises";
import { pathToFileURL } from "node:url";

import { resolveProjectPackage } from "../package.ts";
import type {
  AdapterContext,
  AdapterFormatResult,
  FormatterAdapter,
} from "../types.ts";
import { configFileEvidence, packageEvidence } from "./discovery.ts";

const configNames = [
  ".prettierrc",
  ".prettierrc.json",
  ".prettierrc.json5",
  ".prettierrc.yaml",
  ".prettierrc.yml",
  ".prettierrc.js",
  ".prettierrc.cjs",
  ".prettierrc.mjs",
  ".prettierrc.ts",
  ".prettierrc.cts",
  ".prettierrc.mts",
  "prettier.config.js",
  "prettier.config.cjs",
  "prettier.config.mjs",
  "prettier.config.ts",
  "prettier.config.cts",
  "prettier.config.mts",
] as const;

interface PrettierModule {
  version?: string;
  format(source: string, options: Record<string, unknown>): Promise<string>;
  resolveConfig(
    path: string,
    options?: Record<string, unknown>,
  ): Promise<Record<string, unknown> | null>;
  getFileInfo(
    path: string,
    options?: Record<string, unknown>,
  ): Promise<{ ignored: boolean; inferredParser: string | null }>;
}

/** Built-in project-local Prettier API adapter. */
export const prettierAdapter: FormatterAdapter = {
  name: "prettier",
  priority: 10,

  async discover(directory) {
    return [
      ...await configFileEvidence("prettier", directory, configNames),
      ...await packageEvidence("prettier", directory, {
        packageKey: "prettier",
        packages: ["prettier"],
        commandPattern:
          /(?:^|[\s;&|])(?:npx\s+|pnpm\s+(?:exec\s+)?|yarn\s+|bunx\s+)?prettier(?:\s|$)/,
      }),
    ];
  },

  async probe(context) {
    const implementation = resolvePrettier(context);
    if (!implementation) {
      return {
        available: false,
        reason: "Could not resolve a project-local prettier package",
      };
    }
    try {
      const prettier = await importPrettier(implementation);
      return {
        available: true,
        implementation,
        version: prettier.version,
      };
    } catch (cause) {
      return {
        available: false,
        implementation,
        reason: `Failed to load Prettier: ${errorMessage(cause)}`,
      };
    }
  },

  async format(source, context): Promise<AdapterFormatResult> {
    const implementation = resolvePrettier(context);
    if (!implementation) {
      throw new Error("Could not resolve a project-local prettier package");
    }
    const prettier = await importPrettier(implementation);
    const config = context.configPath
      ? await prettier.resolveConfig(context.filePath, {
        config: context.configPath,
        editorconfig: false,
        useCache: false,
      }) ?? {}
      : {};
    const ignorePath = await ignorePaths(context);
    const fileInfo = await prettier.getFileInfo(context.filePath, {
      ignorePath,
      plugins: config.plugins,
      resolveConfig: false,
      withNodeModules: false,
    });
    if (fileInfo.ignored) return { source, ignored: true };
    return {
      source: await prettier.format(source, {
        ...config,
        filepath: context.filePath,
      }),
    };
  },
};

function resolvePrettier(context: AdapterContext): string | null {
  return resolveProjectPackage(
    "prettier/index.mjs",
    context.configRoot,
    context.projectRoot,
  ) ?? resolveProjectPackage(
    "prettier",
    context.configRoot,
    context.projectRoot,
  );
}

async function importPrettier(path: string): Promise<PrettierModule> {
  return await import(pathToFileURL(path).href) as PrettierModule;
}

async function ignorePaths(context: AdapterContext): Promise<string[]> {
  const paths: string[] = [];
  let directory = dirname(context.filePath);
  while (true) {
    for (const name of [".prettierignore", ".gitignore"]) {
      const path = join(directory, name);
      if (await readJsonOrText(path)) paths.push(path);
    }
    if (directory === context.projectRoot) break;
    const parent = dirname(directory);
    if (parent === directory) break;
    directory = parent;
  }
  return paths;
}

async function readJsonOrText(path: string): Promise<boolean> {
  // This deliberately avoids parsing: getFileInfo owns ignore syntax.
  try {
    return (await stat(path)).isFile();
  } catch {
    return false;
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
