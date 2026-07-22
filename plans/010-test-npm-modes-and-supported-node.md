# Plan 010: Test npm loading modes and supported Node releases

> **Executor instructions**: Follow this plan in order and run every
> verification command. Stop and report instead of improvising when a STOP
> condition occurs. Update this plan's row in `plans/README.md` when done unless
> a reviewer maintains the index.
>
> **Drift check (run first)**:
> `git diff --stat 5ff23b4..HEAD -- scripts/build_npm.ts scripts/test_npm.ts scripts/test_ci_config.ts scripts/node_process_harness.ts scripts/node_coverage.mjs .github/actions/setup/action.yml .github/workflows/tests.yml CONTRIBUTING.md AGENTS.md deno.json deno.lock`
>
> **Prerequisite rebase (required)**: Execute only after plans 003, 006, and 009
> are DONE and their commits are present on the working branch. Preserve plan
> 003's `--test-internals` npm build mode, generated process harness, and
> coverage-task wiring. Reuse plan 006's pinned `@std/yaml` alias and lockfile
> without running `deno add` again. Preserve plan 009's immutable-SHA edits to
> `.github/actions/setup/action.yml` and `.github/workflows/tests.yml`. Those
> changes are expected and must not trigger a drift STOP or be restored to the
> snapshot below. Re-read the live scripts, task graph, lockfile, and pinned
> YAML before editing. Stop only if the landed structures cannot support the
> engine, smoke, input, and matrix changes described here.

## Status

- **Priority**: P2
- **Effort**: M
- **Risk**: MED
- **Depends on**: plans/003-handle-subprocess-stdin-errors.md,
  plans/006-align-config-discovery.md, plans/009-pin-github-actions.md
- **Category**: migration
- **Planned at**: commit `5ff23b4`, 2026-07-22

## Why this matters

The generated package advertises both ESM import and CommonJS require targets,
but release checks only execute ESM. It also declares Node 20 even though that
line is EOL while CI runs only Node 22. Exercise both module systems from the
packed artifact and make the supported floor an intentional, tested Node 22+
contract.

## Current state

- `build_npm.ts` emits `type: module` with import/require exports and engines
  `>=20`.
- `test_npm.ts` verifies the require file exists but runs only smoke.mjs.
- Node coverage imports ../npm/esm/main.js directly.
- The setup action installs Node 22 for every job.

```ts
// scripts/build_npm.ts:48-70
package: {
  name: "projectfmt",
  type: "module",
  // ...
  engines: { node: ">=20.0.0" },
}
```

```ts
// scripts/test_npm.ts:47-58
for (const target of [
  packageJson.types,
  packageJson.exports["."].types,
  packageJson.exports["."].import,
  packageJson.exports["."].require,
]) {
  if (!(await Deno.stat(join(npmDirectory, target))).isFile) throw ...;
}
```

```yaml
# .github/actions/setup/action.yml:11-14
- uses: actions/setup-node@<pinned-sha> # v6
  with:
    node-version: 22
```

Repository constraints to preserve:

- Do not hand-edit or commit generated npm/ output.
- Tests install only the locally packed tarball with npm --offline.
- Keep Deno 2 and Node behavior aligned.
- Preserve action pins from plan 009.

## Commands you will need

| Purpose             | Command                                                                                              | Expected on success                        |
| ------------------- | ---------------------------------------------------------------------------------------------------- | ------------------------------------------ |
| Frozen install      | `deno install --frozen`                                                                              | exit 0 with no lock drift                  |
| CI config contract  | `deno task test:ci-config`                                                                           | parsed input/matrix/wiring assertions pass |
| Action pin contract | `! rg -n --pcre2 '^\s*(?:-\s*)?uses:\s+(?!\./)(?![^@\s]+@[0-9a-f]{40}\s+#\s+v[0-9]+\s*$).+' .github` | no mutable external action ref             |
| Build npm           | `deno task build:npm`                                                                                | exit 0                                     |
| Packed smoke        | `deno task test:npm`                                                                                 | ESM and CJS pass                           |
| Package gate        | `deno task test:packages`                                                                            | JSR and npm pass                           |
| Full gate           | `deno task check && deno task coverage`                                                              | both exit 0                                |

