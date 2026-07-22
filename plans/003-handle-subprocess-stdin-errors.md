# Plan 003: Handle subprocess stdin failures without crashing the host

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving on. If a
> STOP condition occurs, stop and report; do not improvise. When finished,
> update this plan's row in `plans/README.md` unless a reviewer says they
> maintain the index.
>
> **Drift/rebase check (run first)**:
> `git diff --stat 5ff23b4..HEAD -- src/process.ts src/process_test.ts main_test.ts scripts/build_npm.ts scripts/node_process_harness.ts scripts/node_coverage.mjs deno.json`
> First inspect `plans/README.md` and the diffs of any completed lower-numbered
> plan or explicit prerequisite. Treat those documented changes as the new
> baseline and rebase excerpts and line references rather than stopping. An
> in-scope change not explained by completed plan work, or a semantic conflict
> that remains after rebasing, is a STOP condition.

## Status

- **Priority**: P1
- **Effort**: M
- **Risk**: LOW
- **Depends on**: none
- **Category**: bug
- **Planned at**: commit `5ff23b4`, 2026-07-22

## Why this matters

A formatter may exit before consuming a large source string. Node then emits
EPIPE on child.stdin; because the stream has no error handler, that event can
terminate the Deno or Node host before projectfmt can return structured
diagnostics. The process wrapper must settle exactly once while preserving the
authoritative exit status and stderr.

## Current state

- `runCommand` observes child process, stdout, and stderr events but not stdin
  errors.
- Adapters rely on returned code/signal/stderr to construct formatter failures.
- The outer formatting path can wrap an error only if runCommand settles
  normally.

```ts
// src/process.ts:17-38
return await new Promise((resolve, reject) => {
  const child = spawn(command, [...args], { stdio: ["pipe", "pipe", "pipe"], ... });
  child.once("error", reject);
  child.once("close", (code, signal) => {
    resolve({ code, signal, stdout: ..., stderr: ... });
  });
  child.stdin.end(options.input ?? "");
});
```

Repository constraints to preserve:

- Never interpolate command arguments through a shell.
- Preserve stdout, stderr, code, and signal collection.
- The promise must settle exactly once across spawn error, stdin error, and
  close races.
- Tests must be cross-platform and use Deno.execPath rather than /bin/false.

## Commands you will need

| Purpose             | Command                                             | Expected on success                            |
| ------------------- | --------------------------------------------------- | ---------------------------------------------- |
| Targeted unit test  | `deno test -A src/process_test.ts`                  | all process wrapper cases pass                 |
| Formatting suite    | `deno test -A main_test.ts --filter "formatSource"` | the existing top-level formatting suite passes |
| Full Deno gate      | `deno task check`                                   | exit 0                                         |
| Node/package parity | `deno task coverage && deno task test:packages`     | both tasks exit 0                              |

## Scope

**In scope** (the only files to modify):

- `src/process.ts`
- `src/process_test.ts`
- `main_test.ts`
- `scripts/build_npm.ts`
- `scripts/node_process_harness.ts`
- `scripts/node_coverage.mjs`
- `deno.json`

**Out of scope**:

- Adding timeouts, cancellation, output-size limits, or shell execution.
- Changing formatter exit-code interpretation in individual adapters.
- Changing public error classes or codes.

**Administrative exception**:

- `plans/README.md` may be modified only to update plan 003's status row. No
  other plan or index content may be changed.

## Git workflow

- Branch: `codex/003-handle-subprocess-stdin-errors`
- Use Conventional Commits; suggested final subject:
  `fix(process): handle early child stdin closure`
- Keep commits limited to this plan. Do not push or open a PR unless instructed.

## Steps

### Step 1: Create a deterministic cross-platform regression

Add `src/process_test.ts`. Invoke
`runCommand(Deno.execPath(), ["eval", "Deno.exit(7)"], ...)` with a
multi-megabyte input so the child closes before consuming stdin. Assert the test
process remains alive and the call settles with code 7. Also retain a
spawn-failure case that rejects.

**Verify**: `deno test -A src/process_test.ts` → the baseline exits nonzero
because the descriptively named early-exit case observes an unhandled stdin
error. Record that expected failure before moving on; a hang or zero-test run is
not the expected baseline. Step 2 reruns this file and requires it to pass.

### Step 2: Coordinate stdin and child lifecycle events

Attach the stdin error listener before writing. Use one settlement guard. Treat
EPIPE/ERR_STREAM_DESTROYED caused by an already-closing child as subordinate to
the eventual close result so adapters retain code and stderr; reject unexpected
stdin errors when no authoritative close result can be obtained. Route a
synchronous throw from `child.stdin.end(...)` through the same stdin-error
state. A settled promise must retain an error sink until stdin can no longer
emit—do not remove its last `error` listener early—while the settlement guard
prevents any late event from changing the result.

