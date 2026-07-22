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
    const fileBehavior = await biomeFileBehavior(context);
    if (fileBehavior.ignored) return { source, ignored: true };
    if (!context.formatOnly && fileBehavior.formatterActive) {
      // Biome's stdin check --write currently succeeds silently on parse
      // errors. Validate in memory first, but let check process the original
      // source so its fix/format ordering remains authoritative.
      await runBiome(
        implementation,
        ["format", "--stdin-file-path", context.filePath],
        context,
        source,
      );
    }
    const args = context.formatOnly
      ? ["format", "--stdin-file-path", context.filePath]
      : [
        "check",
        "--write",
        ...fileBehavior.disabledChecks,
        "--stdin-file-path",
        context.filePath,
      ];
    const result = await runBiome(implementation, args, context, source);
    return {
      source: result.stdout || source,
      ignored: isIgnoredMessage(result.stderr),
      stderr: result.stderr || undefined,
    };
  },
};

async function runBiome(
  implementation: string,
  args: readonly string[],
  context: AdapterContext,
  input: string,
) {
  const result = await runCommand(implementation, args, {
    cwd: context.configRoot,
    input,
  });
  if (result.code !== 0 || result.signal) {
    const error = new Error(
      `Biome exited ${result.signal ?? result.code ?? "without a status"}`,
    ) as Error & { stderr?: string };
    error.stderr = result.stderr;
    throw error;
  }
  return result;
}

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

async function biomeFileBehavior(
  context: AdapterContext,
): Promise<{
  ignored: boolean;
  formatterActive: boolean;
  disabledChecks: string[];
}> {
  const configPath = context.evidence.find((item) =>
    item.formatter === "biome" && item.kind === "config"
  )?.path;
  if (!configPath) {
    return { ignored: false, formatterActive: true, disabledChecks: [] };
  }
  const text = await readTextIfPresent(configPath);
  if (text === null) {
    return { ignored: false, formatterActive: true, disabledChecks: [] };
  }
  const config = parseJsonc(text) as Record<string, unknown>;
  const files = record(config.files);
  const path = relative(dirname(configPath), context.filePath).split(sep).join(
    "/",
  );
  if (!isIncluded(strings(files.includes), path)) {
    return { ignored: true, formatterActive: false, disabledChecks: [] };
  }

  const tools = ["formatter", "linter", "assist"] as const;
  const active = Object.fromEntries(tools.map((tool) => {
    const options = record(config[tool]);
    return [
      tool,
      options.enabled !== false && isIncluded(strings(options.includes), path),
    ];
  })) as Record<(typeof tools)[number], boolean>;

  if (context.formatOnly) {
    return {
      ignored: !active.formatter,
      formatterActive: active.formatter,
      disabledChecks: [],
    };
  }
  if (!tools.some((tool) => active[tool])) {
    return { ignored: true, formatterActive: false, disabledChecks: [] };
  }
  return {
    ignored: false,
    formatterActive: active.formatter,
    disabledChecks: tools.flatMap((tool) =>
      active[tool] ? [] : [`--${tool}-enabled=false`]
    ),
  };
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
