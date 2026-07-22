---
name: projectfmt
description: Integrate and use the projectfmt TypeScript library to format generated in-memory source according to the destination project's own Prettier, Biome, or Deno configuration. Use when building or modifying code generators, scaffolding tools, compiler output, migrations, or other Node/Deno code that must format a source string for an intended output path without creating a temporary file; also use when diagnosing projectfmt formatter selection, ignores, availability, or structured errors.
---

# Projectfmt

Use `projectfmt` as the formatting boundary between generated source and the
destination project. Pass it the source string, intended destination path, and
project boundary before writing the final file.

## Integrate formatting

1. Inspect the caller's runtime and package manager.
2. Add `projectfmt` from npm for Node or `@gadicc/projectfmt` from JSR for Deno.
   Do not add a formatter on the destination project's behalf.
3. Identify the intended output path and the narrowest correct project root.
4. Format the generated string immediately before the caller writes it.
5. Preserve projectfmt failures and diagnostics; do not silently invoke a
   different formatter when the selected one is unavailable or fails.
6. Add a test using a representative destination-project fixture and its real
   formatter configuration.

Use the runtime-appropriate import:

```ts
// Node / npm
import { formatSource } from "projectfmt";

// Deno / JSR
import { formatSource } from "@gadicc/projectfmt";
```

Integrate around the eventual output path:

```ts
const rendered = renderModule(model);
const filePath = path.resolve(projectRoot, "src/generated/model.ts");

const formatted = await formatSource(rendered, {
  filePath,
  projectRoot,
});

await writeTextFile(filePath, formatted);
```

Keep the source in memory while formatting. The intended file does not need to
exist, but its path controls configuration discovery, parser selection, ignore
rules, plugins, and monorepo selection.

## Choose options deliberately

- Prefer an explicit `projectRoot` when the caller already knows its project or
  workspace boundary. Discovery never searches above it.
- Use the absolute-path shorthand only when automatic root inference is the
  intended behavior: `formatSource(source, absoluteFilePath)`.
- Keep the default `formatter: "auto"` to honor the destination project. Use an
  explicit formatter only when the calling feature promises that behavior.
- Set `strict: true` when no configured formatter or an equal-ranked ambiguity
  must fail. Default non-strict auto mode returns unchanged source when no
  formatter is configured.
- Set `formatOnly: true` when the operation must never apply lint fixes or
  assist actions. This changes Biome from configured `check --write` behavior
  to formatting only; Prettier and Deno are already format-only.
- Use `formatter: "none"` only for an explicit formatting opt-out.

Do not infer `projectRoot` from the process working directory for relative
paths. Relative `filePath` values require an explicit `projectRoot`, and paths
must resolve to descendant files within that boundary.

## Inspect resolution and failures

Use `formatSourceWithResult` when the caller needs `changed`, `ignored`, or full
resolution diagnostics. Use `resolveFormatter` to diagnose selection without
formatting:

```ts
import { resolveFormatter } from "projectfmt";

const resolution = await resolveFormatter({ filePath, projectRoot });
console.log(resolution.status, resolution.formatter, resolution.reason);
```

Handle `FormatterResolutionError` for invalid options, strict-mode ambiguity,
missing configuration, or unavailable selected implementations. Handle
`FormatterExecutionError` for configuration, parsing, loading, or subprocess
failures. Preserve their structured fields, `stderr`, and `cause` when wrapping
them.

Availability does not change selection. Never fall through from an unavailable
selected formatter to another candidate.

## Respect the trust boundary

Treat destination projects as trusted code. Prettier configurations and plugins
can execute JavaScript, Biome runs the project's local native binary, and Deno
fmt runs the `deno` executable on `PATH`. `projectRoot` bounds discovery and
resolution; it is not a sandbox.

Do not add network access, package installation, or temporary destination files
to an integration. Ensure the destination project already provides the selected
formatter implementation.

## Extend only when required

Use built-in adapters for Prettier, Biome, and Deno. Add a custom
`FormatterAdapter` only for a genuinely different formatter or project signal,
and normally require an explicit `projectRoot` because automatic inference
cannot know custom project markers.

Implement all three adapter stages: `discover`, `probe`, and `format`. Return
absolute in-bound evidence paths, keep adapter names unique, and honor
`context.formatOnly`. Test custom adapter validation and failure wrapping as
well as successful formatting.
