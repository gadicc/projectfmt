# Plan 014: Remove duplicate work inside one operation

> **Executor instructions**: Follow this plan in order and run every
> verification command. Stop and report instead of improvising when a STOP
> condition occurs. Update this plan's row in `plans/README.md` when done unless
> a reviewer maintains the index.
>
> **Drift check (run first)**:
> `git diff --stat 5ff23b4..HEAD -- src/projectfmt.ts src/types.ts src/adapters/discovery.ts src/adapters/prettier.ts src/adapters/biome.ts src/adapters/deno.ts main_test.ts benches/operation_bench.ts benches/README.md README.md`
> Treat the excerpts below as the audit snapshot. Re-read live in-scope code
> after every earlier completed plan; expected prerequisite changes are rebase
> inputs, not automatic STOP conditions. Stop only if live behavior invalidates
> this plan's finding or contract.

## Status

- **Priority**: P2
- **Effort**: M
- **Risk**: MED
- **Depends on**: plans/004-correct-biome-lifecycle.md,
  plans/005-match-deno-virtual-file-semantics.md,
  plans/006-align-config-discovery.md, plans/007-use-effective-biome-config.md,
  plans/013-validate-custom-adapters.md
- **Category**: perf
- **Planned at**: commit `5ff23b4`, 2026-07-22

Before starting, read plan 007's decision. If it requires a production follow-up
that changes Biome execution, complete that follow-up and record its commit
before this refactor; otherwise this plan would optimize a knowingly temporary
path.

## Why this matters

A single formatSourceWithResult call rebuilds the adapter map after resolution,
re-resolves selected implementations, and repeats package/config reads across
built-ins. These costs matter for code generators, but cross-call caching is
intentionally forbidden. Measure first, then introduce one call-scoped operation
object and only the read-sharing justified by benchmarks.

## Current state

- formatSourceWithResult calls public resolveFormatter, then rebuilds adapterMap
  and looks up the selected adapter.
- Prettier and Biome probe resolution is repeated during format.
- Each built-in discovery helper reads its own config names and package.json.
- README explicitly says formatter evidence/configuration/availability are not
  cached across calls.

```ts
// src/projectfmt.ts:203-244
const options = normalizeOptions(input);
const resolution = await resolveFormatter(options);
// status handling
const adapters = adapterMap(options.adapters ?? []);
const adapter = adapters.get(resolution.formatter!);
const context = adapterContext(resolution, options);
const formatted = await adapter.format(source, context);
```

```ts
// src/adapters/prettier.ts:63-72,87-93
// probe
const implementation = resolvePrettier(context);
const prettier = await importPrettier(implementation);
// format repeats resolvePrettier and importPrettier
```

```ts
// src/adapters/discovery.ts:8-40
// configFileEvidence reads every name sequentially
// packageEvidence then reads and parses package.json
// each built-in adapter invokes these helpers independently
```

Repository constraints to preserve:

- No cache may survive the public operation call.
- Configuration and availability remain fresh on every separate call.
- This plan may deliberately define a single call-scoped snapshot after
  discovery/probe: package implementation paths and shared reads stay stable
  between resolution and formatting within that call. That semantic must be
  documented and tested; it is not a cross-call cache.
- Resolution objects remain serializable and public output remains identical.
- Do not skip discovery evidence merely because formatter selection is explicit.
- Optimize only measured duplicate work, not formatter subprocess semantics.

## Commands you will need

| Purpose            | Command                                                                                                                                                                     | Expected on success              |
| ------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------- |
| Baseline sample    | `deno run -A benches/measure_operation.ts --batches 3 --iterations 30 --output /tmp/projectfmt-operation-baseline.json`                                                     | four scenario baselines recorded |
| Candidate compare  | `deno run -A benches/measure_operation.ts --batches 3 --iterations 30 --baseline /tmp/projectfmt-operation-baseline.json --output /tmp/projectfmt-operation-candidate.json` | numeric thresholds pass          |
| Benchmark          | `deno bench -A benches/operation_bench.ts`                                                                                                                                  | before/after samples complete    |
| Behavior tests     | `deno task test`                                                                                                                                                            | all pass                         |
| Full gate          | `deno task check`                                                                                                                                                           | exit 0                           |
| Distribution gates | `deno task coverage && deno task test:packages`                                                                                                                             | both exit 0                      |

## Scope

**In scope** (the only files to modify):

- `src/projectfmt.ts`
- `src/operation.ts`
- `src/operation_test.ts`
- `src/types.ts`
- `src/adapters/discovery.ts`
- `src/adapters/prettier.ts`
- `src/adapters/biome.ts`
- `src/adapters/deno.ts`
- `main_test.ts`
- `benches/operation_bench.ts`
- `benches/measure_operation.ts`
- `benches/README.md`
- `README.md`

**Out of scope**:

- Persistent/global formatter, config, or availability caches.
- Changing discovery ranking/evidence output.
- A public batch API (plan 017).
- Skipping probes or weakening failure classification.
- Micro-optimizing string/glob code without measurements.

**Administrative exception**:

- `plans/README.md` may be edited only to update this plan's status row. It is
  excluded from the implementation scope and scope-cleanliness check.

## Git workflow

- Branch: `codex/014-remove-per-call-duplication`
- Conventional Commit subject: `perf(core): reuse call-scoped resolution work`
- Do not push or open a PR unless instructed.

## Steps

### Step 1: Record a reproducible baseline

Create a Deno benchmark and a deterministic measurement runner for explicit and
automatic Prettier formatting at shallow and nested virtual paths: exactly four
scenarios. The runner performs five unrecorded warmups, then three batches of 30
sequential operations per scenario. Its JSON contains runtime/OS/CPU metadata,
the commit, per-batch medians, median-of-medians, and p95. Record the command
and baseline summary in benches/README.md. Use call-count assertions in
src/operation_test.ts rather than timing alone.

