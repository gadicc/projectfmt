import { dirname, extname, relative, sep } from "node:path";

import { parseJsonc, readTextIfPresent } from "../fs.ts";
import { denoConfigNames } from "../config-names.ts";
import { isExcluded, isIncluded } from "../glob.ts";
import { nearestExistingDirectory } from "../path.ts";
import { runCommand } from "../process.ts";
import type { FormatterAdapter } from "../types.ts";
import { configFileEvidence, packageEvidence } from "./discovery.ts";

type ExtensionDisposition = "canonical" | "alias" | "runtime-gated";

interface DenoExtensionSpec {
  extension: string;
  flag?: string;
  disposition: ExtensionDisposition;
}

/** @internal Complete compatibility table for virtual destination suffixes. */
export const denoExtensionTable: Readonly<Record<string, DenoExtensionSpec>> = {
  js: { extension: "js", disposition: "canonical" },
  cjs: { extension: "cjs", disposition: "canonical" },
  mjs: { extension: "mjs", disposition: "canonical" },
  ts: { extension: "ts", disposition: "canonical" },
  cts: { extension: "cts", disposition: "canonical" },
  mts: { extension: "mts", disposition: "canonical" },
  jsx: { extension: "jsx", disposition: "canonical" },
  tsx: { extension: "tsx", disposition: "canonical" },
  md: { extension: "md", disposition: "canonical" },
  mkd: { extension: "md", disposition: "alias" },
  mkdn: { extension: "md", disposition: "alias" },
  mdwn: { extension: "md", disposition: "alias" },
  mdown: { extension: "md", disposition: "alias" },
  markdown: { extension: "md", disposition: "alias" },
  json: { extension: "json", disposition: "canonical" },
  jsonc: { extension: "jsonc", disposition: "canonical" },
  css: {
    extension: "css",
    flag: "--unstable-css",
    disposition: "canonical",
  },
  html: {
    extension: "html",
    flag: "--unstable-html",
    disposition: "canonical",
  },
  xml: { extension: "xml", disposition: "runtime-gated" },
  svg: { extension: "svg", disposition: "runtime-gated" },
  njk: { extension: "njk", disposition: "canonical" },
  vto: { extension: "vto", disposition: "canonical" },
  yml: {
    extension: "yml",
    flag: "--unstable-yaml",
    disposition: "canonical",
  },
  yaml: {
    extension: "yaml",
    flag: "--unstable-yaml",
    disposition: "canonical",
  },
  scss: {
    extension: "scss",
    flag: "--unstable-css",
    disposition: "canonical",
  },
  less: {
    extension: "less",
    flag: "--unstable-css",
    disposition: "canonical",
  },
  ipynb: { extension: "ipynb", disposition: "canonical" },
  astro: {
    extension: "astro",
    flag: "--unstable-component",
    disposition: "canonical",
  },
  svelte: {
    extension: "svelte",
    flag: "--unstable-component",
    disposition: "canonical",
  },
  vue: {
    extension: "vue",
    flag: "--unstable-component",
    disposition: "canonical",
  },
  sql: {
    extension: "sql",
    flag: "--unstable-sql",
    disposition: "canonical",
  },
};

export interface DenoFormatInvocation {
  extension: string;
  flags: readonly string[];
}

class DenoHelpParseError extends Error {}

/** Built-in Deno fmt CLI adapter. */
export const denoAdapter: FormatterAdapter = {
  name: "deno",
  priority: 20,

  async discover(directory) {
    const configs = await configFileEvidence(
      "deno",
      directory,
      denoConfigNames,
    );
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
    const suffix = extname(context.filePath).slice(1).toLowerCase();
    const configPath = context.configPath;
    if (configPath && await isIgnored(context.filePath, configPath)) {
      return { source, ignored: true };
    }
    const cwd = await nearestExistingDirectory(
      dirname(context.filePath),
      context.projectRoot,
    );
    const invocation = await resolveDenoFormatInvocation(suffix, cwd);
    const args = [
      "fmt",
      "--ext",
      invocation.extension,
      ...invocation.flags,
      "--no-editorconfig",
    ];
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

/** @internal Build a Deno fmt invocation from runtime-advertised capabilities. */
export function denoFormatInvocationFromHelp(
  suffix: string,
  help: string,
): DenoFormatInvocation {
  const spec = denoExtensionTable[suffix.toLowerCase()];
  if (!spec) throw unsupportedExtension(suffix);
  const match = help.match(
    /--ext\s+<[^>]+>[^[]*\[possible values:\s*([^\]]+)\]/,
  );
  if (!match) {
    throw new DenoHelpParseError(
      "Could not parse advertised --ext values from deno fmt --help",
    );
  }
  const extensions = new Set(
    match[1].split(",").map((value) => value.trim()).filter(Boolean),
  );
  if (!extensions.has(spec.extension)) throw unsupportedExtension(suffix);
  return {
    extension: spec.extension,
    flags: spec.flag && help.includes(spec.flag) ? [spec.flag] : [],
  };
}

async function resolveDenoFormatInvocation(
  suffix: string,
  cwd: string,
): Promise<DenoFormatInvocation> {
  if (!denoExtensionTable[suffix]) throw unsupportedExtension(suffix);
  const help = await runCommand("deno", ["fmt", "--help"], { cwd });
  if (help.code !== 0 || help.signal) {
    throw await denoHelpError(
      cwd,
      `deno fmt --help exited ${
        help.signal ?? help.code ?? "without a status"
      }`,
      help.stderr || help.stdout,
    );
  }
  try {
    return denoFormatInvocationFromHelp(suffix, help.stdout);
  } catch (cause) {
    if (!(cause instanceof DenoHelpParseError)) throw cause;
    throw await denoHelpError(
      cwd,
      cause.message,
      help.stderr || help.stdout,
    );
  }
}

async function denoHelpError(
  cwd: string,
  message: string,
  diagnostic: string,
): Promise<Error> {
  const version = await runCommand("deno", ["--version"], { cwd });
  const label = version.stdout.trim().split("\n")[0] ||
    version.stderr.trim() || "unknown Deno version";
  const error = new Error(`${message} (${label})`) as Error & {
    stderr?: string;
  };
  error.stderr = diagnostic;
  return error;
}

function unsupportedExtension(suffix: string): Error {
  return new Error(
    `Deno fmt does not support the intended .${suffix || "(none)"} file type`,
  );
}

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
  const exclude = [
    ...stringArray(config.exclude),
    ...stringArray(fmt.exclude),
  ];
  return (include.length > 0 && !isIncluded(include, path)) ||
    isExcluded(exclude, path);
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
