import { assert, assertEquals, assertRejects, assertThrows } from "@std/assert";
import { join } from "node:path";

import { runCommand } from "../process.ts";
import { denoExtensionTable, denoFormatInvocationFromHelp } from "./deno.ts";

const expectedSuffixes = [
  "js",
  "cjs",
  "mjs",
  "ts",
  "cts",
  "mts",
  "jsx",
  "tsx",
  "md",
  "mkd",
  "mkdn",
  "mdwn",
  "mdown",
  "markdown",
  "json",
  "jsonc",
  "css",
  "html",
  "xml",
  "svg",
  "njk",
  "vto",
  "yml",
  "yaml",
  "scss",
  "less",
  "ipynb",
  "astro",
  "svelte",
  "vue",
  "sql",
].sort();

const stableHelp = `
      --ext <ext>  [possible values: ts, tsx, js, jsx, md, json, jsonc, css, html, xml, yml, yaml, astro, sql]
`;

Deno.test("Deno extension compatibility accounts for every previous suffix", () => {
  assertEquals(Object.keys(denoExtensionTable).sort(), expectedSuffixes);
  for (const alias of ["mkd", "mkdn", "mdwn", "mdown", "markdown"]) {
    assertEquals(denoExtensionTable[alias], {
      extension: "md",
      disposition: "alias",
    });
    assertEquals(
      denoFormatInvocationFromHelp(alias, stableHelp),
      { extension: "md", flags: [] },
    );
  }
});

Deno.test("Deno invocation follows advertised extensions and optional flags", () => {
  assertEquals(
    denoFormatInvocationFromHelp("css", `${stableHelp}\n--unstable-css`),
    { extension: "css", flags: ["--unstable-css"] },
  );
  assertEquals(
    denoFormatInvocationFromHelp("css", stableHelp),
    { extension: "css", flags: [] },
  );
  assertEquals(
    denoFormatInvocationFromHelp("xml", stableHelp),
    { extension: "xml", flags: [] },
  );
  assertThrows(
    () =>
      denoFormatInvocationFromHelp(
        "svg",
        stableHelp.replace(", xml", ""),
      ),
    Error,
    "does not support the intended .svg file type",
  );
  assertThrows(
    () => denoFormatInvocationFromHelp("ts", "help without ext values"),
    Error,
    "Could not parse advertised --ext values",
  );
});

Deno.test("Deno invocation agrees with the selected runtime help", async () => {
  const help = await runCommand(Deno.execPath(), ["fmt", "--help"], {
    cwd: Deno.cwd(),
  });
  assertEquals(help.code, 0);
  for (const [suffix, spec] of Object.entries(denoExtensionTable)) {
    try {
      const invocation = denoFormatInvocationFromHelp(suffix, help.stdout);
      assertEquals(invocation.extension, spec.extension);
      assertEquals(
        invocation.flags,
        spec.flag && help.stdout.includes(spec.flag) ? [spec.flag] : [],
      );
    } catch (error) {
      assert(error instanceof Error);
      assert(error.message.includes(`.${suffix} file type`));
    }
  }
});

Deno.test("Deno's CLI oracle honors include and ordered exclusion fixtures", async () => {
  const directory = await Deno.makeTempDir({
    prefix: "projectfmt deno oracle ",
  });
  try {
    const cases = [
      {
        fixture: "include",
        expected: { "value.ts": false, "value.tsx": false, "value.js": true },
      },
      {
        fixture: "ordered",
        expected: { "keep.ts": false, "other.ts": true },
      },
    ] as const;
    for (const item of cases) {
      for (const [name, expectedIgnored] of Object.entries(item.expected)) {
        const root = join(directory, item.fixture, name);
        const sourceDirectory = join(root, "src", "nested");
        await Deno.mkdir(sourceDirectory, { recursive: true });
        const configPath = join(root, "deno.json");
        await Deno.writeTextFile(
          configPath,
          await Deno.readTextFile(
            join(
              Deno.cwd(),
              "tests",
              "fixtures",
              "deno",
              item.fixture,
              "deno.json",
            ),
          ),
        );
        const path = item.fixture === "ordered"
          ? join(root, "src", name)
          : join(sourceDirectory, name);
        await Deno.writeTextFile(path, "const  value=1");
        const result = await runCommand(
          Deno.execPath(),
          [
            "fmt",
            "--check",
            "--no-editorconfig",
            "--config",
            configPath,
          ],
          { cwd: root },
        );
        assertEquals(
          result.stderr.includes("No target files found"),
          expectedIgnored,
          `${item.fixture}/${name}`,
        );
      }
    }
  } finally {
    await Deno.remove(directory, { recursive: true });
    await assertRejects(() => Deno.stat(directory), Deno.errors.NotFound);
  }
});
