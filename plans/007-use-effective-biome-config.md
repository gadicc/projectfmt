# Plan 007: Characterize authoritative Biome tool activation

> **Executor instructions**: This is a characterization spike, not authorization
> to change production behavior. Follow the plan in order, run every
> verification command, and stop instead of improvising when a STOP condition
> occurs. Update this plan's row in `plans/README.md` when done unless a
> reviewer maintains the index.
>
> **Drift check (run first)**:
> `git diff --stat 5ff23b4..HEAD -- src/adapters/biome.ts src/glob.ts main_test.ts tests/fixtures/biome docs/spikes/biome-effective-config.md scripts/spike_biome_effective_config.ts scripts/spike_biome_effective_config_node.mjs scripts/spike_biome_effective_config_test.ts tests/fixtures/biome-effective-probe`
>
> **Prerequisite rebase (required)**: Execute only after plans 002, 004, and 006
> are DONE and their commits are present on the working branch. Changes from
> those plans to Biome discovery, probing, config paths, tests, and README are
> expected and must not trigger a drift STOP by themselves. Re-read the live
> files after rebasing; the excerpts below describe the finding at `5ff23b4` and
> are reference-only. Stop only if the post-prerequisite code no longer exposes
> the same effective-tool-activation question or no longer preserves the
> lint-only contract described below. If plan 005 has landed under the default
> numeric execution order, its Deno-only `src/glob.ts` and fixture changes are
> also expected drift; preserve them, but do not make plan 005 a prerequisite
> for this production-source-free spike.

## Status

- **Priority**: P1
- **Effort**: M
- **Risk**: LOW
- **Depends on**: plans/002-bound-native-config-lookup.md,
  plans/004-correct-biome-lifecycle.md, plans/006-align-config-discovery.md
- **Category**: bug
- **Planned at**: commit `5ff23b4`, 2026-07-22

## Why this matters

The adapter historically inferred effective Biome tool activation from one raw
configuration object. That cannot reliably account for extends, overrides,
language-specific settings, or force-ignore patterns. However, replacing that
logic with one direct `biome check --write --stdin-file-path` call is not an
established solution: a combined check result does not by itself identify which
of formatter, linter, and assist was active, and it must not erase the existing
lint-only behavior. This spike determines whether Biome exposes an
authoritative, stable mechanism before a separate implementation plan changes
production code.

## Current state

- At `5ff23b4`, `biomeFileBehavior` parses raw configuration and synthesizes
  per-tool disable flags before invoking Biome.
- Plans 002, 004, and 006 may legitimately change the exact code shape before
  this spike starts; inspect their landed behavior instead of restoring this
  excerpt.
- The existing lint-only contract is non-negotiable: for
  `tests/fixtures/biome/src/lint-only/rule.ts`, default mode applies the enabled
  safe lint fix while leaving formatting disabled, and `formatOnly: true`
  returns the source unchanged and ignored.
- The installed project-local Biome CLI offers several possible evidence
  surfaces—tool-specific commands, structured reporters, verbose diagnostics,
  and diagnostic commands—but none is assumed authoritative until the matrix
  proves it for virtual stdin paths.

```ts
// src/adapters/biome.ts:158-209 at 5ff23b4 (reference-only)
const configPath = context.evidence.find((item) =>
  item.formatter === "biome" && item.kind === "config"
)?.path;
const config = parseJsonc(text);
// formatter/linter/assist activation is derived from this raw object.
```

```ts
// main_test.ts:396-413 at 5ff23b4 (behavioral contract, not exact line shape)
const linted = await formatSourceWithResult(source, {
  formatter: "biome",
  filePath: "tests/fixtures/biome/src/lint-only/rule.ts",
  projectRoot: root,
});
assertEquals(linted.source, "let     value=1;console.log(value)");
assertEquals(linted.ignored, false);

const formatOnly = await formatSourceWithResult(source, {
  formatter: "biome",
  filePath: "tests/fixtures/biome/src/lint-only/rule.ts",
  projectRoot: root,
  formatOnly: true,
});
assertEquals(formatOnly.source, source);
assertEquals(formatOnly.ignored, true);
```

Repository constraints to preserve:

- This plan must not edit production source, `main_test.ts`, public exports, or
  README behavior claims.
- Default Biome behavior remains safe `check --write` without `--unsafe`, and
  `formatOnly` remains formatting-only.
- The lint-only contract above must remain exact; a mechanism that formats that
  path is not viable.
- Use only the already installed project-local Biome package/binary. The probe
  must not install, download, contact the network, or search above projectRoot.
- Pass virtual paths through stdin arguments and never create or overwrite the
  intended destination file.
- Treat a direct combined `check` invocation as one observation, not proof of
  per-tool activation.

## Commands you will need

