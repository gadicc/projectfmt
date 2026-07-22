# Plan 006: Align configuration discovery and precedence

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving on. If a
> STOP condition occurs, stop and report; do not improvise. When finished,
> update this plan's row in `plans/README.md` unless a reviewer says they
> maintain the index.
>
> **Drift/rebase check (run first)**:
> `git diff --stat 5ff23b4..HEAD -- src/config-names.ts src/path.ts src/adapters/prettier.ts src/adapters/biome.ts src/adapters/discovery.ts main_test.ts tests/fixtures/config-discovery deno.json deno.lock README.md`
> First inspect `plans/README.md` and the diffs of any completed lower-numbered
> plan or explicit prerequisite. Treat those documented changes as the new
> baseline and rebase excerpts and line references rather than stopping. Plans
> 001 and 002 intentionally overlap this plan's path and adapter files; preserve
> their boundary/config-selection contracts while applying the discovery changes
> here. An in-scope change not explained by completed plan work, or a semantic
> conflict that remains after rebasing, is a STOP condition.

## Status

- **Priority**: P1
- **Effort**: M
- **Risk**: MED
- **Depends on**: plans/001-reject-root-as-file.md,
  plans/002-bound-native-config-lookup.md
- **Category**: bug
- **Planned at**: commit `5ff23b4`, 2026-07-22

## Why this matters

Formatter selection is only reliable when discovery recognizes the same
configuration files and same-directory precedence as the formatter release
projectfmt ships against. Current lists omit dotted Biome configs, Prettier TOML
and package.yaml, and place standalone Prettier files ahead of package metadata.
Root inference duplicates the incomplete lists, so nested projects may be missed
entirely.

## Current state

- Prettier configNames omits .prettierrc.toml and package.yaml.
- Standalone Prettier config evidence is appended before package.json#prettier.
- Biome recognizes only biome.json and biome.jsonc.
- path.ts maintains a separate projectMarkers copy of formatter names.

```ts
// src/adapters/prettier.ts:13-31,51-60
const configNames = [".prettierrc", ".prettierrc.json", /* ... */] as const;
return [
  ...await configFileEvidence("prettier", directory, configNames),
  ...await packageEvidence("prettier", directory, { packageKey: "prettier", ... }),
];
```

```ts
// src/adapters/biome.ts:11
const configNames = ["biome.json", "biome.jsonc"] as const;
```

```ts
// src/path.ts:27-58
const projectMarkers = new Set([
  "package.json",
  "deno.json",
  "biome.json",
  "biome.jsonc",
  ".prettierrc", /* duplicated Prettier list */
]);
```

Repository constraints to preserve:

- Selection stays deterministic: nearest directory, strongest evidence, then
  documented adapter precedence.
- Availability must not affect ranking.
- Use maintained TOML/YAML parsing rather than regex extraction when
  package.yaml content must be inspected.
- Built-in behavior requires real fixture coverage.
- Preserve plan 002's exact selected-config/no-upward-search adapter context;
  this plan changes recognized names and same-directory ranking, not the native
  lookup boundary.

## Commands you will need

| Purpose             | Command                     | Expected on success             |
| ------------------- | --------------------------- | ------------------------------- |
| Main fixture suite  | `deno test -A main_test.ts` | all existing and new cases pass |
| Frozen dependencies | `deno install --frozen`     | lockfile and import map agree   |
| Full Deno gate      | `deno task check`           | exit 0                          |
| Node coverage       | `deno task coverage`        | exit 0                          |
| Package validation  | `deno task test:packages`   | exit 0                          |

## Reference material

