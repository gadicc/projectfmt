# Plan 017: Design a batch API for code generators

> **Executor instructions**: This is a direction spike, not authorization to
> ship production code. Follow the plan in order, run every verification
> command, and stop instead of improvising when a STOP condition occurs. Update
> the row in `plans/README.md` when done unless a reviewer maintains the index.
>
> **Drift check (run first)**:
> `git diff --stat 5ff23b4..HEAD -- docs/design/batch-api.md scripts/spike_batch_api.ts scripts/spike_batch_api_test.ts benches/batch_bench.ts benches/README.md`
> Treat the excerpts below as the audit snapshot. Re-read live public contracts
> and plan 014's benchmark notes before work; expected prerequisite changes,
> including edits to benches/README.md, are rebase inputs rather than automatic
> STOP conditions. Stop only if live behavior invalidates this spike's question
> or constraints.

## Status

- **Priority**: P3
- **Effort**: M
- **Risk**: MED
- **Depends on**: plans/014-remove-per-call-duplication.md
- **Category**: direction
- **Planned at**: commit `5ff23b4`, 2026-07-22

## Why this matters

Code generators are the primary audience and commonly produce many virtual
files, while the API handles one source/path at a time. A batch surface could
provide bounded concurrency and coherent partial failures, but it also creates
freshness, ordering, and cancellation semantics. Prototype those contracts and
measure value before adding public types.

## Current state

- The public entry point exports only single-file format/resolve functions.
- Root inference caches topology, but formatter evidence/config/availability are
  intentionally fresh per call.
- Plan 014 introduces measured call-scoped reuse without persistent caches.
- There is no batch result, concurrency, ordering, or failure policy.

```ts
// main.ts:1-6
export {
  formatSource,
  formatSourceWithResult,
  resolveFormatter,
} from "./src/projectfmt.ts";
```

```text
# README.md:18-22
projectfmt is a project-aware formatter broker for code generators and
libraries. Give it source text, the path where that source is intended to live,
and either an explicit project boundary or an absolute path.
```

```text
# README.md:137-140,211-215
Inferred roots are cached for traversed directories at or below the detected
root. Call clearProjectRootCache() if project topology changes. Formatter
evidence, configuration, and availability are not cached.
```

Repository constraints to preserve:

- The spike remains in-memory and virtual-file first.
- Input order, result association, concurrency bounds, and partial failures must
  be explicit.
- No persistent cache; any per-batch snapshot semantics require an explicit
  user-visible decision.
- No destination files, network access, or runtime installs.

## Commands you will need

| Purpose         | Command                                        | Expected on success                     |
| --------------- | ---------------------------------------------- | --------------------------------------- |
| Prototype tests | `deno test -A scripts/spike_batch_api_test.ts` | ordering/failure/concurrency cases pass |
| Benchmark       | `deno bench -A benches/batch_bench.ts`         | 1/10/100-file scenarios complete        |
| Design format   | `deno fmt --check docs/design/batch-api.md`    | exit 0                                  |
| Repository gate | `deno task check`                              | exit 0                                  |

## Scope

**In scope** (the only files to modify):

- `docs/design/batch-api.md`
- `scripts/spike_batch_api.ts`
- `scripts/spike_batch_api_test.ts`
- `benches/batch_bench.ts`
- `benches/README.md`

**Out of scope**:

- main.ts, src/types.ts, or production implementation.
- Persistent/global caches.
- Writing generated files.
- Worker threads, remote execution, or whole-repository globbing.

**Administrative exception**:

- `plans/README.md` may be edited only to update this plan's status row. It is
  excluded from the spike scope and scope-cleanliness check.

## Git workflow

- Branch: `codex/017-design-batch-api`
- Conventional Commit subject: `docs(design): spike batch formatting api`
- Do not push or open a PR unless instructed.

## Steps

### Step 1: Specify candidate types and invariants

Create docs/design/batch-api.md with candidate FormatSourceEntry,
BatchFormatOptions, indexed success/failure result, and aggregate summary
shapes. Define shared versus per-entry options, duplicate file paths, empty
input, stable input-order results, bounded positive concurrency, and whether
errors are returned or thrown.

**Verify**:
`rg -n "Input order|Concurrency|Failure mode|Freshness|Empty batch|Duplicate path" docs/design/batch-api.md`
→ all invariants have explicit proposed behavior

### Step 2: Define freshness and failure semantics