| Purpose         | Command                                                                                                                                                                                                                          | Expected on success                                       |
| --------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------- |
| Probe self-test | `deno run -A scripts/spike_biome_effective_config.ts --self-test`                                                                                                                                                                | one JSON report with every required fixture/candidate row |
| Node self-test  | `node scripts/spike_biome_effective_config_node.mjs --self-test`                                                                                                                                                                 | equivalent Node-side JSON report                          |
| Probe tests     | `deno test -A scripts/spike_biome_effective_config_test.ts`                                                                                                                                                                      | all characterization and lint-only assertions pass        |
| Artifact format | `deno fmt --check docs/spikes/biome-effective-config.md scripts/spike_biome_effective_config.ts scripts/spike_biome_effective_config_node.mjs scripts/spike_biome_effective_config_test.ts tests/fixtures/biome-effective-probe` | exit 0                                                    |
| Repository gate | `deno task check`                                                                                                                                                                                                                | exit 0                                                    |

## Reference material

- [Biome configuration reference](https://biomejs.dev/reference/configuration/)
- [Biome CLI reference](https://biomejs.dev/reference/cli/)

## Scope

**In scope** (the only implementation artifacts to modify or create):

- `docs/spikes/biome-effective-config.md`
- `scripts/spike_biome_effective_config.ts`
- `scripts/spike_biome_effective_config_node.mjs`
- `scripts/spike_biome_effective_config_test.ts`
- `tests/fixtures/biome-effective-probe/`

**Out of scope**:

- `src/`, `main.ts`, `main_test.ts`, README, manifests, lockfiles, and generated
  npm output.
- Deleting or replacing the current Biome preflight.
- A projectfmt-owned Biome configuration merger.
- General glob changes, including plan 005's Deno work.
- Adding dependencies, production flags, or public result fields.

**Administrative exception**:

- `plans/README.md` may be modified only to update plan 007's status cell.
- Ignore that one status-cell edit when checking scope cleanliness; any other
  `plans/README.md` change remains out of scope.

## Git workflow

- Branch: `codex/007-characterize-biome-activation`
- Conventional Commit subject:
  `test(biome): characterize effective tool activation`
- Do not push or open a PR unless instructed.

## Steps

### Step 1: Record the post-prerequisite baseline and candidate mechanisms

Create `docs/spikes/biome-effective-config.md`. Record the installed Biome
version, the landed plan-002/004/006 behavior, and the exact default,
format-only, and lint-only contracts. List every candidate authoritative surface
to test: tool-specific stdin commands, combined check with structured/verbose
reporters, diagnostic commands such as `rage`, and a project-local supported API
if one is already installed. Do not claim that any candidate is authoritative.

**Verify**:
`rg -n "Installed Biome|Lint-only contract|Candidate mechanisms|Direct check limitation|Decision criteria" docs/spikes/biome-effective-config.md`
→ every required baseline section exists.

### Step 2: Build a read-only effective-configuration probe matrix

Create fixtures covering a base config plus extends, nested/overridden
formatter/linter/assist activation, language-specific enablement, a files-level
force-ignore with an exception, the existing lint-only shape, and successful
input that produces no diagnostics. Implement the probe script without importing
projectfmt internals. Resolve only the already installed project-local Biome
binary, pass source on stdin with the intended virtual path, and capture
command, args, exit code/signal, stdout, stderr, and parsed reporter output
where present. Run each row twice and record whether the evidence is
deterministic.

Create `scripts/spike_biome_effective_config_node.mjs` as an independent Node
harness over the same fixture/candidate row manifest. Resolve the repository's
installed `@biomejs/biome` package and platform binary with `createRequire`,
assert both physical paths remain inside repository projectRoot, and invoke it
with `node:child_process` using shell disabled. It must capture the same
normalized fields, run every row twice, reject destination writes, and emit the
same versioned JSON envelope. Do not import TypeScript or generated npm output.

`--self-test` must emit exactly one JSON document containing `schemaVersion`,
`biomeVersion`, and a row for every fixture/candidate pair; it exits nonzero
when a required row is missing or a destination file is created.

**Verify**: `deno run -A scripts/spike_biome_effective_config.ts --self-test` →
stdout is one JSON document, every required row is present twice with stable
classification evidence, and no intended fixture destination is created.

Then run `node scripts/spike_biome_effective_config_node.mjs --self-test` and
require the same row IDs, repeat counts, version, and normalized
classifications.

### Step 3: Preserve the lint-only contract in executable characterization

In `scripts/spike_biome_effective_config_test.ts`, assert the report schema and
required row count, deterministic repeated observations, no destination writes,
and the exact existing lint-only distinction: default mode may apply the enabled
safe lint fix without formatting, while formatting-only remains unchanged and
ignored. Also prove that a combined direct-check result alone is insufficient if
it cannot distinguish tool activation from an ordinary no-diagnostic success.
Tests must spawn both self-tests and compare normalized Deno/Node results while
ignoring only explicitly listed platform path spellings. Tests must assert
observed facts; they must not encode a guessed production fix.

**Verify**:
`deno test -A scripts/spike_biome_effective_config_test.ts && node scripts/spike_biome_effective_config_node.mjs --self-test`
→ all cross-runtime, determinism, no-write, and lint-only assertions pass; zero
tests or a missing runtime row is not successful.

### Step 4: Make an evidence-backed implementation decision

Evaluate each candidate against all of these criteria: project-local and bounded
execution; authoritative resolution of extends/overrides/language settings and
force-ignore; virtual-stdin support; separate formatter/linter/assist
activation; reliable inactive-versus-empty-success classification; deterministic
Deno and Node invocation; no destination writes; and preservation of
syntax-error and lint-only contracts.

End the document with exactly one decision:

- `Decision: viable` — name the authoritative mechanism and outline a separate
  production implementation plan with exact files, compatibility risks, and
  regression fixtures;
- `Decision: conditional` — identify the missing proof and a bounded next probe;
  or
- `Decision: no stable mechanism` — retain current production behavior for now,
  document its limitations, and list the public-contract decision needed next.

Do not implement the decision in this plan. If the decision is `viable`, the
follow-up outline must explicitly preserve the lint-only contract and reject the
known-invalid “delete preflight and rely on one combined check” shortcut. A
candidate may be `viable` only when the Deno and Node matrices agree; absent or
unexplained Node evidence forces `conditional` or `no stable mechanism`.

**Verify**:
`rg -n "Decision: (viable|conditional|no stable mechanism)|Evidence matrix|Lint-only compatibility|Implementation follow-up|Deferred alternatives" docs/spikes/biome-effective-config.md`
→ one decision and a bounded follow-up are recorded.

### Step 5: Run spike and repository gates

Run the dedicated probe test, formatting check, and normal repository gate. Do
not run a production implementation or edit generated npm output.

**Verify**:
`deno test -A scripts/spike_biome_effective_config_test.ts && node scripts/spike_biome_effective_config_node.mjs --self-test && deno fmt --check docs/spikes/biome-effective-config.md scripts/spike_biome_effective_config.ts scripts/spike_biome_effective_config_node.mjs scripts/spike_biome_effective_config_test.ts tests/fixtures/biome-effective-probe && deno task check`
→ all commands exit 0.

## Test plan

- Every candidate mechanism receives the same extends/override/tool/ignore rows.
- Repeated probes demonstrate deterministic evidence or explicitly reject the
  candidate.
- Deno and Node execute the same row manifest and agree on normalized outcomes.
- The exact existing lint-only and format-only outcomes remain characterized.
- Empty-success, inactive, ignored, malformed, and processed outcomes are not
  collapsed without evidence.
- No probe creates or overwrites a virtual destination.

## Done criteria

- [ ] A reproducible evidence matrix and exactly one decision exist.
- [ ] The lint-only contract is explicitly tested and preserved.
- [ ] A viable decision includes matching Deno and Node evidence for every row.
- [ ] No production source, public docs, manifest, or lockfile changed.
- [ ] The decision says whether a separate implementation plan is required
      before downstream adapter/performance work proceeds.
- [ ] `deno test -A scripts/spike_biome_effective_config_test.ts` runs at least
      one test and exits 0.
- [ ] `deno task check` exits 0.
- [ ] Only in-scope artifacts and the optional plan-007 status cell changed;
      verify with `git status --short` and `git diff -- plans/README.md`.
- [ ] `plans/README.md` marks this characterization DONE unless the reviewer
      owns the index; DONE does not mean a production fix landed.

## STOP conditions

Stop and report if:

- Plans 002, 004, or 006 are not present, or their landed contracts cannot be
  reconciled with this plan after the prerequisite rebase.
- A verification fails twice after one focused correction.
- The spike requires a production-source, public-doc, manifest, lockfile, or new
  dependency change.
- A probe requires installing/downloading at runtime, searching above
  projectRoot, or writing the intended destination.
- No candidate can distinguish tool inactivity from empty success while
  preserving the lint-only and syntax-error contracts; record the evidence and
  choose `no stable mechanism` rather than guessing.
- Results differ by platform or runtime in a way the matrix cannot explain.

## Maintenance notes

- This plan characterizes the finding; it does not fix it. If production work is
  recommended, create and approve a separate numbered implementation plan before
  treating effective Biome activation as resolved or running dependent work that
  assumes it is resolved.
- Re-run the matrix when the supported Biome major changes.
- Never replace the lint-only preflight with a combined direct check unless a
  future authoritative contract proves equivalent behavior.
