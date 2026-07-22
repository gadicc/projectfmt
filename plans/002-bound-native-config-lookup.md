# Plan 002: Bound formatter-owned configuration lookup to projectRoot

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving on. If a
> STOP condition occurs, stop and report; do not improvise. When finished,
> update this plan's row in `plans/README.md` unless a reviewer says they
> maintain the index.
>
> **Drift/rebase check (run first)**:
> `git diff --stat 5ff23b4..HEAD -- src/adapters/prettier.ts src/adapters/biome.ts src/adapters/biome_test.ts src/adapters/deno.ts src/projectfmt.ts src/types.ts main_test.ts scripts/node_coverage.mjs tests/fixtures README.md`
> First inspect `plans/README.md` and the diffs of any completed lower-numbered
> plan or explicit prerequisite. Treat those documented changes as the new
> baseline and rebase excerpts and line references rather than stopping. An
> in-scope change not explained by completed plan work, or a semantic conflict
> that remains after rebasing, is a STOP condition.

## Status

- **Priority**: P1
- **Effort**: L
- **Risk**: MED
- **Depends on**: plans/001-reject-root-as-file.md
- **Category**: security
- **Planned at**: commit `5ff23b4`, 2026-07-22

## Why this matters

projectfmt promises that projectRoot bounds discovery, but each native formatter
can perform a second upward search after selection. That allows unreported
parent policy to affect output; Prettier can also import an executable
JavaScript config above the trusted boundary. Every adapter must receive an
exact in-boundary configuration or an explicit instruction not to auto-discover
one.

## Current state

- `projectfmt.ts` falls back to `projectRoot` as configRoot for explicit
  selection with no evidence.
- Prettier calls resolveConfig without a config path when none was discovered
  and enables EditorConfig.
- Biome gets only cwd; Deno omits both --config and --no-config and leaves
  EditorConfig enabled.

```ts
// src/projectfmt.ts:68-80
const candidate = candidates.find((item) => item.formatter === requested);
const configRoot = candidate?.configRoot ?? projectRoot;
return await finalize({ adapter, requested, projectRoot, filePath, configRoot, ... });
```

```ts
// src/adapters/prettier.ts:93-98
const configPath = closestConfigPath(context);
const config = await prettier.resolveConfig(context.filePath, {
  ...(configPath ? { config: configPath } : {}),
  editorconfig: true,
  useCache: false,
}) ?? {};
```

```ts
// src/adapters/deno.ts:125-127
const args = ["fmt", "--ext", extension];
if (configPath) args.push("--config", configPath);
args.push("-");
```

Repository constraints to preserve:

- `projectRoot` is a discovery and module-resolution boundary, not a general
  sandbox; this plan only prevents formatter-owned upward config search.
- Do not create a temporary destination file.
- Preserve project-local plugins/binaries as trusted code and preserve
  structured failures.
- Prettier and Deno remain format-only; Biome remains safe check --write by
  default.

## Commands you will need

| Purpose            | Command                                             | Expected on success                                                    |
| ------------------ | --------------------------------------------------- | ---------------------------------------------------------------------- |
| Formatting suite   | `deno test -A main_test.ts --filter "formatSource"` | the existing top-level formatting suite and new containment cases pass |
| Biome temp helper  | `deno test -A src/adapters/biome_test.ts`           | generated-config success/failure cleanup cases pass                    |
| Full Deno gate     | `deno task check`                                   | exit 0                                                                 |
| Node coverage      | `deno task coverage`                                | exit 0                                                                 |
| Package validation | `deno task test:packages`                           | exit 0                                                                 |

## Reference material

