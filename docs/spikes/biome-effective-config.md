# Biome effective configuration spike

## Installed Biome and landed baseline

Installed Biome: 2.5.5. Plans 002, 004, and 006 pass an exact bounded config,
validate every check-mode source, preserve empty successful output, and discover
the native configuration names. Production still reads the selected raw config
to decide which tool flags to disable.

## Lint-only contract

For `src/lint-only/rule.ts`, default mode applies the safe `noInferrableTypes`
fix without formatting the file. Formatting-only mode returns the original
source and reports it ignored. Any replacement must retain both outcomes and
syntax-error validation.

## Candidate mechanisms

- Tool-specific `format` and `lint` stdin commands.
- Combined `check --write --stdin-file-path` output.
- Structured reporters on tool-specific or combined commands.
- `rage --formatter --linter` effective-configuration diagnostics.
- A project-local supported API, if installed (none is installed; only the CLI
  package is executable evidence).

## Direct check limitation

A combined check reports transformed text, not which tools were active. On the
lint-only fixture it formats as well as lints unless projectfmt supplies its
existing disable flags. On empty input it returns the same empty success shape
whether work was active or there was nothing observable to change.

## Decision criteria

The mechanism must be bounded and project-local, resolve extends, overrides,
language settings, and force-ignore rules, support virtual stdin, separately
classify formatter/linter/assist activation and inactive versus empty success,
agree under Deno and Node, avoid destination writes, and preserve lint-only and
syntax-error behavior.

## Evidence matrix

| Candidate                   | Effective config                 | Per-file tool activation                              | Virtual stdin | Deno/Node           | Lint-only compatibility                            |
| --------------------------- | -------------------------------- | ----------------------------------------------------- | ------------- | ------------------- | -------------------------------------------------- |
| `format` / `lint`           | Biome-owned                      | Only the invoked tool                                 | Yes           | Deterministic match | No; `format` processes the excluded lint-only path |
| `check --write`             | Biome-owned                      | Combined only                                         | Yes           | Deterministic match | No; it formats the lint-only path                  |
| JSON reporter               | Biome-owned                      | Diagnostics, not activation                           | Yes           | Deterministic match | Cannot distinguish inactive from no diagnostics    |
| `rage --formatter --linter` | Resolves extends/global settings | Global, not intended-path effective assist/tool state | No file stdin | Deterministic match | Insufficient for per-file overrides/includes       |

All 24 fixture/candidate pairs ran twice in both runtimes. The normalized exit
and classification evidence matched, and no virtual destination was created.

## Lint-only compatibility

The executable characterization confirms the current adapter output remains
`let     value=1;console.log(value)` in default mode and remains byte-for-byte
unchanged and ignored in formatting-only mode. Direct `check --write` instead
returns fully formatted `let value = 1`, so deleting the preflight is invalid.

## Decision: no stable mechanism

No tested Biome 2.5.5 surface authoritatively exposes separate effective
formatter, linter, and assist activation for one virtual stdin path while also
distinguishing inactive work from empty success. Retain the current production
preflight and its documented limitations. No production follow-up is required
before the call-scoped performance work; that work must preserve the existing
preflight and lint-only regressions.

## Implementation follow-up

Do not implement an effective-config replacement. A future production plan
requires either a Biome-supported per-file effective-configuration API or a
public-contract decision that intentionally changes lint-only behavior. It must
repeat this Deno/Node matrix before editing the adapter.

## Deferred alternatives

- A projectfmt-owned merger remains rejected because it would duplicate Biome.
- A single combined check remains rejected because it loses tool activation.
- Parsing `rage` prose remains rejected as unstable and not per-file complete.
