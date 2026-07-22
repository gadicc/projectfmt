# Plan 011: Canonicalize symlinked package boundaries

> **Executor instructions**: Follow this plan in order and run every
> verification command. Stop and report instead of improvising when a STOP
> condition occurs. Update this plan's row in `plans/README.md` when done unless
> a reviewer maintains the index.
>
> **Drift check (run first)**:
> `git diff --stat 5ff23b4..HEAD -- src/package.ts src/package_test.ts src/path.ts main_test.ts`
>
> **Prerequisite rebase (required)**: Execute only after plan 001 is DONE and
> its commit is present on the working branch. Plan 001's changes to
> `src/path.ts` and `main_test.ts` are expected. Under the default numeric
> execution order, preserve all additional completed-plan changes from plans
> 002–007, especially plan 006's `src/path.ts` work and the accumulated
> `main_test.ts` cases. None of that expected drift is a STOP by itself. Re-read
> the live normalization contract and place new tests into the landed suite
> structure. The excerpts below are reference-only; stop only if completed work
> changed lexical public paths or package-resolution assumptions incompatibly.

## Status

- **Priority**: P2
- **Effort**: M
- **Risk**: MED
- **Depends on**: plans/001-reject-root-as-file.md
- **Category**: bug
- **Planned at**: commit `5ff23b4`, 2026-07-22

## Why this matters

Explicit roots remain lexical while Node package resolution generally returns
physical real paths. Opening a genuine project through a symlink therefore makes
its own formatter look outside the boundary. Compare canonical existing paths
for containment while preserving lexical paths in public diagnostics.

## Current state

- `normalizePaths` resolves lexical paths but does not realpath an explicit
  root.
- `resolveProjectPackage` compares require.resolve output with that lexical
  root.
- Prettier and Biome use this helper for project-local implementation checks.

```ts
// src/package.ts:5-22
const require = createRequire(
  pathToFileURL(join(fromDirectory, "__projectfmt_resolve__.cjs")),
);
const resolved = require.resolve(specifier);
const fromRoot = relative(projectRoot, resolved);
if (
  fromRoot === ".." || fromRoot.startsWith(`..${sep}`) || isAbsolute(fromRoot)
) return null;
return resolved;
```

```ts
// src/path.ts:85-90
const target = isAbsolute(filePath)
  ? resolve(filePath)
  : resolve(projectRoot!, filePath);
const root = projectRoot === undefined
  ? (await inferProjectRoot(target)).root
  : resolve(projectRoot);
```

Repository constraints to preserve:

- Public filePath/projectRoot/evidence/error paths remain lexical.
- A package symlink whose target escapes the physical root stays unavailable.
- Virtual destination files need not exist.
- Use Windows junction semantics or an explicit platform guard.

## Commands you will need

| Purpose             | Command                                         | Expected on success           |
| ------------------- | ----------------------------------------------- | ----------------------------- |
| Package tests       | `deno test -A src/package_test.ts`              | local and escaping cases pass |
| Adapter test        | `deno test -A main_test.ts`                     | full integration file passes  |
| Full gate           | `deno task check`                               | exit 0                        |
| Node/package parity | `deno task coverage && deno task test:packages` | both exit 0                   |

## Scope

**In scope** (the only files to modify):

- `src/package.ts`
- `src/package_test.ts`
- `main_test.ts`

**Out of scope**:

- Canonicalizing public diagnostics.
- Treating projectRoot as a sandbox.
- Root-cache behavior.
- Following package targets outside the physical root.

**Administrative exception**:

- `plans/README.md` may be modified only to update plan 011's status cell.
- Ignore that one status-cell edit when checking scope cleanliness; any other
  `plans/README.md` change remains out of scope.

## Git workflow

- Branch: `codex/011-canonicalize-symlinked-roots`
- Conventional Commit subject: `fix(resolve): support symlinked project roots`
- Do not push or open a PR unless instructed.

## Steps

### Step 1: Add physical-containment unit fixtures

Create a temporary physical project with a minimal resolvable package, expose it
through a directory symlink/junction, and assert resolveProjectPackage succeeds.
Create a second package symlink to an outside target and assert null. Do not
install packages.

**Verify**: `deno test -A src/package_test.ts` → the baseline exits nonzero only
because the descriptively named local-package-through-symlinked-root assertion
fails; the outside-target escape assertion remains green. Record that expected
failure before Step 2. A zero-test run, compile error, or unrelated failure is
not the expected baseline.

### Step 2: Canonicalize only containment

Use node:fs realpathSync or equivalent on the existing project root and resolved
implementation before relative containment. Keep createRequire rooted at
caller/config location and return the resolved path. Missing/unreadable paths
still return null.

**Verify**: `deno test -A src/package_test.ts` → symlink root succeeds and
escaping target fails

### Step 3: Add an adapter-level regression

Use a minimal temporary Prettier-compatible package under a physical root,
access it through the symlinked root, and assert selection/probe/format succeeds
while resolution.projectRoot remains lexical.

**Verify**: `deno test -A main_test.ts` → the full BDD file runs and passes,
including the new adapter case; do not use a nested-test filter that can select
zero tests

### Step 4: Run platform-sensitive gates

Run all local gates and ensure Windows uses a junction or a precise skip without
weakening escape coverage elsewhere.

**Verify**: `deno task check && deno task coverage && deno task test:packages` →
all exit 0

## Test plan

- Local physical package resolves through a symlinked root.
- Escaping package symlink is rejected.
- Public projectRoot remains lexical.
- Missing package returns null.

## Done criteria

- [ ] Containment compares canonical existing paths.
- [ ] No public path is rewritten.
- [ ] Escape rejection has a regression.
- [ ] `deno task check` exits 0.
- [ ] Only in-scope files and the optional plan-011 status cell changed; verify
      with `git status --short` and `git diff -- plans/README.md`.
- [ ] `plans/README.md` marks this plan DONE unless the reviewer owns the index.

## STOP conditions

Stop and report if:

- After rebasing plan 001 and all completed earlier plans, the live
  lexical-path/package contract cannot support this plan; expected landed edits
  are not themselves a STOP.
- A verification fails twice after one focused correction.
- The implementation requires an out-of-scope file.
- Canonicalization requires the virtual intended file to exist.
- Windows cannot create a safe junction/test guard.
- A proposal accepts outside-root package targets.

## Maintenance notes

- Keep canonical paths private to containment.
- If resolution becomes async, migrate realpath and tests together.
