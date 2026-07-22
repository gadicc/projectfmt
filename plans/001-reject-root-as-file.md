# Plan 001: Reject an intended path equal to projectRoot

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving on. If a
> STOP condition occurs, stop and report; do not improvise. When finished,
> update this plan's row in `plans/README.md` unless a reviewer says they
> maintain the index.
>
> **Drift/rebase check (run first)**:
> `git diff --stat 5ff23b4..HEAD -- src/path.ts src/path_test.ts main_test.ts README.md`
> First inspect `plans/README.md` and the diffs of any completed lower-numbered
> plan or explicit prerequisite. Treat those documented changes as the new
> baseline and rebase excerpts and line references rather than stopping. An
> in-scope change not explained by completed plan work, or a semantic conflict
> that remains after rebasing, is a STOP condition.

## Status

- **Priority**: P1
- **Effort**: S
- **Risk**: LOW
- **Depends on**: none
- **Category**: bug
- **Planned at**: commit `5ff23b4`, 2026-07-22

## Why this matters

An intended destination denotes a file, while projectRoot denotes a directory.
Today equality passes lexical containment and causes discovery to begin in the
parent directory, violating the documented boundary. Rejecting equality and
defensively bounding ancestor traversal prevents all adapters from inspecting
parent manifests or formatter configuration.

## Current state

- `src/path.ts` normalizes paths and accepts an empty relative path when target
  equals root.
- `ancestorDirectories` starts from `dirname(filePath)`; equality therefore
  starts above the root.
- `src/projectfmt.ts` trusts every directory returned by that helper during
  discovery.

```ts
// src/path.ts:85-105
const target = isAbsolute(filePath)
  ? resolve(filePath)
  : resolve(projectRoot!, filePath);
const root = projectRoot === undefined
  ? (await inferProjectRoot(target)).root
  : resolve(projectRoot);
const fromRoot = relative(root, target);
```

```ts
// src/path.ts:276-288
let current = dirname(filePath);
while (true) {
  directories.push(current);
  if (current === projectRoot) return directories;
  const parent = dirname(current);
  if (parent === current) return directories;
  current = parent;
}
```

Repository constraints to preserve:

- Use `FormatterResolutionError` with code `INVALID_OPTIONS` for invalid path
  options.
- Keep support for nonexistent virtual destination files inside the boundary.
- Model tests after the temporary-directory boundary cases in
  `main_test.ts:47-143`.

## Commands you will need

| Purpose             | Command                                                 | Expected on success                                                 |
| ------------------- | ------------------------------------------------------- | ------------------------------------------------------------------- |
| Resolution suite    | `deno test -A main_test.ts --filter "resolveFormatter"` | the existing top-level resolution suite and new boundary cases pass |
| Path helper tests   | `deno test -A src/path_test.ts`                         | direct traversal boundary cases pass                                |
| Typecheck           | `deno task typecheck`                                   | exit 0                                                              |
| Full Deno gate      | `deno task check`                                       | exit 0                                                              |
| Node/package parity | `deno task coverage && deno task test:packages`         | both tasks exit 0                                                   |

## Scope

**In scope** (the only files to modify):

- `src/path.ts`
- `src/path_test.ts`
- `main_test.ts`
- `README.md`

**Out of scope**:

- `src/package.ts` symlink canonicalization (plan 011).
- Automatic root-inference marker precedence and cache semantics.
- Formatter-specific configuration lookup (plan 002).

**Administrative exception**:

- `plans/README.md` may be modified only to update plan 001's status row. No
  other plan or index content may be changed.

## Git workflow

- Branch: `codex/001-reject-root-as-file`
- Use Conventional Commits; suggested final subject:
  `fix(path): reject project root as intended file`
- Keep commits limited to this plan. Do not push or open a PR unless instructed.

## Steps

### Step 1: Add the public regression

Add a `resolveFormatter` test that passes the same absolute path as `filePath`
and `projectRoot`. Assert a `FormatterResolutionError` with code
`INVALID_OPTIONS`; place formatter evidence immediately above the root so the
test would expose any escaped discovery. Keep cleanup in `finally`.

**Verify**: `deno test -A main_test.ts --filter "resolveFormatter"` → the
top-level resolution suite runs and exits nonzero on the baseline because the
descriptively named equality regression observes above-root evidence instead of
`INVALID_OPTIONS`. Record that expected assertion failure before moving on; an
uncaught error or a zero-test run is not the expected baseline.

### Step 2: Reject equality during normalization

In `normalizePaths`, treat `relative(root, target) === ""` as invalid. Use a
message that distinguishes “the intended path must name a file below
projectRoot” from the existing outside-boundary error, and preserve normalized
`filePath`/`projectRoot` fields.

**Verify**:
`deno task typecheck && deno test -A main_test.ts --filter "resolveFormatter"` →
typechecking succeeds, the entire top-level resolution suite runs, and the new
equality regression now passes

### Step 3: Make ancestor traversal defensive

Add a shared lexical containment predicate or equivalent guard so
`ancestorDirectories` cannot add a directory outside `projectRoot`, even if a
future caller bypasses normalization. Preserve nearest-to-root ordering and
inclusion of the root for valid files. Check the starting `dirname(filePath)`
before the first push and return an empty list when it is outside the root;
likewise, never advance to an outside parent. In `src/path_test.ts`, call the
exported helper directly with a valid nested virtual file, equality, and an
outside path. Assert the valid result is exactly nearest-directory through root,
while equality and outside inputs return empty lists and never expose a parent.
Update the README path contract with the equality rule.

**Verify**:
`deno test -A src/path_test.ts && deno test -A main_test.ts --filter "resolveFormatter"`
→ direct helper cases and the existing top-level resolution suite run; valid
nested traversal still passes and equality remains rejected

### Step 4: Run cross-runtime gates

Run the full Deno, generated Node, and package smoke gates. Inspect formatter
output afterward because the repository pre-commit task may format files.

**Verify**: `deno task check && deno task coverage && deno task test:packages` →
all commands exit 0

## Test plan

- Equality of normalized absolute filePath and projectRoot rejects with
  INVALID_OPTIONS.
- A normal nonexistent file directly below projectRoot still resolves.
- An outside path remains rejected by the existing boundary test.
- Discovery includes projectRoot but no ancestor above it.

## Done criteria

- [ ] `relative(projectRoot, filePath) === ""` cannot reach discovery.
- [ ] The regression test proves evidence above `projectRoot` is not read.
- [ ] README documents that the intended path must be a descendant file.
- [ ] `deno task check` exits 0.
- [ ] Every in-scope source change is covered by the tests named above.
- [ ] No file outside the in-scope list is modified, except the permitted plan
      001 status-row edit in `plans/README.md`; confirm with
      `git status --short`.
- [ ] `plans/README.md` records this plan as DONE (unless maintained by the
      reviewer).

## STOP conditions

Stop and report instead of improvising if:

- After rebasing on completed lower-numbered/prerequisite work, the live code
  still has an unexplained semantic mismatch with this plan's assumptions.
- A verification command fails twice after one focused correction.
- The fix requires modifying a file listed as out of scope.
- An existing public test intentionally treats projectRoot itself as a virtual
  file.
- Rejecting equality breaks a documented non-file destination use case.

## Maintenance notes

- Keep the containment predicate shared by normalization and traversal so future
  callers cannot recreate the escape.
- Review plan 011 after landing this plan; it must preserve lexical public paths
  while canonicalizing only package containment.
