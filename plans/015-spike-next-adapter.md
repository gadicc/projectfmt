# Plan 015: Choose the next built-in adapter by evidence

> **Executor instructions**: This is a direction spike, not authorization to
> ship production code. Follow the plan in order, run every verification
> command, and stop instead of improvising when a STOP condition occurs. Update
> the row in `plans/README.md` when done unless a reviewer maintains the index.
>
> **Drift check (run first)**:
> `git diff --stat 5ff23b4..HEAD -- docs/spikes/next-adapter.md scripts/adapter-spike`
> Treat the excerpts below as the audit snapshot. Re-read live in-scope code
> after every earlier completed plan; expected prerequisite changes are rebase
> inputs, not automatic STOP conditions. Stop only if live behavior invalidates
> this plan's question or constraints.

## Status

- **Priority**: P3
- **Effort**: M
- **Risk**: MED
- **Depends on**: plans/005-match-deno-virtual-file-semantics.md,
  plans/006-align-config-discovery.md, plans/007-use-effective-biome-config.md
- **Category**: direction
- **Planned at**: commit `5ff23b4`, 2026-07-22

## Why this matters

The roadmap explicitly names dprint and oxfmt, and the adapter boundary makes
either plausible. Shipping both without comparison would add configuration,
binary-resolution, platform, and precedence obligations. Run a reproducible
side-by-side spike, then recommend one candidate—or neither—with a concrete
production follow-up.

## Current state

- README names dprint and oxfmt as likely future adapters.
- FormatterAdapter already separates discover, probe, and format.
- Built-ins have a stable biome > deno > prettier precedence that a new adapter
  must join deliberately.
- No candidate package, fixture, or precedence is currently committed.

```text
# README.md:329-332

## Roadmap

Likely future adapters include dprint and oxfmt. A whole-repository formatting
CLI is not the primary goal.
```

```ts
// src/types.ts:74-88
export interface FormatterAdapter {
  name: FormatterName;
  priority?: number;
  discover(directory, context): Promise<readonly Evidence[]>;
  probe(context): Promise<AdapterAvailability>;
  format(source, context): Promise<AdapterFormatResult>;
}
```

```ts
// src/adapters/index.ts:8-13
export const builtinAdapters = Object.freeze([
  biomeAdapter,
  denoAdapter,
  prettierAdapter,
]);
```

Repository constraints to preserve:

- The spike must remain source-string and virtual-file first.
- No runtime install, download, package-manager invocation, or network access
  may appear in a production proposal.
- Project-local configuration/plugins/binaries remain trusted but bounded by
  projectRoot.
- A recommendation must define deterministic evidence strength and precedence
  impact.

## Commands you will need

| Purpose            | Command                                                                                                                                                                      | Expected on success                         |
| ------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------- |
| Frozen install     | `deno install --config scripts/adapter-spike/deno.json --lock scripts/adapter-spike/deno.lock --frozen`                                                                      | spike-local dependencies materialize        |
| Spike self-test    | `deno run --config scripts/adapter-spike/deno.json --lock scripts/adapter-spike/deno.lock --frozen --cached-only -A scripts/adapter-spike/spike_next_adapter.ts --self-test` | candidate probes complete                   |
| Deno matrix        | `deno test --config scripts/adapter-spike/deno.json --lock scripts/adapter-spike/deno.lock --frozen --cached-only -A scripts/adapter-spike/spike_next_adapter_cases.ts`      | shared cases pass or documented unsupported |
| Node matrix        | `node scripts/adapter-spike/spike_next_adapter_node.mjs`                                                                                                                     | both Node invocation paths pass             |
| Docs format        | `deno fmt --check docs/spikes/next-adapter.md scripts/adapter-spike`                                                                                                         | exit 0                                      |
| Repository/package | `deno task check && deno task test:packages`                                                                                                                                 | both exit 0                                 |

## Reference material

