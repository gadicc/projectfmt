import { dirname } from "node:path";

import { builtinAdapters } from "./adapters/index.ts";
import { FormatterExecutionError, FormatterResolutionError } from "./errors.ts";
import { ancestorDirectories, normalizePaths } from "./path.ts";
import type {
  AdapterContext,
  DiscoveryEvidence,
  FormatSourceOptions,
  FormatSourceResult,
  FormatterAdapter,
  FormatterCandidate,
  FormatterResolution,
  FormatterSelection,
} from "./types.ts";

/** Discover and probe the formatter for an intended destination path. */
export async function resolveFormatter(
  options: FormatSourceOptions,
): Promise<FormatterResolution> {
  const { projectRoot, filePath } = await normalizePaths(
    options.filePath,
    options.projectRoot,
  );
  const requested = options.formatter ?? "auto";
  const adapters = adapterMap(options.adapters ?? []);
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

  const evidence = await discover(adapters, filePath, projectRoot);
  const candidates = buildCandidates(evidence, adapters);

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
    reason,
  });
}

/** Format source according to the intended destination project's conventions. */
export async function formatSource(
  source: string,
  options: FormatSourceOptions,
): Promise<string> {
  return (await formatSourceWithResult(source, options)).source;
}

/** Format source and return change, ignore, and resolution diagnostics. */
export async function formatSourceWithResult(
  source: string,
  options: FormatSourceOptions,
): Promise<FormatSourceResult> {
  if (typeof source !== "string") {
    throw new FormatterResolutionError("source must be a string", {
      code: "INVALID_OPTIONS",
    });
  }
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

  const adapters = adapterMap(options.adapters ?? []);
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
    const formatted = await adapter.format(source, context);
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

function adapterMap(
  customAdapters: readonly FormatterAdapter[],
): Map<string, FormatterAdapter> {
  const map = new Map<string, FormatterAdapter>();
  for (const adapter of [...builtinAdapters, ...customAdapters]) {
    if (!adapter.name || map.has(adapter.name)) {
      throw new FormatterResolutionError(
        `Formatter adapter names must be non-empty and unique: ${adapter.name}`,
        { code: "INVALID_OPTIONS", formatter: adapter.name },
      );
    }
    map.set(adapter.name, adapter);
  }
  return map;
}

async function discover(
  adapters: ReadonlyMap<string, FormatterAdapter>,
  filePath: string,
  projectRoot: string,
): Promise<DiscoveryEvidence[]> {
  const all: DiscoveryEvidence[] = [];
  const directories = ancestorDirectories(filePath, projectRoot);
  for (let distance = 0; distance < directories.length; distance++) {
    const directory = directories[distance];
    const found = await Promise.all(
      [...adapters.values()].map(async (adapter) => {
        try {
          return await adapter.discover(directory, { filePath, projectRoot });
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
              cause,
            },
          );
        }
      }),
    );
    for (const items of found) {
      for (const item of items) all.push({ ...item, distance });
    }
  }
  return all;
}

function buildCandidates(
  evidence: readonly DiscoveryEvidence[],
  adapters: ReadonlyMap<string, FormatterAdapter>,
): FormatterCandidate[] {
  const byDirectoryAndFormatter = new Map<string, DiscoveryEvidence[]>();
  for (const item of evidence) {
    const key = `${dirname(item.path)}\0${item.formatter}`;
    const items = byDirectoryAndFormatter.get(key) ?? [];
    items.push(item);
    byDirectoryAndFormatter.set(key, items);
  }
  return [...byDirectoryAndFormatter.values()].map((items) => {
    const formatter = items[0].formatter;
    return {
      formatter,
      configRoot: dirname(items[0].path),
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
}): Promise<FormatterResolution> {
  const context: AdapterContext = {
    filePath: options.filePath,
    projectRoot: options.projectRoot,
    configRoot: options.configRoot,
    evidence: options.evidence,
  };
  const availability = await options.adapter.probe(context);
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
    evidence: resolution.evidence,
    formatOnly: options.formatOnly,
  };
}
