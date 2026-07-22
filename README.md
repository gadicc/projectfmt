# projectfmt

_Format generated code the way its destination project expects._

Copyright (c) 2015 by Gadi Cohen. [MIT Licensed](./LICENSE.txt).

[![npm](https://img.shields.io/npm/v/projectfmt)](https://www.npmjs.com/package/projectfmt)
[![JSR](https://jsr.io/badges/@gadicc/projectfmt)](https://jsr.io/@gadicc/projectfmt)
[![JSR score](https://jsr.io/badges/@gadicc/projectfmt/score)](https://jsr.io/@gadicc/projectfmt)
[![CI](https://github.com/gadicc/projectfmt/actions/workflows/release.yml/badge.svg)](https://github.com/gadicc/projectfmt/actions/workflows/release.yml)
[![coverage](https://img.shields.io/codecov/c/github/gadicc/projectfmt)](https://codecov.io/gh/gadicc/projectfmt)
[![semantic-release](https://img.shields.io/badge/%20%20%F0%9F%93%A6%F0%9F%9A%80-semantic--release-e10079.svg)](https://github.com/semantic-release/semantic-release)
[![TypeScript](https://img.shields.io/badge/%3C%2F%3E-TypeScript-%230074c1.svg)](https://www.typescriptlang.org/)
[![MIT License](https://img.shields.io/badge/license-MIT-blue.svg)](./LICENSE.txt)

## Quick Start

`projectfmt` is a project-aware formatter broker for code generators and
libraries. Give it source text, the path where that source is intended to live,
and either an explicit project boundary or an absolute path from which one can
be inferred. It discovers and invokes the formatter already chosen by that
project—without writing a temporary file.

Deno / JSR import:

```ts
import { formatSource } from "@gadicc/projectfmt";
```

Node / npm import:

```ts
import { formatSource } from "projectfmt";
```

The call is the same in either runtime:

```ts
const formatted = await formatSource(generatedSource, {
  filePath: "src/generated/schema.ts",
  projectRoot,
});
```

The intended path is not cosmetic. It controls nested configuration discovery,
language/parser selection, ignores, plugins, and monorepo project selection.

## Why projectfmt?

`projectfmt` does not own formatting rules. Its job is discovery, resolution,
invocation, and consistent failure behavior for virtual files.

The closest prior art is
[Formatly](https://github.com/JoshuaKGoldberg/formatly), which also detects a
project's formatter. Its current public workflow accepts file/glob patterns and
runs formatter commands; `projectfmt` is source-string and virtual-file first.
Formatly's open discussions about an
[importable formatting API](https://github.com/JoshuaKGoldberg/formatly/issues/11),
[parent-directory discovery](https://github.com/JoshuaKGoldberg/formatly/issues/54),
and
[project package-manager execution](https://github.com/JoshuaKGoldberg/formatly/issues/112)
show how closely related the problem spaces are.

| Tool                                                                                            | Primary center of gravity                                  | Difference from `projectfmt`                                                                             |
| ----------------------------------------------------------------------------------------------- | ---------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| [Formatly](https://github.com/JoshuaKGoldberg/formatly)                                         | Formatter detection for file/glob and subprocess workflows | Closest analogue; `projectfmt` starts with an in-memory string and an intended virtual path              |
| [treefmt](https://github.com/numtide/treefmt) and [Trunk](https://trunk.io/)                    | Project-wide formatter orchestration and CLI workflows     | Operate at repository/workspace scale and use their own orchestration configuration                      |
| [Unibeautify](https://unibeautify.com/)                                                         | Universal beautifier ecosystem                             | Configuration-centric formatter abstraction rather than destination-project resolution for virtual files |
| [Spotless](https://github.com/diffplug/spotless)                                                | Composable formatting steps integrated with build systems  | Especially strong in JVM/Gradle/Maven workflows                                                          |
| [Prettier API](https://prettier.io/docs/api/) and [dprint plugins](https://dprint.dev/plugins/) | Programmatic APIs for one formatter ecosystem              | They format directly; they do not select whichever formatter an arbitrary destination project chose      |

This comparison was reviewed on 22 July 2026. It is deliberately about product
shape, not popularity. Alternatives exist and may be better for repository-wide
formatting.

The original formatter integration was used by
[`valibot-serialize`](https://github.com/gadicc/valibot-serialize) from 17
September 2025. It became a standalone package because project-aware formatting
is useful to code generators well beyond that project. The extraction also
corrects several limitations of that first integration; see
[History and intentional differences](#history-and-intentional-differences).

## Install

Deno / JSR:

```sh
deno add jsr:@gadicc/projectfmt
```

Node / npm:

```sh
npm install projectfmt
```

The destination project is expected to already provide its formatter:

- Prettier: a project-local `prettier` package;
- Biome: a project-local `@biomejs/biome` package and its platform binary;
- Deno fmt: a `deno` executable on `PATH`.

All formatter integrations are optional. `projectfmt` never installs or
downloads one, invokes a package manager, or contacts the network.

## API

### `formatSource(source, optionsOrAbsolutePath)`

Returns `Promise<string>`.

```ts
const output = await formatSource("export const answer=42", {
  filePath: "packages/api/src/generated/answer.ts",
  projectRoot: "/workspace",
  formatter: "auto", // default; also "prettier", "biome", "deno", or "none"
  strict: true,
});
```

`filePath` may be relative to an explicit `projectRoot` or absolute. Relative
paths without `projectRoot` are rejected rather than interpreted against the
process's current working directory. An absolute path may omit `projectRoot`, in
which case projectfmt infers it. Supplying `projectRoot` for an absolute path is
still supported when the caller needs an exact, reproducible boundary. Paths
that escape an explicit or inferred project boundary are rejected, as is an
intended path equal to `projectRoot`: the intended path must name a descendant
file. `strict` defaults to `false`.

The equivalent absolute-path shorthand uses all default options:

```ts
await formatSource(
  source,
  "/workspace/packages/api/src/generated/answer.ts",
);
```

The string shorthand must be absolute. Use the options object to supply a
relative path, explicit boundary, formatter selection, strict mode, custom
adapters, or processing constraints.

For automatic inference, projectfmt walks upward from the intended file's
directory. The nearest VCS root (`.git` or `.hg`) or workspace boundary wins.
Recognized workspaces include pnpm, Lerna, Rush, `package.json#workspaces`, and
Deno workspaces. If none exists, the nearest package, Deno, JSR, lockfile, or
supported formatter configuration is used. Inference errors instead of using the
filesystem root when no defensible project marker exists.

Inferred roots are cached for traversed directories at or below the detected
root, so later files in the same package or workspace reuse the result. Call
`clearProjectRootCache()` if a long-running process changes project topology,
such as creating or removing a workspace or VCS boundary.

Biome automatically runs the equivalent of
`biome check --write --stdin-file-path=...`. This applies the repository's
formatting, safe lint fixes, and enabled assist actions such as import
organization. It never passes `--unsafe`. Set `formatOnly: true` to opt out of
lint fixes and assist actions and call the equivalent of `biome format` instead:

```ts
await formatSource(source, {
  filePath,
  projectRoot,
  formatOnly: true,
});
```

`formatOnly` is an adapter-independent processing constraint. Prettier and Deno
already perform formatting only, so Biome is the only built-in adapter whose
behavior currently changes. Custom adapters receive the constraint as
`context.formatOnly` and should avoid lint fixes, assists, or other cleanup when
it is true.

### `formatSourceWithResult(source, optionsOrAbsolutePath)`

Returns the source plus resolution diagnostics:

```ts
const result = await formatSourceWithResult(source, options);

console.log(result.changed, result.ignored);
console.log(result.resolution.formatter);
console.log(result.resolution.evidence);
```

It accepts the same absolute-path string shorthand as `formatSource`.

The result contains:

- `source`, `changed`, and `ignored`;
- the selected formatter and implementation/version availability;
- absolute normalized project and file paths;
- the configuration root, all discovery evidence, ranked candidates, ambiguity
  state, and a human-readable reason.

### `resolveFormatter(optionsOrAbsolutePath)`

Performs the same discovery and availability probing without formatting:

```ts
const resolution = await resolveFormatter({
  filePath: "src/generated/schema.ts",
  projectRoot,
});

switch (resolution.status) {
  case "selected":
    console.log(resolution.formatter, resolution.availability?.version);
    break;
  case "not-configured":
  case "unavailable":
  case "disabled":
    console.log(resolution.reason);
}
```

For default resolution options, pass the absolute intended path directly:

```ts
const resolution = await resolveFormatter(absoluteOutputPath);
```

### `clearProjectRootCache()`

Clears roots cached by automatic inference. Explicit `projectRoot` calls do not
use this cache. Formatter evidence, configuration, and availability are not
cached.

### Custom adapters

Additional adapters use the same discovery/probe/format lifecycle as built-ins:

Deno / JSR import:

```ts
import type { FormatterAdapter } from "@gadicc/projectfmt";
```

Node / npm import:

```ts
import type { FormatterAdapter } from "projectfmt";
```

The adapter definition is runtime-neutral:

```ts
const custom: FormatterAdapter = {
  name: "companyfmt",
  priority: 100,
  async discover(directory) {
    // Return evidence for this directory, or [].
    return [];
  },
  async probe() {
    return { available: true, implementation: "in-process" };
  },
  async format(source) {
    return { source: companyFormat(source) };
  },
};

await formatSource(source, {
  filePath,
  projectRoot,
  formatter: "companyfmt",
  adapters: [custom],
});
```

Adapter names must be unique. Custom adapters define their own source-processing
behavior. Because automatic root inference cannot know custom project markers,
callers using custom adapters should normally provide `projectRoot` explicitly.

## Resolution rules

For `formatter: "auto"`, discovery walks from the intended file's directory up
to and including `projectRoot`. It never searches above that boundary.

1. The nearest directory containing formatter evidence wins. This establishes
   the nested-project/monorepo boundary.
2. Within that directory, explicit configuration (`biome.json`, a Prettier
   config or package metadata, or `deno.json(c)#fmt`) beats a formatting script,
   which beats dependency-only evidence. Discovery follows the native filename
   sets, including dotted Biome JSON/JSONC, Prettier TOML, and truthy
   `package.yaml#prettier` configuration.
3. Equal-strength candidates use the stable precedence `biome`, then `deno`,
   then `prettier`. This is an explicit tie-breaker, not adapter import order.
   `strict: true` rejects the ambiguity instead.
4. Availability never changes selection. If the chosen formatter is missing,
   `formatSource` errors instead of silently falling through to a different
   formatter.

Explicit selection bypasses ranking but still uses nearest applicable config and
project-local implementation resolution. `formatter: "none"` returns the input
unchanged and performs no formatter probe.

With no configured formatter, non-strict auto mode returns the input unchanged
and reports `not-configured`; strict mode errors. Ignored files are returned
unchanged in either mode.

## Formatter behavior

| Formatter | Implementation                    | Project/path behavior                                                                                                                                                                                               | Deno | Node                        |
| --------- | --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---- | --------------------------- |
| Prettier  | Project-local JS API              | Passes `filepath`, loads the exact discovered config and project plugins, and checks bounded `.prettierignore`/`.gitignore` paths. EditorConfig lookup is disabled.                                                 | Yes  | Yes                         |
| Biome     | Project-local platform CLI binary | Runs `check --write --stdin-file-path` by default with the exact discovered config, safe lint rules, assists, and file/tool includes. `formatOnly` selects `format`. Configless calls use a temporary empty config. | Yes  | Yes                         |
| Deno fmt  | `deno fmt` subprocess             | Passes the exact discovered config or `--no-config`, infers `--ext`, honors `fmt.include`/`fmt.exclude`, and uses the nearest existing destination directory as cwd. EditorConfig lookup is disabled.               | Yes  | Yes, when Deno is installed |

No adapter creates a temporary source or destination file. Configless Biome
calls create and unconditionally remove a temporary empty configuration. Paths
containing spaces are passed as process arguments rather than shell strings.

The Deno adapter evaluates top-level and `fmt` exclusions in order, including
negated re-inclusions. Markdown suffix aliases such as `.markdown` map to the
canonical `md` media type. Other media types and any required unstable flags are
derived from the selected Deno 2 executable's `fmt --help` output on each call,
so version-gated formats are used only when that runtime advertises them.

## Errors and diagnostics

`FormatterResolutionError` covers invalid options, strict ambiguity, missing
configuration in strict mode, and unavailable selected implementations.
`FormatterExecutionError` wraps parsing/configuration/process failures.

Both extend `ProjectfmtError` and preserve useful fields such as `code`,
`formatter`, `filePath`, `projectRoot`, `evidence`, `resolution`, `stderr`, and
the original `cause`. Formatter failures are never converted to unchanged
output.

## Security and trust model

Use `projectfmt` only with projects you trust.

Prettier configuration and plugins are JavaScript modules and can execute code
when loaded. The Biome adapter executes the project's pinned native binary, and
the Deno adapter executes the `deno` binary on `PATH`. This is the same broad
trust boundary as running those project formatters directly. `projectRoot` is a
discovery and module-resolution boundary, not a sandbox. Provide it explicitly
when automatic inference would grant a broader boundary than the caller intends.
Native formatter configuration search is also bounded: projectfmt passes only
the exact configuration discovered within `projectRoot`, or explicitly disables
native auto-discovery. EditorConfig lookup is disabled for all built-in adapters
because bounded EditorConfig inheritance is not yet implemented.

The library itself performs no network access or installation. Deno callers must
grant the filesystem, environment, and subprocess permissions required to
inspect the destination project and run its formatter.

## History and intentional differences

Compared with the formatter subsystem extracted from `valibot-serialize`:

- auto mode selects from project evidence instead of whichever adapter imports
  first;
- Prettier receives the intended filepath, resolved configuration, ignores, and
  plugins;
- Deno fmt receives the real extension, project cwd, and config rather than
  always parsing stdin as TypeScript;
- Biome consistently applies configured formatting, safe lint fixes, and assist
  actions in both runtimes, with a formatting-only opt-out;
- Node and Deno share one resolution/error contract;
- diagnostics, strict mode, custom adapters, ignored virtual files, and project
  boundary validation are public behavior.

## Roadmap

Likely future adapters include dprint and oxfmt. A whole-repository formatting
CLI is not the primary goal.

## Development

See [CONTRIBUTING.md](CONTRIBUTING.md) and
[docs/RELEASING.md](docs/RELEASING.md). The main gates are:

```sh
deno task pre-commit
deno task coverage
deno task test:packages
```

MIT © Gadi Cohen.
