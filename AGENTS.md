# Repository Guidelines

## Project Overview

`projectfmt` is a Deno-first TypeScript library that discovers and invokes the
formatter configured by a destination project. It is published to JSR from the
source tree and to npm through a generated Node-compatible build.

Keep the public API centered on an in-memory source string, its intended file
path, and a project boundary. Preserve aligned behavior across Deno and Node.

## Repository Layout

- `main.ts` is the public entry point and export surface.
- `src/` contains discovery, resolution, formatter, filesystem, and process
  implementation code.
- `main_test.ts` contains the primary fixture-based test suite.
- `tests/fixtures/` contains representative destination projects and formatter
  configurations.
- `scripts/` contains npm build, npm test, coverage, and release tooling.
- `npm/` is generated output and is gitignored. Do not edit it by hand.
- `docs/RELEASING.md` documents the release process.

## Development

Use Deno 2 and Node 20 or newer. Materialize pinned dependencies with:

```sh
deno install --frozen
```

Useful tasks:

- `deno task test` runs the Deno tests in parallel.
- `deno task typecheck` checks the public entry point.
- `deno task lint` runs the Deno linter.
- `deno task doclint` validates public API documentation.
- `deno task fmt` formats the repository.
- `deno task pre-commit` runs the normal local gate and then formats files.
- `deno task coverage` builds and exercises the npm package with Node coverage.
- `deno task test:packages` dry-runs JSR publication and tests the npm build.

Before handing off a change, run the narrowest relevant tests and then, when
practical:

```sh
deno task pre-commit
deno task coverage
deno task test:packages
```

`pre-commit` may modify files because it ends with `deno task fmt`; inspect the
result afterward.

## Implementation Guidelines

- Keep formatter discovery bounded by `projectRoot`; never search above it.
- Preserve deterministic ranking and structured resolution diagnostics.
- Do not silently fall through to another formatter when the selected one is
  unavailable or fails.
- Keep Prettier and Deno format-only. Biome should mirror configured
  `check --write` behavior without unsafe fixes, while retaining the explicit
  `formatOnly` opt-out.
- Treat project-local formatter configuration, plugins, and binaries as trusted
  code. Preserve structured causes and stderr when wrapping failures.
- Use named ESM exports and document additions to the public API.
- Avoid temporary destination files. Pass paths as process arguments, never as
  interpolated shell commands.
- Tests must not install packages or access the network at runtime.

## Testing Guidelines

- Add or update a real project fixture for built-in adapter behavior.
- Use a custom adapter only for tests specifically covering extension points.
- Cover both successful formatting and relevant resolution or failure
  diagnostics.
- Exercise path-boundary, nested-configuration, ignore, and cross-runtime
  behavior when a change can affect them.

## Commits

- Use conventional commits with scopes for title.
- In the body, include the motivation, summary of changes, and anything else of
  note.
- At bottom: `Co-authored with <Assistant> (<model>, reasoning <level>)`
- If and only if YOU are the Codex tool, use the top-level `model` and
  `model_reasoning_effort` values from `~/.codex/config.toml` for `<model>` and
  `<level>` when present (not relevant for Antigravity or other non-Codex
  assistants).
- If the exact assistant name, model and reasoning level are unknown and cannot
  be inferred, ask the user before committing and then reuse that answer for the
  rest of the session.

## Pull Requests

Explain the motivation and the resolution or compatibility impact. List the
commands used for verification and call out any checks that were not run.