**Verify**: `deno test -A src/process_test.ts` → early exit resolves once with
code 7; missing executable rejects once

### Step 3: Verify structured formatter wrapping

Add or tighten an integration assertion using the existing real broken formatter
fixture: a nonzero child result becomes FormatterExecutionError with its
cause/stderr rather than escaping as an uncaught process event. This check only
protects structured adapter wrapping; the deterministic immediate-exit and EPIPE
race belongs in `src/process_test.ts` and the generated Node harness. Do not try
to force timing-dependent EPIPE through the public API, and do not add a custom
adapter test for built-in process behavior.

**Verify**: `deno test -A main_test.ts --filter "formatSource"` → the existing
top-level formatting suite runs and structured failure assertions pass

### Step 4: Exercise a test-only generated Node process harness

Add `scripts/node_process_harness.ts`, containing only a named re-export of
`runCommand` from `src/process.ts`. Extend `scripts/build_npm.ts` with an exact
`--test-internals` mode that appends this file as a second dnt export entry,
using exactly
`{ name: "./__test__/process", path: "./scripts/node_process_harness.ts", kind: "export" }`;
leave the ordinary `entryPoints: ["./main.ts"]` build unchanged. After dnt
transforms the explicit entry, assert both that the expected generated harness
file `npm/esm/scripts/node_process_harness.js` exists and that
`npm/package.json` maps the `./__test__/process` import export to that path. A
layout or export-shape change must fail at build time rather than silently
skipping the test. In ordinary mode, make the complementary assertions that the
generated path and package export are absent after the replacement build.

Change only the `coverage` task in `deno.json` to invoke
`deno task build:npm --test-internals` before Node's coverage runner. In
`scripts/node_coverage.mjs`, import `runCommand` from the generated harness, not
from an incidental transformed dependency and not from `npm/esm/main.js`. Add a
Node test that invokes `process.execPath` with `-e` and an immediate nonzero
exit, supplies the same multi-megabyte input used by the Deno unit regression,
and asserts the Node test host remains alive and receives the expected exit
code.

This is an internal distribution regression only: do not add `runCommand` to
`main.ts`, and do not enable the harness in the normal `build:npm` task. Because
every build replaces `npm/`, a subsequent ordinary build must remove the harness
and its test-only package export. Retain all existing public API coverage cases.

**Verify**: `deno task coverage && deno task build:npm` → the flagged dnt build
produces and imports the explicit harness, the generated Node EPIPE regression
and existing coverage tests pass, then the ordinary replacement build's
complementary absence assertions pass

### Step 5: Run cross-runtime gates

Exercise Deno and the generated Node build because the wrapper uses
node:child_process in both runtimes.

**Verify**: `deno task check && deno task coverage && deno task test:packages` →
all commands exit 0

## Test plan

- Large stdin plus immediate nonzero child exit does not crash or hang.
- The returned result retains the nonzero code and captured stderr.
- A true spawn error rejects.
- Late close/stdin events do not double-settle or emit an unhandled error.
- The generated test-only npm harness exercises `runCommand` under Node using
  `process.execPath` and the same early-exit case.
- A normal npm build omits the test-only harness and export.

## Done criteria

- [ ] No child.stdin error can be unhandled.
- [ ] The early-exit regression completes under Deno and as an explicit test in
      `scripts/node_coverage.mjs` against the generated test-only harness.
- [ ] Normal `build:npm` output exposes neither the harness nor its test-only
      package export.
- [ ] Existing formatter failure diagnostics remain structured.
- [ ] `deno task check` exits 0.
- [ ] Every in-scope source change is covered by the tests named above.
- [ ] No file outside the in-scope list is modified, except the permitted plan
      003 status-row edit in `plans/README.md`; confirm with
      `git status --short`.
- [ ] `plans/README.md` records this plan as DONE (unless maintained by the
      reviewer).

## STOP conditions

Stop and report instead of improvising if:

- After rebasing on completed lower-numbered/prerequisite work, the live code
  still has an unexplained semantic mismatch with this plan's assumptions.
- A verification command fails twice after one focused correction.
- The fix requires modifying a file listed as out of scope.
- The only reliable fix would swallow every stdin error without an eventual
  child result.
- The regression is flaky after replacing the child program with Deno.execPath.
- dnt cannot transform the explicit test-only entry without changing the
  ordinary package exports, or the asserted generated harness path differs;
  report the observed layout instead of exporting the helper publicly.
- A proposed solution invokes a shell or changes argument escaping.

## Maintenance notes

- If cancellation or timeouts are later added, route them through the same
  single-settlement lifecycle.
- Review Windows behavior for ERR_STREAM_DESTROYED as well as POSIX EPIPE.
