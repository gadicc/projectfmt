# Plan 004: Make Biome lifecycle outcomes truthful

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving on. If a
> STOP condition occurs, stop and report; do not improvise. When finished,
> update this plan's row in `plans/README.md` unless a reviewer says they
> maintain the index.
>
> **Drift/rebase check (run first)**:
> `git diff --stat 5ff23b4..HEAD -- src/adapters/biome.ts src/adapters/biome_test.ts main_test.ts tests/fixtures/biome-js-api tests/fixtures/biome`
> First inspect `plans/README.md` and the diffs of any completed lower-numbered
> plan or explicit prerequisite. Treat those documented changes as the new
> baseline and rebase excerpts and line references rather than stopping. An
> in-scope change not explained by completed plan work, or a semantic conflict
> that remains after rebasing, is a STOP condition.

## Status

- **Priority**: P1
- **Effort**: M
- **Risk**: MED
- **Depends on**: plans/003-handle-subprocess-stdin-errors.md
- **Category**: bug
- **Planned at**: commit `5ff23b4`, 2026-07-22

## Why this matters

The Biome adapter currently advertises unsupported JS API evidence, marks failed
version probes available, skips syntax validation on lint-only paths, and
discards successful empty output. These independent edge cases all corrupt the
lifecycle contract: selection, availability, failure, or changed status can be
false. Correct them together before deeper effective-config work.

## Current state

- Discovery treats @biomejs/js-api and @biomejs/biome as equivalent evidence,
  but resolution supports only the CLI package.
- biomeVersion parses stdout without checking code or signal.
- Syntax validation runs only when formatterActive is true.
- Successful stdout uses a truthiness fallback to the original source.

```ts
// src/adapters/biome.ts:18-24
...await packageEvidence("biome", directory, {
  packages: ["@biomejs/biome", "@biomejs/js-api"],
  commandPattern: /...biome.../,
})
```

```ts
// src/adapters/biome.ts:38-39,143-151
const version = await biomeVersion(implementation, context);
return { available: true, implementation, version };
// biomeVersion does not inspect result.code or result.signal.
```

```ts
// src/adapters/biome.ts:54-80
if (!context.formatOnly && fileBehavior.formatterActive) {
  await runBiome(implementation, ["format", "--stdin-file-path", context.filePath], context, source);
}
...
return { source: result.stdout || source, ignored: isIgnoredMessage(result.stderr) };
```

Repository constraints to preserve:

- Availability must not cause fallback to another valid candidate; only correct
  false evidence and false availability.
- Biome default behavior remains safe check --write with no --unsafe flag.
- formatOnly continues to invoke format-only behavior.
- Use real fixture behavior for built-in integration tests and internal unit
  seams only where a fake executable is required.

## Commands you will need

| Purpose             | Command                                                 | Expected on success                                                 |
| ------------------- | ------------------------------------------------------- | ------------------------------------------------------------------- |
| Resolution suite    | `deno test -A main_test.ts --filter "resolveFormatter"` | the existing top-level resolution suite and discovery cases pass    |
| Formatting suite    | `deno test -A main_test.ts --filter "formatSource"`     | the existing top-level formatting suite and all Biome outcomes pass |
| Adapter unit tests  | `deno test -A src/adapters/biome_test.ts`               | probe lifecycle cases pass                                          |
| Full Deno gate      | `deno task check`                                       | exit 0                                                              |
| Node/package parity | `deno task coverage && deno task test:packages`         | both tasks exit 0                                                   |

## Scope

**In scope** (the only files to modify):

- `src/adapters/biome.ts`
- `src/adapters/biome_test.ts`
- `main_test.ts`
- `tests/fixtures/biome-js-api`
- `tests/fixtures/biome`

**Out of scope**:

- Resolving Biome extends, overrides, and !! semantics (plan 007).
- Changing built-in precedence or falling through on unavailability.
- Adding support for @biomejs/js-api as an in-process formatter.
- Unsafe lint fixes.

**Administrative exception**:

- `plans/README.md` may be modified only to update plan 004's status row. No
  other plan or index content may be changed.

## Git workflow

- Branch: `codex/004-correct-biome-lifecycle`
- Use Conventional Commits; suggested final subject:
  `fix(biome): correct lifecycle diagnostics`
- Keep commits limited to this plan. Do not push or open a PR unless instructed.

## Steps

This plan is intentionally one lifecycle handoff because plan 007 depends on all
four invariants in the same adapter. Execute it as two independently green,
commit-ready phases: Phase A corrects selection/availability (steps 1–2), and
Phase B corrects processing outcomes (steps 3–4). Do not begin Phase B until the
Phase A gate passes. A separate commit per phase is allowed; neither phase may
leave failing tests for the other to repair.