## Reference material

- [Node release status](https://nodejs.org/en/about/previous-releases)

## Scope

**In scope** (the only files to modify):

- `scripts/build_npm.ts`
- `scripts/test_npm.ts`
- `scripts/test_ci_config.ts`
- `.github/actions/setup/action.yml`
- `.github/workflows/tests.yml`
- `CONTRIBUTING.md`
- `AGENTS.md`
- `deno.json`

**Out of scope**:

- Generated npm/ files.
- Continued Node 20 support.
- Package names, export shape, peer dependencies, or Deno support.
- Changing action pins.
- Changing dependency versions or `deno.lock`; reuse plan 006's pinned
  `@std/yaml` alias.
- Changing `scripts/node_coverage.mjs` or `scripts/node_process_harness.ts`;
  retain plan 003's generated-ESM and test-only-harness coverage.
- README and release documentation, which contain no Node-version floor to edit.

**Administrative exception**:

- `plans/README.md` may be modified only to update plan 010's status cell.
- Ignore that one status-cell edit when checking scope cleanliness; any other
  `plans/README.md` change remains out of scope.

## Git workflow

- Branch: `codex/010-test-npm-modes-and-supported-node`
- Conventional Commit subject:
  `test(npm): cover module modes and supported nodes`
- Do not push or open a PR unless instructed.

## Steps

### Step 1: Add a CommonJS consumer smoke

After installing the packed tarball, create `smoke.cjs`. Use
`require("projectfmt")`, then exercise formatSource and resolveFormatter with
formatter none plus one project-local formatter path. Run it beside smoke.mjs
and fail on any require/export mismatch.

**Verify**: `deno task build:npm && deno task test:npm` → one packed tarball
passes both smoke programs

### Step 2: Raise and document the supported floor

Change npm engines, `CONTRIBUTING.md`, and `AGENTS.md` from Node 20 to Node 22
or newer. Do not edit files that contain no version-floor claim and do not add
runtime version checks to library code.

**Verify**:
`! rg -n "Node 20|>=20\.0\.0|node-version:\s*['\"]?20" scripts/build_npm.ts CONTRIBUTING.md AGENTS.md .github`
→ exit 0 with no stale support claim

### Step 3: Add a parsed CI-configuration contract test

Plan 006 must already have added and locked the `@std/yaml` import. Confirm it
without changing the manifest or lockfile:

```sh
deno eval '
const denoJson = JSON.parse(await Deno.readTextFile("deno.json"));
const yaml = denoJson.imports?.["@std/yaml"];
if (typeof yaml !== "string" || !/^jsr:@std\/yaml@/.test(yaml)) {
  throw new Error("plan 006 pinned @std/yaml import is missing");
}
'
```

If this assertion fails, STOP and rebase plan 006; do not run `deno add` in this
plan. Add a `test:ci-config` task to `deno.json` that runs
`scripts/test_ci_config.ts` with read permission limited to `.github`, and
include that task in the normal `check` chain. The script must import the
existing `@std/yaml` alias and parse—not regex-scan—the two YAML files.

Use explicit object/array assertions and fail with a named message for each of
these target contracts:

- parsed `inputs["node-version"].default` is exactly `"22"`;
- the parsed step whose `uses` value matches `actions/setup-node@[0-9a-f]{40}`
  has `with["node-version"] === "${{ inputs.node-version }}"`;
- parsed `jobs["npm-smoke"].strategy.matrix["node-version"]` is deeply equal to
  `[22, 24, 26]`, in that order, covering both maintained LTS lines and the
  Current release claimed by `engines >=22`;
- the local-setup step in `jobs["npm-smoke"].steps` has
  `with["node-version"] === "${{ matrix.node-version }}"`;
- the smoke job's parsed `run` values include the exact commands
  `deno task build:npm` and `deno task test:npm`;
- `jobs.checks` still runs the exact commands `deno task check:ci` and
  `deno task test:packages`; and
- `jobs.platforms` retains matrix OS values `["macos-latest", "windows-latest"]`
  and the exact run command `deno task check`.

The validator may use a regular expression on the already parsed `uses` scalar
to validate its SHA shape; it must not regex-scan YAML source. The existing
alias and lockfile must be materialized by the normal frozen install.

**Verify**: `deno check scripts/test_ci_config.ts && deno install --frozen` →
the validator type-checks and the newly updated lockfile is frozen

### Step 4: Add a maintained-runtime CI matrix

Add a node-version input to the pinned composite setup action with default
`"22"`. Keep full checks on Node 22 and add an Ubuntu `npm-smoke` job with a
matrix for Node 22, 24, and 26. Build and test npm per job without duplicating
the full platform suite. Record the official Node release-status page and audit
date beside the matrix contract so the Current line cannot silently age out.

**Verify**: `deno task test:ci-config` → parsed YAML assertions prove the input,
exact matrix values, expression wiring, pinned setup-node ref, smoke commands,
and retained jobs

### Step 5: Keep coverage and package smoke complementary

Retain plan 003's `--test-internals` coverage build, generated process harness,
and direct generated-ESM public API coverage. `test_npm` owns packed ESM/CJS
compatibility; `node_coverage` owns behavioral breadth. Do not edit either
out-of-scope coverage script or replace the coverage task while changing
`build_npm.ts` and `deno.json`.

**Verify**: `deno task coverage && deno task test:packages` → both exit 0

### Step 6: Run local gates

Run all available local checks. State in the future PR that Node 22/24/26 matrix
execution is CI verification.

**Verify**:
`! rg -n --pcre2 '^\s*(?:-\s*)?uses:\s+(?!\./)(?![^@\s]+@[0-9a-f]{40}\s+#\s+v[0-9]+\s*$).+' .github && deno install --frozen && deno task test:ci-config && deno task check && deno task coverage && deno task test:packages`
→ all commands exit 0

## Test plan

- Packed tarball loads via import.
- The same tarball loads via require.
- Both consumers execute disabled resolution and one formatter path.
- CI npm smoke runs on Node 22, 24, and 26.
- Parsed YAML assertions prove the matrix values and expression wiring rather
  than merely finding matching tokens.
- All engine/docs claims say Node 22+.

## Done criteria

- [ ] The require target is executed, not only statted.
- [ ] No check claims Node 20 support.
- [ ] `deno task test:ci-config` parses both YAML files and exits 0.
- [ ] Plan 006's pinned `@std/yaml` alias is reused without `deno.lock` changes,
      and `deno install --frozen` exits 0.
- [ ] Plan 009's exhaustive inverse scan still finds no mutable or malformed
      external action reference.
- [ ] Generated npm output remains ignored.
- [ ] `deno task check` exits 0.
- [ ] Only in-scope files and the optional plan-010 status cell changed; verify
      with `git status --short` and `git diff -- plans/README.md`.
- [ ] `plans/README.md` marks this plan DONE unless the reviewer owns the index.

## STOP conditions

Stop and report if:

- After rebasing plans 003, 006, and 009, the live build/task/workflow
  structures cannot support the described changes; expected harness, dependency,
  task, lockfile, and SHA-pin drift is not itself a STOP.
- Plan 006's pinned `@std/yaml` alias is absent or incompatible; do not add or
  upgrade it here.
- A verification fails twice after one focused correction.
- The implementation requires an out-of-scope file.
- dnt CommonJS cannot load on Node 22; report the generated error before
  changing exports.
- The owner requires Node 20; restore the floor and add a Node 20 job.
- Matrix jobs would overwrite shared artifacts.

## Maintenance notes

- Review the minimum Node version when a supported line reaches EOL.
- Keep installed-package smoke separate from direct generated-source coverage.