- [Prettier configuration search order](https://prettier.io/docs/configuration)
- [Biome configuration filenames](https://biomejs.dev/guides/configure-biome/)

## Scope

**In scope** (the only files to modify):

- `src/config-names.ts`
- `src/path.ts`
- `src/adapters/prettier.ts`
- `src/adapters/biome.ts`
- `src/adapters/discovery.ts`
- `main_test.ts`
- `tests/fixtures/config-discovery`
- `deno.json`
- `deno.lock`
- `README.md`

**Out of scope**:

- Native formatter lookup above projectRoot (plan 002).
- Biome extends/overrides semantics (plan 007).
- Changing cross-formatter priority biome > deno > prettier.
- Adding dprint or oxfmt.

**Administrative exception**:

- `plans/README.md` may be modified only to update plan 006's status row. No
  other plan or index content may be changed.

## Git workflow

- Branch: `codex/006-align-config-discovery`
- Use Conventional Commits; suggested final subject:
  `fix(discovery): match formatter config precedence`
- Keep commits limited to this plan. Do not push or open a PR unless instructed.

## Steps

### Step 1: Add a fixture matrix for supported names

Create one compact tests/fixtures/config-discovery tree covering .biome.json,
.biome.jsonc, .prettierrc.toml, package.yaml#prettier, and a same-directory
package.json#prettier plus standalone Prettier config conflict. Assert discovery
evidence paths, inferred roots, configRoot, and selected output where practical.

**Verify**: `deno test -A main_test.ts` → the full fixture suite runs and exits
nonzero on the baseline because the descriptively named supported-name,
root-inference, or same-directory-precedence assertions expose the documented
gaps. Record those expected assertion failures before moving on; a zero-test run
or unrelated failure is not the expected baseline.

### Step 2: Centralize canonical config names

Create `src/config-names.ts` with exported readonly filename/search-order
constants for the currently recognized built-in names and a derived collection
of unconditional project-marker filenames. Import these constants from adapters
and `path.ts`; remove duplicated literal lists without adding the newly
supported names yet. Keep Deno names in the same module so future adapter
additions have one marker source. Metadata files whose contents decide whether
they are formatter evidence (notably `package.yaml`) must remain outside the
unconditional marker set and use the shared content predicate added in step 3.
Steps 3 and 4 then extend only this canonical source, which makes each behavior
change attributable and keeps the intermediate state coherent.

**Verify**: `deno task typecheck` → exit 0 and no adapter/path circular import

### Step 3: Implement Prettier metadata forms and precedence

Discover package.json and package.yaml Prettier keys before standalone files in
the exact documented same-directory search order. Unless a completed earlier
plan already added the same alias, run `deno add jsr:@std/yaml` so `deno.json`
contains the `@std/yaml` import and `deno.lock` freezes the resolved release; do
not hand-write or float a second YAML dependency. Run `deno install --frozen`
afterward to prove the import map and lock agree.

Use `parse` from `@std/yaml` in one shared `package.yaml` predicate consumed by
both Prettier discovery and project-root inference. Accept only a parsed,
non-null, non-array object with an own `prettier` property whose value is
truthy, matching the locked Prettier search filter. An unrelated YAML object, a
falsey `prettier` value, a scalar/array document, or a YAML parse error produces
no Prettier evidence and is not a project marker; do not throw during discovery
or infer a root from the filename alone. Once the predicate accepts the file,
retain the actual `package.yaml` path as strength-30 config evidence so the
adapter passes it to Prettier and Prettier remains authoritative for validating
the config value. Do not infer the key with a line regex.

Keep scripts/dependencies as weaker evidence. Add fixture rows for truthy object
and string `prettier` values, an unrelated document, a falsey value, and
malformed YAML, and compare the decisions with the locked Prettier oracle.

**Verify**:
`deno install --frozen && deno task typecheck && deno test -A main_test.ts` →
dependency materialization and typechecking pass; the full suite still exits
nonzero, but only the descriptively named dotted-Biome assertions from step 1
remain red. Every Prettier metadata, malformed/unrelated-YAML, root-inference,
and precedence assertion now matches the locked Prettier oracle. Any remaining
Prettier failure is a STOP condition.

### Step 4: Add dotted Biome names and docs

Recognize .biome.json and .biome.jsonc in discovery and inferred-root markers.
Update README resolution examples/behavior to list all supported forms or link
to formatter-native lists without leaving an incomplete hard-coded subset.

**Verify**: `deno test -A main_test.ts` → the full fixture suite runs and exits
0; both descriptively named dotted-filename cases establish the expected nested
configRoot, and all Prettier cases remain green

### Step 5: Run full distribution gates

Because config parsing dependencies and marker exports flow through dnt, run all
Deno and generated npm gates.

**Verify**: `deno task check && deno task coverage && deno task test:packages` →
all commands exit 0

## Test plan

- Each newly supported filename becomes config evidence and a project marker.
- package.json#prettier wins over a same-directory standalone file exactly as
  locked Prettier does.
- package.yaml#prettier is recognized without treating unrelated YAML as
  configuration.
- Malformed, scalar/array, and falsey-key package.yaml files are neither
  Prettier evidence nor inferred-root markers, matching the locked search
  filter.
- Dependency/script evidence retains lower strength.
- Nested dotted Biome configuration wins over outer formatter evidence.

## Done criteria

- [ ] There is one canonical filename/search-order source for adapters and root
      inference.
- [ ] Fixture outcomes match locked Prettier and Biome behavior.
- [ ] Any new parser dependency is frozen and survives npm generation.
- [ ] `@std/yaml` is present under one import alias, and `deno install --frozen`
      succeeds.
- [ ] `deno task check` exits 0.
- [ ] Every in-scope source change is covered by the tests named above.
- [ ] No file outside the in-scope list is modified, except the permitted plan
      006 status-row edit in `plans/README.md`; confirm with
      `git status --short`.
- [ ] `plans/README.md` records this plan as DONE (unless maintained by the
      reviewer).

## STOP conditions

Stop and report instead of improvising if:

- After rebasing on completed lower-numbered/prerequisite work, the live code
  still has an unexplained semantic mismatch with this plan's assumptions.
- A verification command fails twice after one focused correction.
- The fix requires modifying a file listed as out of scope.
- The locked Prettier version's observed search order differs from current
  official documentation; record both and target the locked runtime.
- `@std/yaml` cannot be transformed by dnt or its locked parser behavior differs
  from the truthy-own-key decisions observed from locked Prettier.
- Centralization introduces an adapter/path import cycle.

## Maintenance notes

- Update config-name constants and the fixture matrix together on formatter
  major upgrades.
- Plan 010 should reuse the `@std/yaml` alias rather than adding another YAML
  parser or import spelling.
- Plan 015 should reuse this central registration point when comparing new
  adapters.
