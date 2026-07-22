# Plan 005: Match Deno virtual-file semantics

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving on. If a
> STOP condition occurs, stop and report; do not improvise. When finished,
> update this plan's row in `plans/README.md` unless a reviewer says they
> maintain the index.
>
> **Drift/rebase check (run first)**:
> `git diff --stat 5ff23b4..HEAD -- src/adapters/deno.ts src/adapters/deno_test.ts src/glob.ts src/glob_test.ts main_test.ts tests/fixtures/deno deno.json deno.lock README.md`
> First inspect `plans/README.md` and the diffs of any completed lower-numbered
> plan or explicit prerequisite. Treat those documented changes as the new
> baseline and rebase excerpts and line references rather than stopping. An
> in-scope change not explained by completed plan work, or a semantic conflict
> that remains after rebasing, is a STOP condition.

## Status

- **Priority**: P1
- **Effort**: M
- **Risk**: MED
- **Depends on**: plans/002-bound-native-config-lookup.md,
  plans/003-handle-subprocess-stdin-errors.md
- **Category**: bug
- **Planned at**: commit `5ff23b4`, 2026-07-22

## Why this matters

projectfmt pre-classifies virtual files before invoking deno fmt, so its
include, exclude, glob, and extension rules must agree with the installed Deno
runtime. The current subset misses top-level exclusions, ordered negated
exceptions and brace globs, and it passes aliases or unsupported media types
directly to --ext. These mismatches produce false ignores or avoidable formatter
failures.

## Current state

- Deno ignore handling reads only config.fmt and uses unordered some() checks.
- The shared glob helper strips a leading ! and does not expand braces.
- supportedExtensions mixes CLI values, aliases, unsupported XML/SVG, and
  version-gated formats.
- The repository supports Deno 2 without pinning a minor release; local and CI
  `v2.x` help/capabilities may therefore differ over time.

```ts
// src/adapters/deno.ts:11-43
const supportedExtensions = new Set([
  "js",
  "cjs",
  "mjs",
  "ts",
  "cts",
  "mts",
  "jsx",
  "tsx",
  "md",
  "mkd",
  "mkdn",
  "mdwn",
  "mdown",
  "markdown",
  "json",
  "jsonc",
  "css",
  "html",
  "xml",
  "svg",
  "njk",
  "vto",
  "yml",
  "yaml",
  "scss",
  "less",
  "ipynb",
  "astro",
  "svelte",
  "vue",
  "sql",
]);
```

The excerpt above is the complete current set. Every entry needs an explicit row
in the replacement table; an executor must not silently drop an omitted or
unfamiliar suffix.

```ts
// src/adapters/deno.ts:152-165
const fmt = config.fmt && typeof config.fmt === "object" ? config.fmt : {};
const include = stringArray(fmt.include);
const exclude = stringArray(fmt.exclude);
if (
  include.length > 0 && !include.some((pattern) => matchesGlob(pattern, path))
) return true;
return exclude.some((pattern) => matchesGlob(pattern, path));
```

```ts
// src/glob.ts:2-25
const normalized = pattern.replace(/^!/, "").replace(/^\.\//, "");
// Handles *, **, and ?; braces are escaped as literals.
```

Repository constraints to preserve:

- Support the actual Deno 2 executable selected at runtime rather than assuming
  the development machine's current minor release is pinned.
- Do not use temporary destination files; stdin remains the formatted source.
- Preserve exact config-path and project-boundary behavior from plan 002.
- Tests may invoke Deno but must not install or contact the network.

## Commands you will need

| Purpose                    | Command                                             | Expected on success                                             |
| -------------------------- | --------------------------------------------------- | --------------------------------------------------------------- |
| Formatting suite           | `deno test -A main_test.ts --filter "formatSource"` | the existing top-level formatting suite and all Deno cases pass |
| Deno capability unit tests | `deno test -A src/adapters/deno_test.ts`            | synthetic and current-runtime capability cases pass             |
| Glob unit tests            | `deno test -A src/glob_test.ts`                     | ordered and brace cases pass                                    |
| Full Deno gate             | `deno task check`                                   | exit 0                                                          |
| Node/package parity        | `deno task coverage && deno task test:packages`     | both tasks exit 0                                               |

## Reference material

