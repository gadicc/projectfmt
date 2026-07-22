# Plan 013: Validate and wrap custom-adapter lifecycles

> **Executor instructions**: Follow this plan in order and run every
> verification command. Stop and report instead of improvising when a STOP
> condition occurs. Update this plan's row in `plans/README.md` when done unless
> a reviewer maintains the index.
>
> **Drift check (run first)**:
> `git diff --stat 5ff23b4..HEAD -- src/projectfmt.ts src/types.ts src/errors.ts main_test.ts README.md`
> Treat the excerpts below as the audit snapshot. Re-read live in-scope code
> after every earlier completed plan; expected prerequisite changes are rebase
> inputs, not automatic STOP conditions. Stop only if live behavior invalidates
> this plan's finding or contract.

## Status

- **Priority**: P2
- **Effort**: M
- **Risk**: MED
- **Depends on**: plans/001-reject-root-as-file.md,
  plans/002-bound-native-config-lookup.md
- **Category**: bug
- **Planned at**: commit `5ff23b4`, 2026-07-22

## Why this matters

Custom adapters are a public extension point, but runtime values are trusted
more than built-ins: malformed evidence enters ranking, probe exceptions escape
raw, malformed results are not checked, and probe does not receive formatOnly.
Validate each lifecycle boundary and preserve structured projectfmt errors so
adapter mistakes cannot corrupt selection or diagnostics.

## Current state

- adapterMap validates only nonempty unique names.
- discover wraps thrown errors but accepts returned formatter/path/strength
  values unchanged.
- finalize calls probe without formatOnly and without a catch.
- format is caught, but its returned result shape is trusted.

```ts
// src/projectfmt.ts:287-299
for (const adapter of [...builtinAdapters, ...customAdapters]) {
  if (!adapter.name || map.has(adapter.name)) throw new FormatterResolutionError(...);
  map.set(adapter.name, adapter);
}
```

```ts
// src/projectfmt.ts:312-334
const found = await Promise.all(
  [...adapters.values()].map(async (adapter) => {
    try { return await adapter.discover(directory, { filePath, projectRoot }); }
    catch (cause) { throw new FormatterResolutionError(...); }
  }),
);
for (const items of found) for (const item of items) all.push({ ...item, distance });
```

```ts
// src/projectfmt.ts:378-384,408-418
const context: AdapterContext = {
  filePath: options.filePath,
  projectRoot: options.projectRoot,
  configRoot: options.configRoot,
  evidence: options.evidence,
};
const availability = await options.adapter.probe(context);

// format context separately adds formatOnly: options.formatOnly
```

Repository constraints to preserve:

- Built-in and custom adapters share one deterministic ranking/error contract.
- Only custom-adapter tests may use synthetic adapters.
- Original causes and available stderr remain attached.
- Runtime validation must be additive at the TypeScript level; do not narrow
  valid documented adapters without evidence.

## Commands you will need

| Purpose            | Command                                                            | Expected on success      |
| ------------------ | ------------------------------------------------------------------ | ------------------------ |
| Main integration   | `deno test -A main_test.ts`                                        | all lifecycle cases pass |
| Typecheck          | `deno task typecheck`                                              | exit 0                   |
| Doc lint           | `deno task doclint`                                                | exit 0                   |
| Distribution gates | `deno task check && deno task coverage && deno task test:packages` | all exit 0               |

## Scope

**In scope** (the only files to modify):

- `src/projectfmt.ts`
- `src/types.ts`
- `src/errors.ts`
- `main_test.ts`
- `README.md`

**Out of scope**:

- Changing built-in formatter selection or precedence.
- Adding adapter installation/loading.
- New error-code families unless unavoidable and explicitly documented.
- Broad schema-validation dependencies.

**Administrative exception**:

- `plans/README.md` may be edited only to update this plan's status row. It is
  excluded from the implementation scope and scope-cleanliness check.

## Git workflow

- Branch: `codex/013-validate-custom-adapters`
- Conventional Commit subject:
  `fix(adapters): validate custom lifecycle results`
- Do not push or open a PR unless instructed.