Use per-entry fresh resolution for the executable prototype because that is the
only semantics available through the public single-file API. State exactly what
filesystem/config changes during a batch can be observed. Describe a grouped
per-batch snapshot only as a rejected or future production alternative; do not
select or claim to prototype it without a separate public/internal design.
Define all-settled and fail-fast; fail-fast may stop scheduling new work but
must acknowledge already-running subprocesses cannot yet be cancelled. Choose
one failure default and justify it.

**Verify**:
`rg -n "per-entry fresh|all-settled|fail-fast|snapshot|configuration changes|already running" docs/design/batch-api.md`
→ executable freshness, alternatives, trade-offs, and one failure default are
documented

### Step 3: Build a public-API-only prototype

Implement scripts/spike_batch_api.ts as an internal orchestrator over
formatSourceWithResult with a small bounded-concurrency scheduler. Preserve
input order and return structured projectfmt errors without stringifying away
fields. Do not import internal src modules or add exports.

**Verify**: `deno test -A scripts/spike_batch_api_test.ts` → prototype obeys
order, concurrency, and chosen failure rules

### Step 4: Test concurrency and partial failures deterministically

Use custom test adapters with controllable promises to assert maximum in-flight
work, output order under out-of-order completion, fail-fast scheduling,
all-settled mixed outcomes, empty input, duplicate paths, and formatOnly
forwarding. Avoid real timers when deferred promises suffice.

**Verify**: `deno test -A scripts/spike_batch_api_test.ts` → all scheduler and
result-shape cases pass deterministically

### Step 5: Measure whether the API earns its complexity

Benchmark only interfaces available within this plan: sequential public calls
and the bounded-concurrency public-API prototype for 1, 10, and 100 files.
Separate formatter subprocess cost from orchestration with both a custom
in-process adapter and one real formatter. Do not import plan 014's private
operation internals or imply snapshot reuse. Append a clearly headed batch
section with environment and medians to benches/README.md without replacing plan
014's existing results.

**Verify**: `deno bench -A benches/batch_bench.ts` → all scenarios complete and
before/after data is recorded

### Step 6: Write the decision and implementation outline

Conclude Go, Revise, or No-go using measured latency, API complexity, and
target-user value. For Go/Revise, specify exact public exports, docs/tests,
grouping key, default concurrency/failure policy, and compatibility story. Do
not implement them here.

**Verify**:
`rg -n "Decision: (Go|Revise|No-go)|Public exports|Default concurrency|Compatibility|Implementation follow-up" docs/design/batch-api.md`
→ one decision and bounded follow-up are present

### Step 7: Run repository checks

Format spike artifacts, run the normal gate, and verify no public source
changed.

**Verify**:
`deno fmt --check docs/design/batch-api.md scripts/spike_batch_api.ts scripts/spike_batch_api_test.ts benches/batch_bench.ts benches/README.md && deno task check`
→ all exit 0

## Test plan

- Empty and one-entry batches.
- Stable input-order output despite out-of-order completion.
- Concurrency never exceeds the bound.
- Mixed successes/failures preserve structured fields.
- Fail-fast stops scheduling but documents in-flight completion.
- Per-entry calls observe documented config freshness; snapshot semantics remain
  an explicitly unimplemented alternative.

## Done criteria

- [ ] The candidate API, invariants, and defaults are explicit.
- [ ] Prototype tests are deterministic and production source is untouched.
- [ ] Benchmarks quantify 1/10/100-file value.
- [ ] The document contains one go/revise/no-go decision and follow-up.
- [ ] `deno task check` exits 0.
- [ ] No production source file is modified.
- [ ] The prototype uses per-entry freshness and imports only public projectfmt
      exports.
- [ ] No file outside the in-scope list or administrative exception is modified;
      verify with `git status --short`.
- [ ] `plans/README.md` marks this plan DONE unless the reviewer owns the index.

## STOP conditions

Stop and report if:

- Live intent or public contracts invalidate the batch question after rebasing
  plan 014 and other expected serial changes.
- A verification fails twice after one focused correction.
- The spike requires a production source change.
- The work expands outside the listed files.
- Useful batching requires a persistent cache across API calls.
- Correct fail-fast semantics require killing subprocesses beyond current
  process support.
- Benchmarks show no meaningful value and the document cannot justify
  complexity; record No-go rather than forcing implementation.

## Maintenance notes

- If implemented, keep batch orchestration layered over single-file semantics.
- Revisit cancellation only with a separate process API plan.
- Rebenchmark when formatter process or discovery architecture changes.
