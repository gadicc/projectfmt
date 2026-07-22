# Contributing

Contributions and focused bug reports are welcome.

## Setup

Install Deno 2 and Node 20 or newer, then materialize the pinned development
dependencies:

```sh
deno install --frozen
```

Run the complete local gate before opening a pull request:

```sh
deno task pre-commit
deno task coverage
deno task test:packages
```

Tests are fixture-based and may create temporary directories. They must not
install packages or access the network at runtime. Add a real project config
fixture for built-in adapter behavior and use a custom adapter only when the
test is specifically about extension points.

## Changes

- Keep the main API source-string and intended-filepath first.
- Preserve the format-only contract; lint fixes and import organization require
  separate, explicitly named future operations.
- Treat project-local configuration, plugins, and binaries as trusted code and
  retain structured causes/stderr in failures.
- Use named ESM exports and keep Deno and Node behavior aligned.
- Use Conventional Commits, for example `fix(prettier): preserve plugin paths`.

Pull requests should explain the resolution/compatibility impact and list the
commands used for verification.