## Steps

### Step 1: Validate adapter definitions and discovery evidence

Extend the existing custom-adapter block with table-driven cases for invalid
adapter names/priorities/methods, a mismatched formatter name, non-array
discovery output, non-absolute or out-of-project evidence, in-project nested
evidence, invalid kinds, empty descriptions, and non-finite strength. In the
same step, add small internal assertion helpers that make those cases pass.

For each discover call, require an array; each item must use the current adapter
name, an allowed kind, an absolute evidence path contained by projectRoot, a
nonempty description, and finite strength. Do not require evidence to be an
immediate child of the inspected directory: the public contract permits a nested
marker file. Retain the directory supplied to discover as internal,
non-serialized metadata and derive distance, candidate grouping, and configRoot
from that scanned directory rather than from dirname(evidence.path). This
prevents an adapter from spoofing ranking while preserving documented evidence
paths. Raise FormatterResolutionError with INVALID_OPTIONS and original context.
Assert error class, code, formatter, paths, and evidence in each regression.

**Verify**: `deno test -A main_test.ts` → definition/evidence diagnostics are
deterministic, nested in-boundary evidence is accepted, its path cannot alter
the scanned directory's distance/configRoot, and the complete integration file
is green

### Step 2: Validate and wrap probe outcomes

Add cases for malformed availability, a throwing probe, and formatOnly
visibility. Pass the same AdapterContext—including formatOnly—to probe and
format. Catch probe exceptions and wrap them as FormatterResolutionError with
FORMATTER_UNAVAILABLE, formatter/file/root/evidence, and cause. Validate
available as boolean and optional implementation/version/reason as strings
before constructing resolution. Assert the exact structured fields and cause.

**Verify**: `deno test -A main_test.ts` → probe throws and malformed
availability are structured, both lifecycle calls see formatOnly, and the
complete file exits 0

### Step 3: Validate format results inside the existing wrapper

Add malformed-result and throwing-format cases. Before reading
source/ignored/stderr, require a result object with string source and optional
boolean/string fields. Throwing this validation inside the existing try block
must become FormatterExecutionError with FORMATTER_FAILED and cause. Preserve
adapter stderr and assert no raw TypeError escapes.

**Verify**: `deno test -A main_test.ts` → malformed output and thrown format
errors are wrapped with their structured fields and the complete file exits 0

### Step 4: Document runtime enforcement and run gates

Update the custom-adapter section with evidence/result constraints and probe
failure behavior. Run docs, Deno, Node coverage, and package checks.

**Verify**:
`deno task doclint && deno task check && deno task coverage && deno task test:packages`
→ all exit 0

## Test plan

- A valid adapter remains unchanged.
- Every malformed definition/evidence/availability/format shape has a focused
  assertion.
- Probe and format both receive formatOnly.
- Probe and format exceptions preserve causes in structured errors.
- Evidence cannot escape projectRoot or spoof the scanned directory used for
  ranking/configRoot; valid nested marker paths remain compatible.

## Done criteria

- [ ] No custom lifecycle value reaches ranking/result construction without
      validation.
- [ ] No custom probe exception escapes raw.
- [ ] README and TypeScript types describe the same contract.
- [ ] `deno task check` exits 0.
- [ ] No file outside the in-scope list or administrative exception is modified;
      verify with `git status --short`.
- [ ] `plans/README.md` marks this plan DONE unless the reviewer owns the index.

## STOP conditions

Stop and report if:

- Live behavior invalidates the finding or lifecycle contract after rebasing
  expected prerequisite changes.
- A verification fails twice after one focused correction.
- The implementation requires an out-of-scope file.
- A currently documented adapter pattern requires evidence outside projectRoot.
- A new error code is needed to avoid misclassifying malformed versus
  unavailable behavior; report the proposed compatibility impact.
- Validation would require evaluating adapter-owned data.

## Maintenance notes

- Update validation and tests when FormatterAdapter gains fields.
- Keep validation helpers internal and dependency-free.
- Plan 016 relies on resolution diagnostics being safe to serialize.
