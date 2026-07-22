# projectfmt

> Format generated code the way its destination project expects.

`projectfmt` is a project-aware formatter broker for code generators and
libraries. Give it source text, the path where that source is intended to live,
and a project boundary. It discovers and invokes the formatter already chosen by
that project—without writing a temporary file.

```ts
import { formatSource } from "projectfmt";

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

### `formatSource(source, options)`

Returns `Promise<string>`.

```ts
const output = await formatSource("export const answer=42", {
  filePath: "packages/api/src/generated/answer.ts",
  projectRoot: "/workspace",
  formatter: "auto", // default; also "prettier", "biome", "deno", or "none"
  strict: true,
});
```

`filePath` may be relative to `projectRoot` or absolute within it. Paths that
escape the project boundary are rejected. `projectRoot` defaults to the current
working directory. `strict` defaults to `false`.

Formatting is the only operation. The Biome adapter calls `biome format`, not
`biome check`; no adapter applies lint fixes, organizes imports, or performs
other semantic cleanup.

### `formatSourceWithResult(source, options)`

Returns the source plus resolution diagnostics:

```ts
const result = await formatSourceWithResult(source, options);

console.log(result.changed, result.ignored);
console.log(result.resolution.formatter);
console.log(result.resolution.evidence);
```

The result contains:

- `source`, `changed`, and `ignored`;
- the selected formatter and implementation/version availability;
- absolute normalized project and file paths;
- the configuration root, all discovery evidence, ranked candidates, ambiguity
  state, and a human-readable reason.

### `resolveFormatter(options)`

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

### Custom adapters

Additional adapters use the same discovery/probe/format lifecycle as built-ins:

```ts
import type { FormatterAdapter } from "projectfmt";

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

Adapter names must be unique. Custom adapters must obey the same format-only
contract.

## Resolution rules

For `formatter: "auto"`, discovery walks from the intended file's directory up
to and including `projectRoot`. It never searches above that boundary.

1. The nearest directory containing formatter evidence wins. This establishes
   the nested-project/monorepo boundary.
2. Within that directory, explicit configuration (`biome.json`, a Prettier
   config or `package.json#prettier`, or `deno.json(c)#fmt`) beats a formatting
   script, which beats dependency-only evidence.
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

| Formatter | Implementation                    | Project/path behavior                                                                                                                                            | Deno | Node                        |
| --------- | --------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---- | --------------------------- |
| Prettier  | Project-local JS API              | Passes `filepath`, resolves nearest config and EditorConfig, loads project plugins, checks `.prettierignore`/`.gitignore`                                        | Yes  | Yes                         |
| Biome     | Project-local platform CLI binary | Runs only `format --stdin-file-path`; honors `files.includes` and `formatter.includes` for the virtual path                                                      | Yes  | Yes                         |
| Deno fmt  | `deno fmt` subprocess             | Passes the nearest config, infers `--ext` from the intended path, honors `fmt.include`/`fmt.exclude`, and uses the nearest existing destination directory as cwd | Yes  | Yes, when Deno is installed |

No temporary file is required by any adapter. Paths containing spaces are passed
as process arguments rather than shell strings.

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
discovery and module-resolution boundary, not a sandbox.

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
- Biome is format-only in both runtimes; the old Deno path also applied safe
  lint fixes;
- Node and Deno share one resolution/error contract;
- diagnostics, strict mode, custom adapters, ignored virtual files, and project
  boundary validation are public behavior.

## Roadmap

V1 is intentionally formatting-only. Likely future adapters include dprint and
oxfmt, followed by explicitly named operations for any non-formatting behavior.
A whole-repository formatting CLI is not the primary goal.

## Development

See [CONTRIBUTING.md](CONTRIBUTING.md) and
[docs/RELEASING.md](docs/RELEASING.md). The main gates are:

```sh
deno task pre-commit
deno task coverage
deno task test:packages
```

MIT © Gadi Cohen.
