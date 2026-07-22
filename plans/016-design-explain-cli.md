# Plan 016: Design a built-in explain-only diagnostic CLI

> **Executor instructions**: This is a direction spike, not authorization to
> ship production code. Follow the plan in order, run every verification
> command, and stop instead of improvising when a STOP condition occurs. Update
> the row in `plans/README.md` when done unless a reviewer maintains the index.
>
> **Drift check (run first)**:
> `git diff --stat 5ff23b4..HEAD -- docs/design/explain-cli.md scripts/spike_explain_cli.ts scripts/spike_explain_cli_test.ts`
> Treat the excerpts below as the audit snapshot. Re-read the live public
> contracts after every earlier completed plan; expected prerequisite changes
> are rebase inputs, not automatic STOP conditions. Stop only if live behavior
> invalidates this spike's question or constraints.

## Status

- **Priority**: P3
- **Effort**: M
- **Risk**: MED
- **Depends on**: plans/001-reject-root-as-file.md,
  plans/002-bound-native-config-lookup.md, plans/004-correct-biome-lifecycle.md,
  plans/006-align-config-discovery.md, plans/013-validate-custom-adapters.md
- **Category**: direction
- **Planned at**: commit `5ff23b4`, 2026-07-22

## Why this matters

FormatterResolution already contains the evidence users need to debug selection,
boundaries, ambiguity, and unavailable implementations. A narrow explain command
could make that information accessible in shells and CI without turning
projectfmt into a repository formatter. Prototype the UX and output contract
before adding package bins or public support obligations. This spike covers the
built-in adapters only; it does not claim full resolveFormatter-option parity
for caller-supplied custom adapters.

## Current state

- resolveFormatter performs discovery and probing without formatting.
- FormatterResolution is a serializable object with status, paths, evidence,
  candidates, ambiguity, reason, and availability.
- README says a whole-repository formatting CLI is not the primary goal.
- No CLI entry point, argument parser, exit-code contract, or npm bin exists.

```ts
// src/types.ts:105-129
export interface FormatterResolution {
  status: ResolutionStatus;
  formatter: FormatterName | null;
  requested: FormatterSelection;
  projectRoot: string;
  filePath: string;
  configRoot: string | null;
  reason: string;
  evidence: readonly DiscoveryEvidence[];
  candidates: readonly FormatterCandidate[];
  ambiguous: boolean;
  availability?: AdapterAvailability;
}
```

```text
# README.md:184-209

### resolveFormatter(optionsOrAbsolutePath)

Performs the same discovery and availability probing without formatting. For
default resolution options, pass the absolute intended path directly.
```

```text
# README.md:329-332
Likely future adapters include dprint and oxfmt. A whole-repository formatting
CLI is not the primary goal.
```

Repository constraints to preserve:

- The spike must never call formatSource or write an intended file.
- Human and JSON output must be deterministic and free of ANSI in JSON mode.
- Paths/args are passed as values, never shell-interpolated.
- Do not add package bin metadata or promise output stability in production yet.
- Because the prototype cannot load custom adapters, it deliberately omits
  `--format-only`: current built-in discovery/availability must first be proven
  invariant to that option. Formatting/ignore behavior remains a non-goal.

## Commands you will need

| Purpose           | Command                                                                                                        | Expected on success             |
| ----------------- | -------------------------------------------------------------------------------------------------------------- | ------------------------------- |
| Prototype tests   | `deno test -A scripts/spike_explain_cli_test.ts`                                                               | all CLI cases pass              |
| Manual human mode | `deno run -A scripts/spike_explain_cli.ts --file tests/fixtures/prettier/generated.ts --project-root .`        | readable explanation and exit 0 |
| JSON mode         | `deno run -A scripts/spike_explain_cli.ts --json --file tests/fixtures/prettier/generated.ts --project-root .` | valid JSON only on stdout       |
| Repository gate   | `deno task check`                                                                                              | exit 0                          |

## Scope

**In scope** (the only files to modify):

- `docs/design/explain-cli.md`
- `scripts/spike_explain_cli.ts`
- `scripts/spike_explain_cli_test.ts`

**Out of scope**:

- main.ts, src, npm package metadata, or release workflows.
- Formatting commands, glob expansion, repository traversal, watch mode, or
  config editing.
- A stable production CLI commitment.
- Loading arbitrary custom adapters from CLI flags.

**Administrative exception**:

- `plans/README.md` may be edited only to update this plan's status row. It is
  excluded from the spike scope and scope-cleanliness check.

## Git workflow

- Branch: `codex/016-design-explain-cli`
- Conventional Commit subject: `docs(design): spike explain-only cli`
- Do not push or open a PR unless instructed.

## Steps

### Step 1: Specify users, non-goals, and output contracts

