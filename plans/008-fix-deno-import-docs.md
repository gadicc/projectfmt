# Plan 008: Show runtime-correct Deno imports

> **Executor instructions**: Follow this plan in order and run every
> verification command. Stop and report instead of improvising when a STOP
> condition occurs. Update this plan's row in `plans/README.md` when done unless
> a reviewer maintains the index.
>
> **Drift check (run first)**: `git diff --stat 5ff23b4..HEAD -- README.md`
>
> **Earlier-plan rebase (when following numeric order)**: Plans 001–007 may
> already have committed README changes. Those completed-plan edits are expected
> and must not trigger a drift STOP by themselves. Re-read the landed README,
> preserve its new behavior claims, and treat the excerpts below as
> reference-only. Stop only if the live installation/package-alias contract no
> longer supports the runtime-specific correction described here.

## Status

- **Priority**: P1
- **Effort**: S
- **Risk**: LOW
- **Depends on**: none
- **Category**: docs
- **Planned at**: commit `5ff23b4`, 2026-07-22

## Why this matters

The README tells Deno users to add the scoped JSR package but its Quick Start
and custom-adapter examples import the npm-only bare name. A copy-pasted first
example therefore fails in the project's primary runtime. Split runtime examples
and keep the JSR alias consistent with deno.json.

## Current state

- `README.md` installs `jsr:@gadicc/projectfmt`.
- The Quick Start and custom-adapter example import from projectfmt.
- `deno.json` publishes @gadicc/projectfmt while npm publishes projectfmt.

```ts
// README.md:24-31
import { formatSource } from "projectfmt";

const formatted = await formatSource(generatedSource, {
  filePath: "src/generated/schema.ts",
  projectRoot,
});
```

```text
# README.md:71-83
Deno / JSR:
deno add jsr:@gadicc/projectfmt

Node / npm:
npm install projectfmt
```

```ts
// README.md:217-223
// Custom adapters
import type { FormatterAdapter } from "projectfmt";
```

Repository constraints to preserve:

- Keep npm examples using projectfmt and Deno examples using @gadicc/projectfmt
  or explicit jsr: syntax.
- Do not imply that projectfmt installs destination formatters.
- Do not change public API names or runtime code.

## Commands you will need

| Purpose             | Command                      | Expected on success |
| ------------------- | ---------------------------- | ------------------- |
| Markdown formatting | `deno fmt --check README.md` | exit 0              |
| Doc lint            | `deno task doclint`          | exit 0              |
| Full gate           | `deno task check`            | exit 0              |

## Reference material

- [Deno dependency guide](https://docs.deno.com/examples/add_remove_dependencies_tutorial/)

## Scope

**In scope** (the only files to modify):

- `README.md`

**Out of scope**:

- Source, tests, manifests, generated npm output, or package naming.
- Adding a separate documentation site.
- Changing installation commands.

**Administrative exception**:

- `plans/README.md` may be modified only to update plan 008's status cell.
- Ignore that one status-cell edit when checking scope cleanliness; any other
  `plans/README.md` change remains out of scope.

## Git workflow

- Branch: `codex/008-fix-deno-import-docs`
- Conventional Commit subject: `docs(readme): show runtime-correct imports`
- Do not push or open a PR unless instructed.

## Steps

### Step 1: Split the Quick Start by runtime

Label the two one-line import examples exactly `Deno / JSR import` and
`Node / npm import`, adjacent to the shared call example. Use @gadicc/projectfmt
for the alias created by deno add and projectfmt for Node. Avoid duplicating the
full usage block when two one-line import snippets suffice; each labeled code
fence must remain independently copyable.

**Verify**: `rg -n '@gadicc/projectfmt|from "projectfmt"' README.md` → each
package name appears in a correctly labeled runtime section

### Step 2: Correct all secondary examples

Update the custom-adapter type import and every other runtime-specific example
found by a full README search. The custom-adapter section must show both labeled
specifier alternatives rather than leaving Deno readers with the npm name.

Run this structural assertion; unlike a token-presence search, it fails when an
import appears under the wrong runtime label or the custom-adapter section omits
one alternative:

```sh
deno eval '
const text = await Deno.readTextFile("README.md");
const lines = text.split("\n");
const rules = [
  { specifier: `from "@gadicc/projectfmt"`, label: "Deno / JSR import" },
  { specifier: `from "projectfmt"`, label: "Node / npm import" },
];
const runtimeLabels = lines.flatMap((line, index) =>
  rules.flatMap(({ label }) => line.includes(label) ? [{ label, index }] : [])
);
for (const { specifier, label } of rules) {
  const matches = lines.flatMap((line, index) => line.includes(specifier) ? [index] : []);
  if (matches.length < 2) throw new Error(`${label} is missing from Quick Start or Custom adapters`);
  for (const index of matches) {
    const nearest = runtimeLabels.filter((entry) => entry.index <= index).at(-1);
    if (!nearest || nearest.label !== label || index - nearest.index > 6) {
      throw new Error(`${specifier} is not under its nearest ${label}`);
    }
  }
}
const customStart = text.indexOf("### Custom adapters");
const customEnd = text.indexOf("\n## ", customStart);
if (customStart < 0) throw new Error("Custom adapters section is missing");
const custom = text.slice(customStart, customEnd < 0 ? undefined : customEnd);
for (const { specifier } of rules) {
  if (!custom.includes(specifier)) throw new Error(`Custom adapters omits ${specifier}`);
}
'
```

**Verify**: the command exits 0 with no output.

### Step 3: Run documentation gates

Check Markdown formatting, public API docs, and the normal repository gate.

**Verify**: `deno fmt --check README.md && deno task doclint && deno task check`
→ all commands exit 0

## Test plan

- No runtime test is required for this documentation-only change.
- The structural assertion maps every import to its nearest runtime label.
- The Deno install command and following import alias agree exactly.

## Done criteria

- [ ] A Deno user can copy installation plus import without editing the
      specifier.
- [ ] A Node user still sees the npm package name.
- [ ] README formatting and doclint pass.
- [ ] `deno task check` exits 0.
- [ ] Only `README.md` and the optional plan-008 status cell changed; verify
      with `git status --short` and `git diff -- plans/README.md`.
- [ ] `plans/README.md` marks this plan DONE unless the reviewer owns the index.

## STOP conditions

Stop and report if:

- After rebasing expected earlier README edits, the live package-alias contract
  no longer supports the runtime-specific correction.
- A verification fails twice after one focused correction.
- The implementation requires an out-of-scope file.
- Observed deno add alias behavior differs from the official guide; reproduce
  with a temporary deno.json and report.
- Fixing examples appears to require renaming a published package.

## Maintenance notes

- Verify installation and import examples together whenever package instructions
  change.
- Keep future custom-adapter examples runtime-neutral or show both specifiers.
