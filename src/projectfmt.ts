import { isAbsolute, relative, sep } from "node:path";

import { builtinAdapters } from "./adapters/index.ts";
import { FormatterExecutionError, FormatterResolutionError } from "./errors.ts";
import { ancestorDirectories, normalizePaths } from "./path.ts";
import type {
  AdapterAvailability,
  AdapterContext,
  AdapterFormatResult,
  DiscoveryEvidence,
  EvidenceKind,
  FormatSourceOptions,
  FormatSourceResult,
  FormatterAdapter,
  FormatterCandidate,
  FormatterResolution,
  FormatterSelection,
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
  const options = normalizeOptions(input);
  const { projectRoot, filePath } = await normalizePaths(
    options.filePath,
    options.projectRoot,
  );
  const requested = options.formatter ?? "auto";
  const adapters = adapterMap(
    options.adapters ?? [],
    filePath,
    projectRoot,
  );
  if (requested === "none") {
    return {
      status: "disabled",
      formatter: null,
      requested,
      projectRoot,
      filePath,
      configRoot: null,
      reason: "Formatting was explicitly disabled",
      evidence: [],
      candidates: [],
      ambiguous: false,
    };
  }

  const discovered = await discover(adapters, filePath, projectRoot);
  const evidence = discovered.map((item) => item.evidence);
  const candidates = buildCandidates(discovered, adapters);

  if (requested !== "auto") {
    const adapter = adapters.get(requested);
    if (!adapter) {
      throw new FormatterResolutionError(
        `Unknown formatter ${JSON.stringify(requested)}. Available adapters: ${
          [...adapters.keys()].join(", ")
        }`,
        {
          code: "INVALID_OPTIONS",
          formatter: requested,
          filePath,
          projectRoot,
        },
      );
    }
    const candidate = candidates.find((item) => item.formatter === requested);
    const configRoot = candidate?.configRoot ?? projectRoot;
    return await finalize({
      adapter,
      requested,
      projectRoot,
      filePath,
      configRoot,
      evidence,
      candidates,
      ambiguous: false,
      formatOnly: options.formatOnly,
      reason: `Formatter ${JSON.stringify(requested)} was explicitly selected`,
    });
  }

  if (candidates.length === 0) {
    const resolution: FormatterResolution = {
      status: "not-configured",
      formatter: null,
      requested,
      projectRoot,
      filePath,
      configRoot: null,
      reason:
        "No supported formatter configuration was found within projectRoot",
      evidence,
      candidates,
      ambiguous: false,
    };
    if (options.strict) {
      throw new FormatterResolutionError(resolution.reason, {
        code: "FORMATTER_NOT_CONFIGURED",
        filePath,
        projectRoot,
        evidence,
        resolution,
      });
    }
    return resolution;
  }

  const nearestDistance = Math.min(
    ...candidates.map((candidate) => candidate.evidence[0].distance),
  );
  const nearest = candidates.filter((candidate) =>
    candidate.evidence[0].distance === nearestDistance
  );
  const strongest = Math.max(
    ...nearest.map((candidate) => candidate.bestStrength),
  );
  const finalists = nearest.filter((candidate) =>
    candidate.bestStrength === strongest
  ).sort((left, right) =>
    right.priority - left.priority ||
    left.formatter.localeCompare(right.formatter)
  );
  const selected = finalists[0];
  const ambiguous = finalists.length > 1;
  const reason = ambiguous
    ? `Equal-ranked formatter evidence found; selected ${selected.formatter} by documented precedence (${
      finalists.map((item) => item.formatter).join(" > ")
    })`
    : `Selected ${selected.formatter} from the nearest strongest project evidence`;
  if (ambiguous && options.strict) {
    const resolution = baseResolution({
      status: "selected",
      formatter: selected.formatter,
      requested,
      projectRoot,
      filePath,
      configRoot: selected.configRoot,
      reason,
      evidence,
      candidates,
      ambiguous,
    });
    throw new FormatterResolutionError(reason, {
      code: "AMBIGUOUS_FORMATTER",
      formatter: selected.formatter,
      filePath,
      projectRoot,
      evidence,
      resolution,
    });
  }

  return await finalize({
    adapter: adapters.get(selected.formatter)!,
    requested,
    projectRoot,
    filePath,
    configRoot: selected.configRoot,
    evidence,
    candidates,
    ambiguous,
    formatOnly: options.formatOnly,
    reason,
  });
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
  return (await formatSourceWithResult(source, normalizeOptions(input))).source;
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
  const options = normalizeOptions(input);
  const resolution = await resolveFormatter(options);
  if (
    resolution.status === "disabled" ||
    resolution.status === "not-configured"
  ) {
    return { source, changed: false, ignored: false, resolution };
  }
  if (resolution.status === "unavailable") {
    throw new FormatterResolutionError(
      `Selected formatter ${resolution.formatter} is unavailable: ${
        resolution.availability?.reason ?? "unknown reason"
      }`,
      {
        code: "FORMATTER_UNAVAILABLE",
        formatter: resolution.formatter,
        filePath: resolution.filePath,
        projectRoot: resolution.projectRoot,
        evidence: resolution.evidence,
        resolution,
      },
    );
  }

  const adapters = adapterMap(
    options.adapters ?? [],
    resolution.filePath,
    resolution.projectRoot,
  );
  const adapter = adapters.get(resolution.formatter!);
  if (!adapter) {
    throw new FormatterResolutionError(
      `Resolved adapter ${resolution.formatter} is no longer available`,
      {
        code: "FORMATTER_UNAVAILABLE",
        formatter: resolution.formatter,
        filePath: resolution.filePath,
        projectRoot: resolution.projectRoot,
        evidence: resolution.evidence,
        resolution,
      },
    );
  }
  const context = adapterContext(resolution, options);
  try {
    const formatted = validateFormatResult(
      await adapter.format(source, context) as unknown,
      adapter.name,
    );
    return {
      source: formatted.source,
      changed: formatted.source !== source,
      ignored: formatted.ignored ?? false,
      resolution,
    };
  } catch (cause) {
    const stderr = cause instanceof Error && "stderr" in cause &&
        typeof (cause as Error & { stderr?: unknown }).stderr === "string"
      ? (cause as Error & { stderr: string }).stderr
      : undefined;
    throw new FormatterExecutionError(
      `Failed to format ${resolution.filePath} with ${resolution.formatter}: ${
        cause instanceof Error ? cause.message : String(cause)
      }`,
      {
        code: "FORMATTER_FAILED",
        formatter: resolution.formatter,
        filePath: resolution.filePath,
        projectRoot: resolution.projectRoot,
        evidence: resolution.evidence,
        stderr,
        resolution,
        cause,
      },
    );
  }
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

function adapterMap(
  customAdapters: readonly FormatterAdapter[],
  filePath: string,
  projectRoot: string,
): Map<string, FormatterAdapter> {
  if (!Array.isArray(customAdapters)) {
    throw invalidAdapterOptions(
      "Custom adapters must be an array",
      undefined,
      filePath,
      projectRoot,
    );
  }
  const map = new Map<string, FormatterAdapter>();
  const definitions: readonly unknown[] = [
    ...builtinAdapters,
    ...customAdapters,
  ];
  for (const value of definitions) {
    if (value === null || typeof value !== "object" || Array.isArray(value)) {
      throw invalidAdapterOptions(
        "Formatter adapters must be objects",
        undefined,
        filePath,
        projectRoot,
      );
    }
    const adapter = value as Partial<FormatterAdapter>;
    const formatter = typeof adapter.name === "string"
      ? adapter.name
      : undefined;
    if (!formatter || formatter.trim().length === 0 || map.has(formatter)) {
      throw invalidAdapterOptions(
        `Formatter adapter names must be non-empty and unique: ${
          String(adapter.name)
        }`,
        formatter,
        filePath,
        projectRoot,
      );
    }
    if (
      adapter.priority !== undefined &&
      (typeof adapter.priority !== "number" ||
        !Number.isFinite(adapter.priority))
    ) {
      throw invalidAdapterOptions(
        `Formatter adapter ${formatter} priority must be a finite number`,
        formatter,
        filePath,
        projectRoot,
      );
    }
    for (const method of ["discover", "probe", "format"] as const) {
      if (typeof adapter[method] !== "function") {
        throw invalidAdapterOptions(
          `Formatter adapter ${formatter} must define a ${method} method`,
          formatter,
          filePath,
          projectRoot,
        );
      }
    }
    map.set(formatter, adapter as FormatterAdapter);
  }
  return map;
}

interface LocatedEvidence {
  directory: string;
  evidence: DiscoveryEvidence;
}

async function discover(
  adapters: ReadonlyMap<string, FormatterAdapter>,
  filePath: string,
  projectRoot: string,
): Promise<LocatedEvidence[]> {
  const all: LocatedEvidence[] = [];
  const directories = ancestorDirectories(filePath, projectRoot);
  for (let distance = 0; distance < directories.length; distance++) {
    const directory = directories[distance];
    const found = await Promise.all(
      [...adapters.values()].map(async (adapter) => {
        let items: unknown;
        try {
          items = await adapter.discover(directory, { filePath, projectRoot });
        } catch (cause) {
          throw new FormatterResolutionError(
            `Failed to inspect ${directory} for ${adapter.name}: ${
              cause instanceof Error ? cause.message : String(cause)
            }`,
            {
              code: "INVALID_OPTIONS",
              formatter: adapter.name,
              filePath,
              projectRoot,
              evidence: all.map((item) => item.evidence),
              cause,
            },
          );
        }
        return validateDiscovery(
          items,
          adapter.name,
          filePath,
          projectRoot,
          all.map((item) => item.evidence),
        );
      }),
    );
    for (const items of found) {
      for (const item of items) {
        all.push({
          directory,
          evidence: { ...item, distance },
        });
      }
    }
  }
  return all;
}

function buildCandidates(
  evidence: readonly LocatedEvidence[],
  adapters: ReadonlyMap<string, FormatterAdapter>,
): FormatterCandidate[] {
  const byDirectoryAndFormatter = new Map<string, DiscoveryEvidence[]>();
  for (const located of evidence) {
    const item = located.evidence;
    const key = `${located.directory}\0${item.formatter}`;
    const items = byDirectoryAndFormatter.get(key) ?? [];
    items.push(item);
    byDirectoryAndFormatter.set(key, items);
  }
  return [...byDirectoryAndFormatter.entries()].map(([key, items]) => {
    const formatter = items[0].formatter;
    return {
      formatter,
      configRoot: key.slice(0, key.indexOf("\0")),
      evidence: items.sort((left, right) => right.strength - left.strength),
      bestStrength: Math.max(...items.map((item) => item.strength)),
      priority: adapters.get(formatter)?.priority ?? 0,
    };
  }).sort((left, right) =>
    left.evidence[0].distance - right.evidence[0].distance ||
    right.bestStrength - left.bestStrength ||
    right.priority - left.priority ||
    left.formatter.localeCompare(right.formatter)
  );
}

async function finalize(options: {
  adapter: FormatterAdapter;
  requested: FormatterSelection;
  projectRoot: string;
  filePath: string;
  configRoot: string;
  reason: string;
  evidence: readonly DiscoveryEvidence[];
  candidates: readonly FormatterCandidate[];
  ambiguous: boolean;
  formatOnly?: boolean;
}): Promise<FormatterResolution> {
  const context: AdapterContext = {
    filePath: options.filePath,
    projectRoot: options.projectRoot,
    configRoot: options.configRoot,
    configPath: selectedConfigPath(
      options.adapter.name,
      options.configRoot,
      options.candidates,
    ),
    evidence: options.evidence,
    formatOnly: options.formatOnly,
  };
  let result: unknown;
  try {
    result = await options.adapter.probe(context);
  } catch (cause) {
    throw new FormatterResolutionError(
      `Failed to probe formatter ${options.adapter.name}: ${
        errorMessage(cause)
      }`,
      {
        code: "FORMATTER_UNAVAILABLE",
        formatter: options.adapter.name,
        filePath: options.filePath,
        projectRoot: options.projectRoot,
        evidence: options.evidence,
        stderr: stderrFrom(cause),
        cause,
      },
    );
  }
  const availability = validateAvailability(
    result,
    options.adapter.name,
    options.filePath,
    options.projectRoot,
    options.evidence,
  );
  return baseResolution({
    status: availability.available ? "selected" : "unavailable",
    formatter: options.adapter.name,
    requested: options.requested,
    projectRoot: options.projectRoot,
    filePath: options.filePath,
    configRoot: options.configRoot,
    reason: availability.available
      ? options.reason
      : `${options.reason}; implementation unavailable: ${availability.reason}`,
    evidence: options.evidence,
    candidates: options.candidates,
    ambiguous: options.ambiguous,
    availability,
  });
}

function baseResolution(
  resolution: FormatterResolution,
): FormatterResolution {
  return resolution;
}

function adapterContext(
  resolution: FormatterResolution,
  options: FormatSourceOptions,
): AdapterContext {
  return {
    filePath: resolution.filePath,
    projectRoot: resolution.projectRoot,
    configRoot: resolution.configRoot!,
    configPath: selectedConfigPath(
      resolution.formatter!,
      resolution.configRoot!,
      resolution.candidates,
    ),
    evidence: resolution.evidence,
    formatOnly: options.formatOnly,
  };
}

function selectedConfigPath(
  formatter: string,
  configRoot: string,
  candidates: readonly FormatterCandidate[],
): string | undefined {
  return candidates.find((candidate) =>
    candidate.formatter === formatter && candidate.configRoot === configRoot
  )?.evidence.find((item) => (item.kind === "config" ||
    (formatter === "prettier" && item.kind === "package-key"))
  )?.path;
}

const evidenceKinds = new Set<EvidenceKind>([
  "config",
  "package-key",
  "script",
  "dependency",
  "custom",
]);

function validateDiscovery(
  value: unknown,
  formatter: string,
  filePath: string,
  projectRoot: string,
  evidence: readonly DiscoveryEvidence[],
): Omit<DiscoveryEvidence, "distance">[] {
  if (!Array.isArray(value)) {
    throw invalidAdapterOptions(
      `Formatter adapter ${formatter} discover must return an array`,
      formatter,
      filePath,
      projectRoot,
      evidence,
    );
  }
  return value.map((raw, index) => {
    const label = `Formatter adapter ${formatter} evidence ${index}`;
    if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
      throw invalidAdapterOptions(
        `${label} must be an object`,
        formatter,
        filePath,
        projectRoot,
        evidence,
      );
    }
    const item = raw as Record<string, unknown>;
    if (item.formatter !== formatter) {
      throw invalidAdapterOptions(
        `${label} formatter must equal ${formatter}`,
        formatter,
        filePath,
        projectRoot,
        evidence,
      );
    }
    if (!evidenceKinds.has(item.kind as EvidenceKind)) {
      throw invalidAdapterOptions(
        `${label} kind is invalid`,
        formatter,
        filePath,
        projectRoot,
        evidence,
      );
    }
    if (
      typeof item.path !== "string" || !isAbsolute(item.path) ||
      !isWithin(projectRoot, item.path)
    ) {
      throw invalidAdapterOptions(
        `${label} path must be absolute and within projectRoot`,
        formatter,
        filePath,
        projectRoot,
        evidence,
      );
    }
    if (
      typeof item.description !== "string" ||
      item.description.trim().length === 0
    ) {
      throw invalidAdapterOptions(
        `${label} description must be non-empty`,
        formatter,
        filePath,
        projectRoot,
        evidence,
      );
    }
    if (typeof item.strength !== "number" || !Number.isFinite(item.strength)) {
      throw invalidAdapterOptions(
        `${label} strength must be finite`,
        formatter,
        filePath,
        projectRoot,
        evidence,
      );
    }
    return {
      formatter,
      kind: item.kind as EvidenceKind,
      path: item.path,
      description: item.description,
      strength: item.strength,
    };
  });
}

