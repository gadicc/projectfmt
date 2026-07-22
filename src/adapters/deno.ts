import { dirname, extname, relative, sep } from "node:path";

import { parseJsonc, readTextIfPresent } from "../fs.ts";
import { matchesGlob } from "../glob.ts";
import { nearestExistingDirectory } from "../path.ts";
import { runCommand } from "../process.ts";
import type { FormatterAdapter } from "../types.ts";
import { configFileEvidence, packageEvidence } from "./discovery.ts";

const configNames = ["deno.json", "deno.jsonc"] as const;
const supportedExtensions = new Set([
  "js",
  "cjs",
  "mjs",
  "ts",
  "cts",
  "mts",
  "jsx",
  "tsx",
  "md",
  "mkd",
  "mkdn",
  "mdwn",
  "mdown",
  "markdown",
  "json",
  "jsonc",
  "css",
  "html",
  "xml",
  "svg",
  "njk",
  "vto",
  "yml",
  "yaml",
  "scss",
  "less",
  "ipynb",
  "astro",
  "svelte",
  "vue",
  "sql",
]);

/** Built-in Deno fmt CLI adapter. */
export const denoAdapter: FormatterAdapter = {
  name: "deno",
  priority: 20,

  async discover(directory) {
    const configs = await configFileEvidence("deno", directory, configNames);
    const configured: typeof configs = [];
    for (const evidence of configs) {
      const text = await readTextIfPresent(evidence.path);
      try {
        const config = text === null
          ? {}
          : parseJsonc(text) as Record<string, unknown>;
        if ("fmt" in config) {
          configured.push(evidence);
        } else if (hasDenoFmtTask(config.tasks)) {
          configured.push({
            ...evidence,
            kind: "script",
            description: `deno.json task invokes deno fmt`,
            strength: 20,
          });
        }
      } catch {
        // Invalid configuration is still meaningful evidence and Deno will
        // later return the authoritative diagnostic.
        configured.push(evidence);
      }
    }
    return [
      ...configured,
      ...await packageEvidence("deno", directory, {
        packages: [],
        commandPattern: /(?:^|[\s;&|])deno\s+fmt(?:\s|$)/,
      }),
    ];
  },

  async probe(context) {
    try {
      const result = await runCommand("deno", ["--version"], {
        cwd: context.configRoot,
      });
      if (result.code !== 0 || result.signal) {
        return {
          available: false,
          reason: result.stderr.trim() || "deno --version failed",
        };
      }
      return {
        available: true,
        implementation: "deno",
        version: result.stdout.match(/deno\s+(\S+)/)?.[1],
      };
    } catch (cause) {
      return {
        available: false,
        reason: cause instanceof Error ? cause.message : String(cause),
      };
    }
  },

  async format(source, context) {
    const extension = extname(context.filePath).slice(1).toLowerCase();
    if (!supportedExtensions.has(extension)) {
      throw new Error(
        `Deno fmt does not support the intended .${
          extension || "(none)"
        } file type`,
      );
    }
    const configPath = context.configPath;
    if (configPath && await isIgnored(context.filePath, configPath)) {
      return { source, ignored: true };
    }
    const cwd = await nearestExistingDirectory(
      dirname(context.filePath),
      context.projectRoot,
    );
    const args = ["fmt", "--ext", extension, "--no-editorconfig"];
    if (configPath) args.push("--config", configPath);
    else args.push("--no-config");
    args.push("-");
    const result = await runCommand("deno", args, { cwd, input: source });
    if (result.code !== 0 || result.signal) {
      const error = new Error(
        `Deno fmt exited ${result.signal ?? result.code ?? "without a status"}`,
      ) as Error & { stderr?: string };
      error.stderr = result.stderr;
      throw error;
    }
    return { source: result.stdout, stderr: result.stderr || undefined };
  },
};

async function isIgnored(
  filePath: string,
  configPath: string,
): Promise<boolean> {
  const text = await readTextIfPresent(configPath);
  if (text === null) return false;
  const config = parseJsonc(text) as Record<string, unknown>;
  const fmt = config.fmt && typeof config.fmt === "object"
    ? config.fmt as Record<string, unknown>
    : {};
  const path = relative(dirname(configPath), filePath).split(sep).join("/");
  const include = stringArray(fmt.include);
  const exclude = stringArray(fmt.exclude);
  if (
    include.length > 0 &&
    !include.some((pattern) => matchesGlob(pattern, path))
  ) {
    return true;
  }
  return exclude.some((pattern) => matchesGlob(pattern, path));
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

function hasDenoFmtTask(value: unknown): boolean {
  if (!value || typeof value !== "object") return false;
  return Object.values(value).some((task) =>
    typeof task === "string" && /(?:^|[\s;&|])deno\s+fmt(?:\s|$)/.test(task)
  );
}
