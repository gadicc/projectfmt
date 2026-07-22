/** Formatter adapters included with projectfmt. */
export type BuiltinFormatterName = "biome" | "deno" | "prettier";
/** A built-in or caller-provided adapter name. */
export type FormatterName = string;
/** Requested automatic, disabled, built-in, or custom formatter selection. */
export type FormatterSelection = "auto" | "none" | FormatterName;
/** Outcome of formatter discovery and availability probing. */
export type ResolutionStatus =
  | "selected"
  | "disabled"
  | "not-configured"
  | "unavailable";

/** Kind of project signal used to rank formatter candidates. */
export type EvidenceKind =
  | "config"
  | "package-key"
  | "script"
  | "dependency"
  | "custom";

/** A single project signal discovered while walking toward projectRoot. */
export interface DiscoveryEvidence {
  /** Adapter name associated with this evidence. */
  formatter: FormatterName;
  /** What kind of project signal was found. */
  kind: EvidenceKind;
  /** Absolute path to the file that supplied the evidence. */
  path: string;
  /** Human-readable description suitable for diagnostics. */
  description: string;
  /** Higher values win within the same directory. Built-ins use 30/20/10. */
  strength: number;
  /** Directory distance from the intended file: zero is its own directory. */
  distance: number;
}

/** Result of checking whether an adapter implementation can be invoked. */
export interface AdapterAvailability {
  /** Whether the implementation is usable. */
  available: boolean;
  /** Resolved module, executable, or in-process implementation description. */
  implementation?: string;
  /** Formatter version, when it can be determined without side effects. */
  version?: string;
  /** Diagnostic explanation when the implementation is unavailable. */
  reason?: string;
}

/** Normalized project context supplied to formatter adapters. */
export interface AdapterContext {
  /** Absolute intended destination path. */
  filePath: string;
  /** Absolute discovery and module-resolution boundary. */
  projectRoot: string;
  /** Directory whose evidence selected the adapter. */
  configRoot: string;
  /** All evidence discovered within projectRoot, nearest first. */
  evidence: readonly DiscoveryEvidence[];
}

/** In-memory output returned by an adapter. */
export interface AdapterFormatResult {
  /** Formatted or unchanged source text. */
  source: string;
  /** Whether the intended path matched a formatter ignore rule. */
  ignored?: boolean;
  /** Non-fatal formatter diagnostics written to stderr. */
  stderr?: string;
}

/** Extension point for discovering, probing, and invoking a formatter. */
export interface FormatterAdapter {
  /** Stable selection name. */
  name: FormatterName;
  /** Tie-breaker after directory and evidence strength. Higher wins. */
  priority?: number;
  /** Find project signals at one directory in the upward search. */
  discover(
    directory: string,
    context: Pick<AdapterContext, "filePath" | "projectRoot">,
  ): Promise<readonly Omit<DiscoveryEvidence, "distance">[]>;
  /** Locate a usable implementation without installing anything. */
  probe(context: AdapterContext): Promise<AdapterAvailability>;
  /** Format only. Adapters must not lint, fix, or organize imports. */
  format(source: string, context: AdapterContext): Promise<AdapterFormatResult>;
}

/** Ranked adapter evidence associated with one project directory. */
export interface FormatterCandidate {
  /** Adapter name. */
  formatter: FormatterName;
  /** Directory containing this candidate's evidence. */
  configRoot: string;
  /** Evidence for this formatter in this directory. */
  evidence: readonly DiscoveryEvidence[];
  /** Strongest evidence value in this candidate. */
  bestStrength: number;
  /** Stable final tie-breaker after directory and evidence strength. */
  priority: number;
}

/** Complete, serializable explanation of a formatter resolution. */
export interface FormatterResolution {
  /** Resolution outcome. */
  status: ResolutionStatus;
  /** Selected adapter, or null when disabled/not configured. */
  formatter: FormatterName | null;
  /** Selection requested by the caller. */
  requested: FormatterSelection;
  /** Absolute project boundary. */
  projectRoot: string;
  /** Absolute intended destination path. */
  filePath: string;
  /** Directory that supplied the selected evidence. */
  configRoot: string | null;
  /** Human-readable explanation of the decision. */
  reason: string;
  /** Every discovered project signal, nearest first. */
  evidence: readonly DiscoveryEvidence[];
  /** Ranked candidates from every searched directory. */
  candidates: readonly FormatterCandidate[];
  /** Whether equal-ranked candidates required the precedence tie-breaker. */
  ambiguous: boolean;
  /** Selected implementation details, when a formatter was selected. */
  availability?: AdapterAvailability;
}

/** Options shared by formatting and diagnostic resolution APIs. */
export interface FormatSourceOptions {
  /** Intended destination path, relative to projectRoot or absolute within it. */
  filePath: string;
  /** Boundary for discovery and package resolution. Defaults to cwd. */
  projectRoot?: string;
  /** Defaults to auto. */
  formatter?: FormatterSelection;
  /** Error when auto finds no formatter or an equal-ranked ambiguity. */
  strict?: boolean;
  /** Additional adapters. Names must be unique. */
  adapters?: readonly FormatterAdapter[];
}

/** Formatted text plus change, ignore, and resolution diagnostics. */
export interface FormatSourceResult {
  /** Formatted or unchanged source. */
  source: string;
  /** Whether formatting changed the source string. */
  changed: boolean;
  /** Whether the formatter's ignore rules matched the intended path. */
  ignored: boolean;
  /** Full formatter selection explanation. */
  resolution: FormatterResolution;
}