function validateAvailability(
  value: unknown,
  formatter: string,
  filePath: string,
  projectRoot: string,
  evidence: readonly DiscoveryEvidence[],
): AdapterAvailability {
  const label = `Formatter adapter ${formatter} probe result`;
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw invalidAdapterOptions(
      `${label} must be an object`,
      formatter,
      filePath,
      projectRoot,
      evidence,
    );
  }
  const result = value as Record<string, unknown>;
  if (typeof result.available !== "boolean") {
    throw invalidAdapterOptions(
      `${label}.available must be boolean`,
      formatter,
      filePath,
      projectRoot,
      evidence,
    );
  }
  for (const property of ["implementation", "version", "reason"] as const) {
    if (
      result[property] !== undefined && typeof result[property] !== "string"
    ) {
      throw invalidAdapterOptions(
        `${label}.${property} must be a string when present`,
        formatter,
        filePath,
        projectRoot,
        evidence,
      );
    }
  }
  return {
    available: result.available,
    implementation: result.implementation as string | undefined,
    version: result.version as string | undefined,
    reason: result.reason as string | undefined,
  };
}

function validateFormatResult(
  value: unknown,
  formatter: string,
): AdapterFormatResult {
  const label = `Formatter adapter ${formatter} format result`;
  const stderr = value !== null && typeof value === "object" &&
      !Array.isArray(value) &&
      typeof (value as Record<string, unknown>).stderr === "string"
    ? (value as Record<string, string>).stderr
    : undefined;
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw lifecycleTypeError(`${label} must be an object`, stderr);
  }
  const result = value as Record<string, unknown>;
  if (typeof result.source !== "string") {
    throw lifecycleTypeError(`${label}.source must be a string`, stderr);
  }
  if (result.ignored !== undefined && typeof result.ignored !== "boolean") {
    throw lifecycleTypeError(
      `${label}.ignored must be boolean when present`,
      stderr,
    );
  }
  if (result.stderr !== undefined && typeof result.stderr !== "string") {
    throw lifecycleTypeError(`${label}.stderr must be a string when present`);
  }
  return {
    source: result.source,
    ignored: result.ignored as boolean | undefined,
    stderr: result.stderr as string | undefined,
  };
}

function invalidAdapterOptions(
  message: string,
  formatter: string | undefined,
  filePath: string,
  projectRoot: string,
  evidence: readonly DiscoveryEvidence[] = [],
): FormatterResolutionError {
  return new FormatterResolutionError(message, {
    code: "INVALID_OPTIONS",
    formatter,
    filePath,
    projectRoot,
    evidence,
    cause: new TypeError(message),
  });
}

function lifecycleTypeError(message: string, stderr?: string): TypeError {
  const error = new TypeError(message) as TypeError & { stderr?: string };
  error.stderr = stderr;
  return error;
}

function isWithin(projectRoot: string, path: string): boolean {
  const fromRoot = relative(projectRoot, path);
  return fromRoot !== ".." && !fromRoot.startsWith(`..${sep}`) &&
    !isAbsolute(fromRoot);
}

function stderrFrom(cause: unknown): string | undefined {
  return cause instanceof Error && "stderr" in cause &&
      typeof (cause as Error & { stderr?: unknown }).stderr === "string"
    ? (cause as Error & { stderr: string }).stderr
    : undefined;
}

function errorMessage(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}