**Verify**:
`deno run -A benches/measure_operation.ts --batches 3 --iterations 30 --output /tmp/projectfmt-operation-baseline.json && deno bench -A benches/operation_bench.ts`
→ all four scenarios are present and no destination file is written

### Step 2: Introduce one internal resolved-operation path

Move the internal operation assembly to src/operation.ts. Refactor public
resolveFormatter to delegate to an internal resolveOperation that returns the
serializable resolution plus selected adapter, adapter map, and contexts needed
by formatting. formatSourceWithResult calls it directly rather than invoking the
public wrapper and rebuilding state. Keep the module out of main.ts. Structure
its internal service dependencies so src/operation_test.ts can count adapter-map
construction and resolution calls without a public or global test hook. Assert
exactly one adapter-map construction per public operation; the current baseline
is two for formatSourceWithResult and one for resolveFormatter. Public
signatures and resolution JSON must remain unchanged.

**Verify**: `deno task test` → all existing result and custom-adapter tests pass

### Step 3: Reuse the probed implementation within the call

First update README's freshness contract: each separate public call performs
fresh discovery and probing, while one formatting call snapshots its selected
package implementation path from successful probe through format. Explicitly
record the compatibility change: repointing/removing a package between those two
phases no longer triggers a second resolution or changes selection; failure to
load/invoke the snapshotted path remains a FormatterExecutionError during
formatting. This closes the existing intra-call TOCTOU window intentionally.

Carry validated availability/implementation into the format context through an
additive optional AdapterContext field or an internal wrapper. Prettier and
Biome must use the already resolved implementation path instead of
resolveProjectPackage again. Deno may reuse probe metadata, but do not claim an
executable-path snapshot unless probe resolves and records an absolute path. Do
not retain imported modules or paths after the call.

Use the internal operation-service seam to pause after probe, repoint the
package resolver, and then resume format. Assert the original probed path is
used once, the replacement is not resolved, and an unavailable original path
fails in the documented formatting phase with its cause/stderr. Also keep a
control proving a new public call observes the replacement.

**Verify**: `deno test -A src/operation_test.ts main_test.ts` → each format
operation probes once, reuses one resolved package implementation, builds one
adapter map, the intra-call snapshot/error phase assertions pass, and all
adapter/context behavior remains green

### Step 4: Measure before adding shared discovery reads

Re-run the comparison runner. The resolved-operation stage may be retained only
if its exact counts fall from two to one and no scenario's median-of-medians is
more than 5 percent slower than baseline. Only if instrumented tests still show
duplicate package/config reads, add a call-scoped discovery reader passed to
built-in helpers so each unique path is read and parsed exactly once per
operation; custom adapters may ignore it. Retain that optional stage only when
the count assertion passes, no scenario regresses by more than 5 percent, and at
least two automatic-discovery scenarios improve by at least 10 percent.
Otherwise revert only that optional stage and record the rejected measurement.
Do not use module globals.

**Verify**:
`deno run -A benches/measure_operation.ts --batches 3 --iterations 30 --baseline /tmp/projectfmt-operation-baseline.json --output /tmp/projectfmt-operation-candidate.json && deno test -A src/operation_test.ts`
→ the runner enforces the 5/10-percent rules, count assertions pass, and
benches/README.md records retained/rejected stages with before/after values

### Step 5: Prove freshness and run distribution gates

Add a test that changes config/availability between two calls and observes the
change, proving no state leaked across operations. Keep it beside the Step 3
within-call snapshot test so both sides of the freshness contract are
machine-checked. Run all Deno and package gates.

**Verify**: `deno task check && deno task coverage && deno task test:packages` →
all exit 0 and freshness regression passes

## Test plan

- Public resolution JSON is unchanged.
- One format operation reuses one adapter map and selected implementation.
- A package repointed after probe cannot change the current operation, while a
  missing snapshotted implementation fails in the documented format phase.
- Two separate calls observe config/availability changes.
- Custom adapters see the same validated contexts.
- Benchmark records explicit and auto nested cases.
- The measurement runner fails nonzero when the numeric acceptance rule is not
  met; unit tests fail when duplicate operation counts return.

## Done criteria

- [ ] No public call invokes another public call and rebuilds operation state.
- [ ] No cross-call cache is introduced.
- [ ] README and tests define both within-call implementation snapshot semantics
      and between-call freshness.
- [ ] Before/after measurements and retained stages are documented.
- [ ] Retained optimization reduces duplicate operation counts and does not
      regress any scenario's median-of-medians by more than 5 percent.
- [ ] `deno task check` exits 0.
- [ ] No file outside the in-scope list or administrative exception is modified;
      verify with `git status --short`.
- [ ] `plans/README.md` marks this plan DONE unless the reviewer owns the index.

## STOP conditions

Stop and report if:

- Live behavior invalidates the finding or operation contract after rebasing
  expected prerequisite changes.
- A verification fails twice after one focused correction.
- The implementation requires an out-of-scope file.
- A proposed optimization changes evidence, ranking, or status, or changes error
  timing beyond the explicitly documented removal of the second within-call
  package-resolution race.
- Sharing reads requires a module-global cache.
- Benchmark payoff is below threshold for a high-risk stage; document and omit
  that stage.
- The refactor cannot keep FormatterResolution serializable.
- Plan 007 requires an unfinished production follow-up that changes the Biome
  paths this plan would refactor.

## Maintenance notes

- Re-run benchmarks after adapter lifecycle changes.
- Plan 017 may reuse the internal operation model but must define batch
  freshness separately.
- Do not turn call-scoped readers into persistent caches without an explicit API
  decision.