- [dprint npm installation](https://dprint.dev/install/)
- [dprint configuration](https://dprint.dev/config/)
- [dprint CLI stdin mode](https://dprint.dev/cli/)
- [oxfmt quickstart](https://oxc.rs/docs/guide/usage/formatter/quickstart.html)
- [oxfmt CLI](https://oxc.rs/docs/guide/usage/formatter/cli.html)

## Scope

**In scope** (the only files to modify):

- `docs/spikes/next-adapter.md`
- `scripts/adapter-spike/deno.json`
- `scripts/adapter-spike/deno.lock`
- `scripts/adapter-spike/spike_next_adapter.ts`
- `scripts/adapter-spike/spike_next_adapter_cases.ts`
- `scripts/adapter-spike/spike_next_adapter_node.mjs`
- `scripts/adapter-spike/fixtures/`

**Out of scope**:

- src/adapters and main.ts.
- Publishing a production adapter or changing precedence.
- Runtime downloads or installs.
- A whole-repository formatting CLI.
- Root `deno.json`, root `deno.lock`, or any file included in the JSR/npm
  package. Spike dependencies must not alter a published manifest.

**Administrative exception**:

- `plans/README.md` may be edited only to update this plan's status row. It is
  excluded from the spike scope and scope-cleanliness check.

## Git workflow

- Branch: `codex/015-spike-next-adapter`
- Conventional Commit subject: `docs(spike): evaluate next formatter adapter`
- Do not push or open a PR unless instructed.

## Steps

### Step 1: Define a weighted acceptance scorecard

Create docs/spikes/next-adapter.md before prototyping. Score project-local
resolution, config discovery, stdin/virtual filepath fidelity, ignore semantics,
plugin support, deterministic output, supported languages, Deno/Node invocation,
platform packaging, license/maintenance, error diagnostics, and precedence
ambiguity. Mark non-negotiables versus weighted preferences.

**Verify**:
`rg -n "Resolution|Virtual path|Ignore|Platform|Precedence|Recommendation" docs/spikes/next-adapter.md`
→ all scorecard dimensions exist

### Step 2: Pin reproducible spike dependencies

Using official package metadata, identify the executable/API packages for dprint
and oxfmt. Create a minimal scripts/adapter-spike/deno.json with nodeModulesDir
set to auto. With scripts/adapter-spike as the working directory, run exactly
`deno add --save-exact npm:dprint npm:@dprint/typescript npm:@dprint/json npm:oxfmt`.
Keep all candidate fixtures under scripts/adapter-spike/fixtures and use
scripts/adapter-spike as their projectRoot. Each local dprint config must name
the unversioned `npm:@dprint/typescript` and `npm:@dprint/json` plugins so
dprint walks upward, remains inside that projectRoot, and finds the
lockfile-managed node_modules instead of downloading versioned plugins. The
command writes exact specifier versions to the spike-local config and creates
its lockfile. Record package names, exact resolved versions, platform-package
layout, licenses, and whether lifecycle scripts are required. Initial dependency
resolution is a review-time network action; every subsequent probe/test must use
--frozen and --cached-only. Do not add a runtime auto-install path or touch the
root config or lockfile.

**Verify**:
`deno install --config scripts/adapter-spike/deno.json --lock scripts/adapter-spike/deno.lock --frozen`
→ exact spike-local imports and platform packages materialize without changing
either root manifest

### Step 3: Build a non-production comparison harness

Implement scripts/adapter-spike/spike_next_adapter.ts with internal candidate
wrappers that accept source, intended filePath, projectRoot, and an exact
fixture config. Use oxfmt's documented format API and dprint's project-local CLI
as
`fmt --stdin <absolute-virtual-path> --config <absolute-config-path>
--config-discovery=false`;
pass arguments through Deno.Command, never a shell. Set DPRINT_CACHE_DIR to a
fresh temporary directory and remove it after each case. It may invoke only the
materialized spike-local packages and must never edit the intended destination.
--self-test prints structured capability results and exits nonzero on an
unexpected failure.

**Verify**:
`deno run --config scripts/adapter-spike/deno.json --lock scripts/adapter-spike/deno.lock --frozen --cached-only -A scripts/adapter-spike/spike_next_adapter.ts --self-test`
→ both candidates produce a structured result or an explicit unsupported
capability without network access

### Step 4: Run the same conformance matrix

Test TypeScript, JSON, one nested config, an ignored virtual path, an
unavailable implementation, malformed source, paths with spaces, and
Node-compatible invocation. Record whether each result is native, emulated, or
unsupported; do not hide gaps with candidate-specific easier cases. The Node
script must import oxfmt's documented `format` API directly. For dprint, resolve
the spike-local package's `bin` entry from its package.json and spawn that
absolute executable with shell disabled and stdin input; handle Windows script
extensions explicitly. It must run the same TypeScript/JSON virtual-path smoke
cases and exit nonzero on any mismatch.

**Verify**:
`deno test --config scripts/adapter-spike/deno.json --lock scripts/adapter-spike/deno.lock --frozen --cached-only -A scripts/adapter-spike/spike_next_adapter_cases.ts && node scripts/adapter-spike/spike_next_adapter_node.mjs`
→ the Deno matrix passes with unsupported cases explicitly asserted and both
Node invocation paths are exercised

### Step 5: Write a decision and production-plan outline

Complete the score table with measured evidence and recommend dprint, oxfmt, or
neither. Define proposed adapter name, evidence/config names, strength,
precedence, platform/package resolution, failure behavior, fixture list, and
estimated production effort. List rejected alternative and revisit trigger.

**Verify**:
`rg -n "Decision:|Proposed precedence|Production follow-up|Rejected alternative|Revisit" docs/spikes/next-adapter.md`
→ a single auditable recommendation and follow-up outline exist

### Step 6: Remove accidental production scope and run gates

Confirm no src or public export changed. Format the spike and run repository and
package checks. Assert root deno.json/deno.lock remain unchanged and the package
dry-runs exclude scripts/adapter-spike. The case file deliberately does not use
a `_test.ts` suffix, so the root recursive test command cannot execute it
without the spike-local config; the explicit matrix command above remains
mandatory.

**Verify**:
`deno fmt --check docs/spikes/next-adapter.md scripts/adapter-spike && deno task check && deno task test:packages && git diff --exit-code -- deno.json deno.lock main.ts src`
→ all exit 0 and no production/package input changed

## Test plan

- Both candidates receive identical source/path/root cases.
- Nested config and ignore behavior are tested without destination writes.
- Unavailable and malformed-source diagnostics are captured.
- Node/Deno feasibility and platform package shape are documented.
- A neither recommendation is valid if non-negotiables fail.

## Done criteria

- [ ] The document contains a filled weighted scorecard and one decision.
- [ ] The harness is reproducible from frozen dependencies.
- [ ] No production adapter or public export is added.
- [ ] The follow-up outline is detailed enough to become a separate
      implementation plan.
- [ ] `deno task check` exits 0.
- [ ] No production source file is modified.
- [ ] Both Deno and Node invocation paths are executable from frozen,
      spike-local dependencies without runtime network access.
- [ ] No file outside the in-scope list or administrative exception is modified;
      verify with `git status --short`.
- [ ] `plans/README.md` marks this plan DONE unless the reviewer owns the index.

## STOP conditions

Stop and report if:

- Live intent or public contracts invalidate the spike question after rebasing
  expected prerequisite changes.
- A verification fails twice after one focused correction.
- The spike requires a production source change.
- The work expands outside the listed files.
- Official candidate packaging or license cannot be verified.
- A candidate can work only by downloading at runtime or writing the destination
  file.
- The spike needs an unreviewed native binary outside declared project
  dependencies.

## Maintenance notes

- Refresh the spike before implementation if either candidate releases a major
  version.
- When a production adapter is selected, update central config names from plan
  006 and precedence documentation together.