Create docs/design/explain-cli.md. Define the code-generator author and
CI-debugging use cases; explicitly exclude formatting. Specify --file,
--project-root, --formatter, --strict, --json, and --help. Define stdout/stderr
separation, a versioned JSON envelope around FormatterResolution, path
representation, and deterministic human sections. Add an “Option parity” section
that explicitly excludes custom adapters and `--format-only`, explains that plan
013 makes it a public probe input for custom adapters, and states the trigger
for adding it: custom-adapter loading or any built-in resolution difference.

**Verify**:
`rg -n "Non-goals|Option parity|--format-only|custom adapters|--file|--json|Exit codes|JSON schema|Human output" docs/design/explain-cli.md`
→ all contract sections exist

### Step 2: Define exit meanings before coding

Assign distinct documented exits for successful selected/disabled resolution,
not-configured, unavailable, strict ambiguity/invalid input, and internal
failure. Keep JSON syntactically valid for all domain outcomes; send only
unexpected operational diagnostics to stderr. Explain why each status is or is
not CI-failing.

**Verify**:
`rg -n "selected|disabled|not-configured|unavailable|ambiguous|invalid" docs/design/explain-cli.md`
→ every resolution/error class maps to an exit behavior

### Step 3: Build a repository-only prototype

Implement scripts/spike_explain_cli.ts with a minimal local parser and
resolveFormatter only. Render human evidence in ranked order and JSON with an
explicit schemaVersion plus resolution/error object. Do not add a production
dependency solely for argument parsing. Reject `--format-only` as an unsupported
prototype option with the documented invalid-input exit rather than silently
accepting a no-op flag.

**Verify**:
`deno run -A scripts/spike_explain_cli.ts --json --file tests/fixtures/prettier/generated.ts --project-root .`
→ stdout parses as one JSON document and no file is written

### Step 4: Test complete status and safety cases

Spawn the prototype in tests for selected, disabled, not-configured,
unavailable, strict ambiguity, invalid outside-root path, spaces in paths, human
mode, JSON mode, --help, and explicit rejection of `--format-only`. Separately
call resolveFormatter with formatOnly false and true for every built-in fixture
and compare status, formatter, configRoot, evidence, candidates, ambiguity, and
availability after removing environment-dependent version text; also compare
requested, projectRoot, filePath, and reason. This is the executable proof
supporting the prototype's narrowed option surface. Snapshot only the
intentional small schema; use field assertions for absolute paths and
environment-dependent implementation details.

**Verify**: `deno test -A scripts/spike_explain_cli_test.ts` → all statuses,
exits, and output-channel assertions pass

### Step 5: Record a go/no-go decision

Document packaging choices for a future JSR task/npm bin, output versioning
policy, Windows invocation, and maintenance cost. End with Go, Revise, or No-go
plus reasons and an implementation-plan outline. Do not edit package metadata in
this spike.

**Verify**:
`rg -n "Decision: (Go|Revise|No-go)|Packaging|Versioning|Implementation follow-up" docs/design/explain-cli.md`
→ one decision and bounded follow-up exist

### Step 6: Run repository checks

Format design/prototype files and run the standard gate. Verify git diff
contains no main.ts, src, or npm metadata.

**Verify**:
`deno fmt --check docs/design/explain-cli.md scripts/spike_explain_cli.ts scripts/spike_explain_cli_test.ts && deno task check`
→ all exit 0

## Test plan

- Every current ResolutionStatus has a CLI outcome.
- Built-in resolution equivalence with formatOnly false/true is proven, while
  the unsupported CLI flag fails explicitly.
- Structured projectfmt errors serialize without losing code/path/evidence.
- JSON stdout has no prose or ANSI.
- Human output explains selected evidence and availability.
- The prototype never formats or creates the intended file.

## Done criteria

- [ ] A versioned proposed CLI contract and exit table exist.
- [ ] The prototype is tested but not packaged.
- [ ] The design clearly excludes custom-adapter option parity and records when
      `--format-only` must be added.
- [ ] The document contains one go/revise/no-go decision.
- [ ] No production source or manifest changed.
- [ ] `deno task check` exits 0.
- [ ] No production source file is modified.
- [ ] No file outside the in-scope list or administrative exception is modified;
      verify with `git status --short`.
- [ ] `plans/README.md` marks this plan DONE unless the reviewer owns the index.

## STOP conditions

Stop and report if:

- Live intent or public contracts invalidate the diagnostic-only spike after
  rebasing expected prerequisite changes.
- A verification fails twice after one focused correction.
- The spike requires a production source change.
- The work expands outside the listed files.
- The existing resolution object cannot serialize after plan 013.
- Any built-in fixture resolves differently when formatOnly changes; add and
  forward the flag or narrow the supported formatter set before continuing.
- Useful diagnostics require formatting or executing untrusted above-root
  config.
- A product requirement expands the spike into repository-wide orchestration.

## Maintenance notes

- If shipped later, treat JSON schema and exit codes as compatibility surfaces.
- Keep explain logic a presentation layer over resolveFormatter rather than a
  second resolver.
