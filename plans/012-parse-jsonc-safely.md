# Plan 012: Preserve strings while parsing JSONC

> **Executor instructions**: Follow this plan in order and run every
> verification command. Stop and report instead of improvising when a STOP
> condition occurs. Update this plan's row in `plans/README.md` when done unless
> a reviewer maintains the index.
>
> **Drift check (run first)**:
> `git diff --stat 5ff23b4..HEAD -- src/fs.ts src/fs_test.ts` Compare changed
> in-scope code with the excerpts below. Semantic drift is a STOP condition.

## Status

- **Priority**: P2
- **Effort**: S
- **Risk**: LOW
- **Depends on**: none
- **Category**: bug
- **Planned at**: commit `5ff23b4`, 2026-07-22

## Why this matters

The JSONC scanner tracks strings while removing comments, but a final global
trailing-comma regex ignores that state and rewrites comma-plus-closing-bracket
text inside valid strings. Formatter globs and other values can be silently
corrupted. Make comma removal lexical and preserve error offsets where
practical.

## Current state

- `parseJsonc` has a string/comment-aware scan.
- A final output.replace removes comma-whitespace before } or ] globally.
- Biome and Deno preflight consume the parser.

```ts
// src/fs.ts:22-75
export function parseJsonc(text: string): unknown {
  let output = "";
  let inString = false;
  let escaped = false;
  // comment-aware scan
  // ...
  return JSON.parse(output.replace(/,\s*([}\]])/g, "$1"));
}
```

Repository constraints to preserve:

- Do not evaluate config or use a JavaScript parser.
- Preserve comment support and JSON.parse failures.
- Replace removed syntax with spaces where practical.
- Avoid a new dependency for this localized fix.

## Commands you will need

| Purpose             | Command                                         | Expected on success       |
| ------------------- | ----------------------------------------------- | ------------------------- |
| JSONC tests         | `deno test -A src/fs_test.ts`                   | all pass                  |
| Adapter regressions | `deno test -A main_test.ts`                     | full fixture suite passes |
| Full gate           | `deno task check`                               | exit 0                    |
| Node/package parity | `deno task coverage && deno task test:packages` | both exit 0               |

## Scope

**In scope** (the only files to modify):

- `src/fs.ts`
- `src/fs_test.ts`

**Out of scope**:

- Formatter config semantics.
- JSON5/YAML/TOML.
- Other filesystem helpers.
- Suppressing JSON syntax errors.

**Administrative exception**:

- `plans/README.md` may be modified only to update plan 012's status cell.
- Ignore that one status-cell edit when checking scope cleanliness; any other
  `plans/README.md` change remains out of scope.

## Git workflow

- Branch: `codex/012-parse-jsonc-safely`
- Conventional Commit subject: `fix(jsonc): preserve delimiters inside strings`
- Do not push or open a PR unless instructed.

## Steps

### Step 1: Add lexical regressions

Test strings containing `,}`, `,]`, escaped quotes/backslashes, comment-like
text, and `**/*.{ts,}`. Include true trailing commas and comments before closing
tokens. Assert exact values.

**Verify**: `deno test -A src/fs_test.ts` → the baseline exits nonzero only for
the descriptively named string-preservation regressions containing `,}` or `,]`;
true trailing-comma, comment, and existing parser cases remain green. Record
that expected failure before Step 2. A zero-test run, compile error, or
unrelated failure is not the expected baseline; Step 2 reruns the file and
requires it to pass.

### Step 2: Replace the global regex

After comment removal, scan while tracking string/escape state. At a comma
outside strings, look ahead over whitespace; if the next significant character
is } or ], replace only the comma with a space. Leave string bytes untouched,
then JSON.parse.

**Verify**: `deno test -A src/fs_test.ts` → real trailing commas parse and
strings are exact

### Step 3: Run adapter and distribution gates

Verify the focused parser tests, the complete fixture-based adapter test file,
Deno checks, Node coverage, and package smokes. Run `main_test.ts` without a
nested BDD filter so zero selected tests cannot appear successful.

**Verify**:
`deno test -A src/fs_test.ts && deno test -A main_test.ts && deno task check && deno task coverage && deno task test:packages`
→ focused parser tests, the full fixture suite, and all gates exit 0

## Test plan

- Object/array trailing commas parse.
- Comments before closing delimiters parse.
- Strings with ,} or ,] are unchanged.
- Escaped quotes/backslashes preserve state.
- Malformed JSON still throws SyntaxError.

## Done criteria

- [ ] No global regex rewrites strings.
- [ ] Parser tests cover comments, strings, escapes, and commas.
- [ ] Adapter config tests stay green.
- [ ] `deno task check` exits 0.
- [ ] Only in-scope files and the optional plan-012 status cell changed; verify
      with `git status --short` and `git diff -- plans/README.md`.
- [ ] `plans/README.md` marks this plan DONE unless the reviewer owns the index.

## STOP conditions

Stop and report if:

- Live behavior or code no longer matches the baseline excerpts.
- A verification fails twice after one focused correction.
- The implementation requires an out-of-scope file.
- The scanner starts accepting JSON5.
- Preserving comments changes value/error types.
- A dependency expands published runtime surface.

## Maintenance notes

- Add lexical cases before future scanner changes.
- Compare error and npm behavior before adopting a library parser.