- [Deno configuration reference](https://docs.deno.com/runtime/reference/deno_json/)
- [Deno fmt CLI reference](https://docs.deno.com/runtime/reference/cli/fmt/)

## Scope

**In scope** (the only files to modify):

- `src/adapters/deno.ts`
- `src/adapters/deno_test.ts`
- `src/glob.ts`
- `src/glob_test.ts`
- `main_test.ts`
- `tests/fixtures/deno`
- `deno.json`
- `deno.lock`
- `README.md`

**Out of scope**:

- Biome ignore/effective-config semantics (plan 007).
- Changing Deno formatter selection evidence or precedence.
- Supporting media types the installed Deno CLI does not accept.
- Cross-call caching.

Plan 005 owns the Deno-compatible behavior added to `src/glob.ts`. Plan 007 is
downstream: it may remove Biome's use of the shared helper, but it must not
revert the Deno matcher or its unit tests. Do not pull plan 007's Biome work
into this plan.

**Administrative exception**:

- `plans/README.md` may be modified only to update plan 005's status row. No
  other plan or index content may be changed.

## Git workflow

- Branch: `codex/005-match-deno-virtual-file-semantics`
- Use Conventional Commits; suggested final subject:
  `fix(deno): match virtual file semantics`
- Keep commits limited to this plan. Do not push or open a PR unless instructed.

## Steps

### Step 1: Build an oracle-backed compatibility table

Add table-driven tests that compare projectfmt behavior with the currently
selected Deno 2 executable for: fmt.include brace globs; top-level and fmt
excludes; and a broad exclude followed by a negated re-include. Store
representative real configs in `tests/fixtures/deno`; direct CLI invocations
must be local, non-mutating, and deterministic.

In `src/adapters/deno_test.ts`, define the complete expected disposition table
for every suffix in the current-state excerpt. Each row must state exactly one
of: canonical `--ext`; alias plus canonical `--ext`; canonical `--ext` plus an
optional runtime-advertised capability flag; or canonical but runtime-gated on
whether `deno fmt --help` advertises that extension. Assert that the table's
keys exactly equal the old set plus any deliberately documented additions, so no
entry disappears unnoticed.

Use this expected table; “optional” means pass the flag when the selected Deno 2
executable advertises it, and treat the format as stabilized when the canonical
extension is advertised but the flag is absent:

| Input suffix | Canonical `--ext` | Optional advertised flag | Disposition   |
| ------------ | ----------------- | ------------------------ | ------------- |
| `js`         | `js`              | —                        | canonical     |
| `cjs`        | `cjs`             | —                        | canonical     |
| `mjs`        | `mjs`             | —                        | canonical     |
| `ts`         | `ts`              | —                        | canonical     |
| `cts`        | `cts`             | —                        | canonical     |
| `mts`        | `mts`             | —                        | canonical     |
| `jsx`        | `jsx`             | —                        | canonical     |
| `tsx`        | `tsx`             | —                        | canonical     |
| `md`         | `md`              | —                        | canonical     |
| `mkd`        | `md`              | —                        | alias         |
| `mkdn`       | `md`              | —                        | alias         |
| `mdwn`       | `md`              | —                        | alias         |
| `mdown`      | `md`              | —                        | alias         |
| `markdown`   | `md`              | —                        | alias         |
| `json`       | `json`            | —                        | canonical     |
| `jsonc`      | `jsonc`           | —                        | canonical     |
| `css`        | `css`             | `--unstable-css`         | canonical     |
| `html`       | `html`            | `--unstable-html`        | canonical     |
| `xml`        | `xml`             | —                        | runtime-gated |
| `svg`        | `svg`             | —                        | runtime-gated |
| `njk`        | `njk`             | —                        | canonical     |
| `vto`        | `vto`             | —                        | canonical     |
| `yml`        | `yml`             | `--unstable-yaml`        | canonical     |
| `yaml`       | `yaml`            | `--unstable-yaml`        | canonical     |
| `scss`       | `scss`            | `--unstable-css`         | canonical     |
| `less`       | `less`            | `--unstable-css`         | canonical     |
| `ipynb`      | `ipynb`           | —                        | canonical     |
| `astro`      | `astro`           | `--unstable-component`   | canonical     |
| `svelte`     | `svelte`          | `--unstable-component`   | canonical     |
| `vue`        | `vue`             | `--unstable-component`   | canonical     |
| `sql`        | `sql`             | `--unstable-sql`         | canonical     |

**Verify**:
`deno test -A src/adapters/deno_test.ts && deno test -A main_test.ts --filter "formatSource"`
→ both files run nonzero tests and exit nonzero on the baseline because the
descriptively named extension or virtual-file oracle assertions expose the
documented mismatches. Record the expected assertion names before moving on; a
parse error, unrelated failure, or zero-test run is not the expected baseline.
Steps 2 and 3 provide the passing gates for their respective behavior.

### Step 2: Implement ordered Deno path evaluation

Replace unordered `some()` exclusion logic with an ordered evaluator that
supports negated exceptions and brace alternatives using Deno-compatible path
bases. Merge applicable top-level and `fmt` include/exclude policy in the same
order Deno uses. If a maintained Deno-standard glob helper is added, pin it in
`deno.json`/`deno.lock`; do not implement a second divergent matcher.

**Verify**: `deno test -A src/glob_test.ts` → brace, directory, ordered
negation, and non-match cases pass

### Step 3: Use an extension-to-invocation map

Replace `supportedExtensions` with the complete disposition table established in
step 1. Map Markdown aliases to `md`. Treat XML/SVG as canonical capability
rows: the local Deno 2.9.3 oracle currently rejects them because its `--ext`
values omit them, while a selected Deno runtime that advertises `xml` or `svg`
must be allowed without a flag. Do not freeze either outcome from the
development runtime.

Do not hard-code capabilities from the executor's Deno minor. Add an internal
helper that runs `deno fmt --help` for the same executable used by the adapter,
parses the advertised `--ext` values and presence of relevant capability flags,
and builds the invocation for this call only:

- If the canonical `--ext` is absent, return the stable unsupported-type error
  before starting the formatter.
- For every row with an optional capability flag, include that table flag when
  the executable advertises it. If the canonical extension is advertised but the
  flag is absent, treat it as stabilized and invoke without the flag.
- If help output cannot be parsed, fail structurally with the Deno version and
  captured diagnostic; do not guess from the local development version and do
  not cache across public calls.

Unit-test the helper with synthetic Deno 2 help text both with and without the
extensions/flags, then run an integration assertion against the actual
`deno fmt --help` output available to the test. No exact Deno minor is assumed.

**Verify**:
`deno test -A src/adapters/deno_test.ts && deno test -A main_test.ts --filter "formatSource"`
→ synthetic compatibility cases pass, the current executable's capability probe
agrees with its help output, the existing top-level formatting suite runs, and
every table row either invokes valid arguments or returns its specified
unsupported diagnostic

### Step 4: Update formatter behavior documentation

Document the canonical alias behavior, ordered exclusions, and any version-gated
Deno formats. Do not claim support for types rejected by the runtime.

**Verify**: `deno fmt --check README.md && deno task doclint` → both commands
exit 0

### Step 5: Run complete gates

Run Deno, Node coverage, and package artifact tests on the finalized
compatibility table.

**Verify**: `deno task check && deno task coverage && deno task test:packages` →
all commands exit 0

## Test plan

- Top-level exclude is honored.
- Broad exclude followed by ! exception re-includes the intended file.
- Brace include such as src/**/*.{ts,tsx} matches both suffixes.
- Markdown aliases map to md.
- XML and SVG fail before process invocation when absent from runtime help and
  invoke canonically when synthetic or future runtime help advertises them.
- Version-gated extensions receive required flags or a stable unsupported
  diagnostic.
- Every extension in the complete current set has an explicit disposition and
  capability requirement.
- Synthetic Deno 2 help variants and the actual runtime help produce reliable
  invocation decisions without a minor-version assumption.

## Done criteria

- [ ] No Deno config is pre-interpreted with unordered exclusion logic.
- [ ] Accepted extension aliases exactly map to valid Deno CLI invocations.
- [ ] The complete previous extension set is accounted for by an exact-key test;
      no suffix is dropped implicitly.
- [ ] Version-gated invocation is derived from the selected Deno 2 executable's
      advertised extensions/flags, not the development minor version.
- [ ] Fixture behavior agrees with direct Deno CLI outcomes.
- [ ] `deno task check` exits 0.
- [ ] Every in-scope source change is covered by the tests named above.
- [ ] No file outside the in-scope list is modified, except the permitted plan
      005 status-row edit in `plans/README.md`; confirm with
      `git status --short`.
- [ ] `plans/README.md` records this plan as DONE (unless maintained by the
      reviewer).

## STOP conditions

Stop and report instead of improvising if:

- After rebasing on completed lower-numbered/prerequisite work, the live code
  still has an unexplained semantic mismatch with this plan's assumptions.
- A verification command fails twice after one focused correction.
- The fix requires modifying a file listed as out of scope.
- Deno workspace config merge order cannot be established from the selected
  runtime's direct oracle behavior and official docs; limit scope to
  nearest-config semantics and report the workspace gap.
- A new glob dependency cannot be transformed by dnt or changes Node behavior.
- Supporting an extension requires enabling an unrelated unstable runtime
  capability.
- The selected Deno 2 executable's help format cannot be parsed without a
  minor-specific guess; report the version/help shape and stop rather than
  hard-coding the executor's runtime.

## Maintenance notes

- Refresh the extension table and oracle cases on every Deno major upgrade.
- Do not reuse this Deno evaluator for Biome. Plan 007 is downstream and may
  delete Biome's dependency on `src/glob.ts`, but must preserve this plan's Deno
  evaluator and tests.