- [Prettier resolveConfig API](https://prettier.io/docs/api)
- [Biome CLI configuration](https://biomejs.dev/reference/cli/)
- [Deno fmt configuration](https://docs.deno.com/runtime/reference/cli/fmt/)

## Scope

**In scope** (the only files to modify):

- `src/adapters/prettier.ts`
- `src/adapters/biome.ts`
- `src/adapters/biome_test.ts`
- `src/adapters/deno.ts`
- `src/projectfmt.ts`
- `src/types.ts`
- `main_test.ts`
- `scripts/node_coverage.mjs`
- `tests/fixtures`
- `README.md`

**Out of scope**:

- Changing formatter ranking, precedence, or availability fallback.
- Implementing a filesystem sandbox or distrusting in-boundary executable
  config.
- Biome extends/override evaluation beyond containment (plan 007).
- Persistent caching of configuration or availability.

**Administrative exception**:

- `plans/README.md` may be modified only to update plan 002's status row. No
  other plan or index content may be changed.

## Git workflow

- Branch: `codex/002-bound-native-config-lookup`
- Use Conventional Commits; suggested final subject:
  `fix(security): bound formatter configuration lookup`
- Keep commits limited to this plan. Do not push or open a PR unless instructed.

## Steps

### Step 1: Add parent-configuration containment fixtures

Create a separate temporary parent/child tree for explicit Prettier, Biome, and
Deno selection. In each tree the child is `projectRoot`, contains no formatter
config, and has the parent configuration immediately above it. Keep every tree
under a `try/finally` and assert the tree is absent after cleanup.

Exercise real, network-free project-local implementations:

- Recursively copy the physical locked `node_modules/prettier` package into the
  Prettier child at `node_modules/prettier`; do not leave a symlink back to the
  repository because package containment would correctly reject it.
- For Biome, recursively copy the physical locked `@biomejs/biome` package into
  `child/node_modules/@biomejs/biome`. Resolve the platform/architecture package
  candidate selected by the adapter's existing table, dereference its repository
  symlink, and copy that package into its canonical
  `child/node_modules/@biomejs/<cli-package>` location. Assert the resolved CLI
  path is physically inside the child before formatting. If no matching locked
  platform package is materialized, STOP rather than install or download one.
- Deno continues to use the already available executable on PATH.

Use static parent configuration whose only observable effect is distinctive
style; no fixture should perform side effects. Never install, fetch, or link to
an implementation outside the temporary child.

**Verify**: `deno test -A main_test.ts --filter "formatSource"` → the top-level
formatting suite runs and exits nonzero on the baseline only because the
descriptively named above-root containment cases observe the parent style.
Record those expected assertion failures before moving on; step 3 reruns this
same suite and requires it to pass.

### Step 2: Carry the selected configuration explicitly

Make the chosen candidate/config evidence unambiguous in the internal adapter
context. Config lookup helpers must select evidence for the chosen formatter at
`configRoot`, not merely the first matching item anywhere in the evidence array.
Explicit selection with no in-boundary evidence must be represented distinctly
from “use native auto-discovery.”

**Verify**: `deno task typecheck` → exit 0; custom adapter context remains
backward compatible

### Step 3: Disable native upward search per adapter

Prettier: call `resolveConfig` only when an exact discovered config exists;
otherwise use empty options, and set `editorconfig:false`. Deno: pass exact
`--config` or `--no-config`, and always use `--no-editorconfig` until bounded
EditorConfig support exists.

Biome must use one of two explicit paths and never point `--config-path` at a
configless project directory (the locked CLI rejects that form):

1. With discovered in-boundary configuration, pass that exact file to
   `--config-path` and pass `--use-editorconfig=false`.
2. With no discovered configuration, create a unique directory under the OS
   temporary directory, write a generated `biome.json` containing only `{}`,
   pass that exact generated file to `--config-path`, and pass
   `--use-editorconfig=false`. Implement this with APIs shared by Deno and the
   dnt package: `mkdtemp`, `writeFile`, and recursive forced `rm` from
   `node:fs/promises`, `tmpdir` from `node:os`, and `join` from `node:path`. Do
   not use `Deno.makeTempDir`, `Deno.writeTextFile`, or `Deno.remove`; the npm
   build deliberately has `shims.deno=false`. The generated config is trusted
   library data and deliberately outside both the destination tree and
   `projectRoot`; it is not discovery evidence and must not appear in public
   resolution fields. Wrap the command in `try/finally` and recursively remove
   the generated directory after success, nonzero exit, signal, or thrown
   process error. Never create a temporary source or destination file.

Implement the generated-config lifetime through a small internal callback helper
in `src/adapters/biome.ts`. Exercise that helper directly from
`src/adapters/biome_test.ts`: capture the generated path inside the callback,
assert the file exists and contains the fixed empty object, then assert its
directory is gone after both a successful callback and a deliberately throwing
callback. Keep the helper internal to the generated module; do not export it
from `main.ts`.

In `scripts/node_coverage.mjs`, add a serial public configless-Biome formatting
call. Give that test a dedicated OS temp parent by setting `TMPDIR`, `TMP`, and
`TEMP`, retain and restore all three previous values in `try/finally`, and
assert no directory with the helper's fixed prefix remains before removing the
dedicated parent. This verifies the production dnt path and cleanup across
Node's POSIX and Windows temp-directory selection without exposing the helper or
relying on incidental generated internal modules.

**Verify**:
`deno test -A src/adapters/biome_test.ts && deno test -A main_test.ts --filter "formatSource" && deno task coverage`
→ direct cleanup succeeds on both paths, the existing top-level formatting suite
runs, all three adapters ignore configuration above the explicit root, and the
generated Node package passes its configless cleanup case

### Step 4: Document the bounded EditorConfig behavior

Update the formatter behavior and security sections to say native upward
configuration and EditorConfig lookup are disabled beyond projectRoot. If
in-boundary EditorConfig is not preserved by the safe implementation, document
that limitation explicitly rather than implying it is honored.

**Verify**: `deno task doclint && deno fmt --check README.md` → both commands
exit 0

### Step 5: Run the complete compatibility gates

Run all Deno, generated Node, and package checks. Confirm no fixture creates
network access or leaves copied packages outside temporary directories.

**Verify**: `deno task check && deno task coverage && deno task test:packages` →
all commands exit 0

## Test plan

- Parent prettier.config.mjs is neither loaded nor reflected in output.
- Parent biome.json does not affect explicit nested-root formatting.
- Parent deno.json and .editorconfig do not affect explicit nested-root
  formatting.
- An exact in-boundary config still applies for every built-in adapter.
- Explicit selection with no config still uses safe formatter defaults or
  reports a documented limitation.
- Biome's generated empty config directory is removed after successful and
  failing formatter calls, and no destination path is ever created.
- The generated Node package completes configless Biome formatting and leaves no
  generated config directory in its dedicated temp parent.

## Done criteria

- [ ] Every built-in adapter has a machine-tested no-search-above-root path.
- [ ] Selected config evidence is tied to configRoot, not a global first match.
- [ ] No test installs packages or accesses the network; Prettier, Biome, and
      the matching native Biome package are physical copies inside temporary
      project roots.
- [ ] Configless Biome calls use a generated empty config with unconditional
      `try/finally` cleanup and never create a temporary destination file.
- [ ] The generated-config helper uses Node-compatible filesystem/OS APIs and
      passes the explicit Node coverage cleanup case with `shims.deno=false`.
- [ ] Security and formatter behavior docs match actual EditorConfig behavior.
- [ ] `deno task check` exits 0.
- [ ] Every in-scope source change is covered by the tests named above.
- [ ] No file outside the in-scope list is modified, except the permitted plan
      002 status-row edit in `plans/README.md`; confirm with
      `git status --short`.
- [ ] `plans/README.md` records this plan as DONE (unless maintained by the
      reviewer).

## STOP conditions

Stop and report instead of improvising if:

- After rebasing on completed lower-numbered/prerequisite work, the live code
  still has an unexplained semantic mismatch with this plan's assumptions.
- A verification command fails twice after one focused correction.
- The fix requires modifying a file listed as out of scope.
- The locked Biome CLI rejects an exact generated empty config file, applies
  configuration relative to the intended destination despite that explicit
  config, or leaves a generated directory after the helper's `finally`; record
  the exact behavior and stop.
- The matching materialized Biome platform package cannot be copied into the
  temporary child without an install, network access, or an outside-root
  symlink.
- Bounding Prettier requires importing or evaluating any above-root path.
- Preserving in-boundary EditorConfig would require an unreviewed parser
  dependency; defer it and document the limitation instead.

## Maintenance notes

- Recheck native no-config flags when formatter major versions change.
- Plan 007 should remove remaining manual Biome config interpretation but retain
  the explicit config-path boundary established here.
- A future bounded EditorConfig feature should be separate and must test root
  markers and inheritance explicitly.
