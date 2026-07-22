import type {
  DiscoveryEvidence,
  FormatterName,
  FormatterResolution,
} from "./types.ts";

/** Stable machine-readable projectfmt error codes. */
export type ProjectfmtErrorCode =
  | "INVALID_OPTIONS"
  | "AMBIGUOUS_FORMATTER"
  | "FORMATTER_NOT_CONFIGURED"
  | "FORMATTER_UNAVAILABLE"
  | "FORMATTER_FAILED";

export interface ProjectfmtErrorOptions extends ErrorOptions {
  code: ProjectfmtErrorCode;
  formatter?: FormatterName | null;
  filePath?: string;
  projectRoot?: string;
  evidence?: readonly DiscoveryEvidence[];
  stderr?: string;
  resolution?: FormatterResolution;
}

/** Base error for formatter resolution and execution failures. */
export class ProjectfmtError extends Error {
  /** Stable machine-readable failure category. */
  readonly code: ProjectfmtErrorCode;
  /** Selected or requested formatter associated with the failure. */
  readonly formatter: FormatterName | null;
  /** Absolute intended destination path, when available. */
  readonly filePath?: string;
  /** Absolute project boundary, when available. */
  readonly projectRoot?: string;
  /** Project evidence collected before the failure. */
  readonly evidence: readonly DiscoveryEvidence[];
  /** Formatter stderr captured from a failed subprocess. */
  readonly stderr?: string;
  /** Full resolution associated with the failure. */
  readonly resolution?: FormatterResolution;

  /** Create a structured projectfmt error. */
  constructor(message: string, options: ProjectfmtErrorOptions) {
    super(message, { cause: options.cause });
    this.name = "ProjectfmtError";
    this.code = options.code;
    this.formatter = options.formatter ?? null;
    this.filePath = options.filePath;
    this.projectRoot = options.projectRoot;
    this.evidence = options.evidence ?? [];
    this.stderr = options.stderr;
    this.resolution = options.resolution;
  }
}

/** Error raised while selecting or locating a formatter. */
export class FormatterResolutionError extends ProjectfmtError {
  /** Create a formatter resolution error. */
  constructor(message: string, options: ProjectfmtErrorOptions) {
    super(message, options);
    this.name = "FormatterResolutionError";
  }
}

/** Error raised when a selected formatter fails to format source. */
export class FormatterExecutionError extends ProjectfmtError {
  /** Create a formatter execution error. */
  constructor(message: string, options: ProjectfmtErrorOptions) {
    super(message, options);
    this.name = "FormatterExecutionError";
  }
}
