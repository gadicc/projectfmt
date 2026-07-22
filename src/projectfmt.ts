import { FormatterResolutionError } from "./errors.ts";
import { formatOperation, resolveOperation } from "./operation.ts";
import type {
  FormatSourceOptions,
  FormatSourceResult,
  FormatterResolution,
} from "./types.ts";

/** Discover and probe the formatter from an absolute intended path. */
export function resolveFormatter(
  filePath: string,
): Promise<FormatterResolution>;
/** Discover and probe the formatter with explicit resolution options. */
export function resolveFormatter(
  options: FormatSourceOptions,
): Promise<FormatterResolution>;
export async function resolveFormatter(
  input: FormatSourceOptions | string,
): Promise<FormatterResolution> {
  return (await resolveOperation(normalizeOptions(input))).resolution;
}

/** Format source using project context inferred from an absolute intended path. */
export function formatSource(
  source: string,
  filePath: string,
): Promise<string>;
/** Format source with explicit resolution and processing options. */
export function formatSource(
  source: string,
  options: FormatSourceOptions,
): Promise<string>;
export async function formatSource(
  source: string,
  input: FormatSourceOptions | string,
): Promise<string> {
  return (await formatOperation(source, normalizeOptions(input))).source;
}

/** Format source from an absolute path and return full diagnostics. */
export function formatSourceWithResult(
  source: string,
  filePath: string,
): Promise<FormatSourceResult>;
/** Format source with explicit options and return full diagnostics. */
export function formatSourceWithResult(
  source: string,
  options: FormatSourceOptions,
): Promise<FormatSourceResult>;
export async function formatSourceWithResult(
  source: string,
  input: FormatSourceOptions | string,
): Promise<FormatSourceResult> {
  if (typeof source !== "string") {
    throw new FormatterResolutionError("source must be a string", {
      code: "INVALID_OPTIONS",
    });
  }
  return await formatOperation(source, normalizeOptions(input));
}

function normalizeOptions(
  input: FormatSourceOptions | string,
): FormatSourceOptions {
  if (typeof input === "string") return { filePath: input };
  if (!input || typeof input !== "object") {
    throw new FormatterResolutionError(
      "options must be an absolute file path string or an options object",
      { code: "INVALID_OPTIONS" },
    );
  }
  return input;
}