### Phase A: Selection and availability

### Step 1: Remove unsupported discovery evidence

Remove @biomejs/js-api from executable Biome package evidence. Add a fixture
declaring only that package plus Prettier dependency evidence at equal strength;
assert automatic resolution chooses Prettier rather than a higher-priority
unavailable Biome candidate. Do not alter the general precedence rule.

**Verify**: `deno test -A main_test.ts --filter "resolveFormatter"` → the
existing top-level resolution suite runs, and the descriptively named Biome JS
API regression selects Prettier and records no Biome dependency evidence

### Step 2: Validate version-probe exit status

Refactor the private version probe into an internally testable helper that
accepts the command result or runner without exporting it from `main.ts`. A
nonzero code or signal must produce `available:false` with stderr/reason; only a
successful probe may parse and report a version.

**Verify**: `deno test -A src/adapters/biome_test.ts` → success, nonzero, and
signal cases all pass

**Phase A gate**:
`deno task typecheck && deno test -A src/adapters/biome_test.ts && deno test -A main_test.ts --filter "resolveFormatter"`
→ all commands exit 0; discovery and probe changes are independently
commit-ready before processing behavior changes

### Phase B: Processing outcomes

### Step 3: Validate syntax whenever Biome processes a file

Decouple parse validation from formatter activation. For default check mode,
malformed source on a lint-only or assist-only path must throw through
FormatterExecutionError, while valid source still follows Biome's authoritative
check --write ordering. Keep formatOnly semantics unchanged.

**Verify**: `deno test -A main_test.ts --filter "formatSource"` → the existing
top-level formatting suite runs; malformed lint-only input fails structurally
and valid lint-only behavior remains unchanged

### Step 4: Preserve successful empty output

Return `result.stdout` verbatim for a successful processed file. Use explicit
ignored detection—not truthiness—to return unchanged source when Biome reports
no file processed. Add blank and whitespace-only cases in default and formatOnly
modes.

**Verify**: `deno test -A main_test.ts --filter "formatSource"` → the existing
top-level formatting suite runs; the descriptively named empty and
whitespace-only Biome cases preserve exactly empty output and report a change
when input contained whitespace

**Phase B gate**: `deno test -A main_test.ts --filter "formatSource"` → the
entire existing top-level formatting suite and all new processing-outcome cases
pass; Phase B is independently commit-ready

### Step 5: Run all runtime gates

Run the full suite, Node coverage, and installed npm smoke to ensure internal
probe changes survive dnt output.

**Verify**: `deno task check && deno task coverage && deno task test:packages` →
all commands exit 0

## Test plan

- @biomejs/js-api alone is not CLI discovery evidence.
- Successful --version produces available true and a parsed version.
- Nonzero or signalled --version produces unavailable with a reason.
- Malformed lint-only source becomes FormatterExecutionError.
- Valid empty stdout is returned exactly in both Biome modes.

## Done criteria

- [ ] Every Biome availability true result comes from a successful probe.
- [ ] No truthiness fallback can replace valid empty output.
- [ ] The lifecycle tests distinguish ignored, failed, unchanged, and
      empty-success outcomes.
- [ ] Phase A and Phase B gates each pass independently at their stated
      boundary.
- [ ] `deno task check` exits 0.
- [ ] Every in-scope source change is covered by the tests named above.
- [ ] No file outside the in-scope list is modified, except the permitted plan
      004 status-row edit in `plans/README.md`; confirm with
      `git status --short`.
- [ ] `plans/README.md` records this plan as DONE (unless maintained by the
      reviewer).

## STOP conditions

Stop and report instead of improvising if:

- After rebasing on completed lower-numbered/prerequisite work, the live code
  still has an unexplained semantic mismatch with this plan's assumptions.
- A verification command fails twice after one focused correction.
- The Phase A gate is not green before Phase B work begins; stop with the Phase
  A diff and failure rather than coupling a processing change to repair it.
- Phase B requires changing selection/probe behavior that already passed Phase
  A; stop and report the newly discovered coupling.
- The fix requires modifying a file listed as out of scope.
- The pinned Biome CLI has no command capable of detecting parse errors on a
  configured lint-only path without mutating output; record the commands tried
  and defer to plan 007.
- Testing the probe requires publishing a new public test hook.
- Removing JS API evidence changes any documented support claim; no such claim
  should exist at the baseline.

## Maintenance notes

- When @biomejs/js-api support is intentionally implemented, add a separate
  adapter or complete in-process lifecycle before restoring evidence.
- Plan 007 may simplify syntax/ignore behavior by delegating effective config to
  Biome; retain these outcome tests.
