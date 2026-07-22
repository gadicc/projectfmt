import assert from "node:assert/strict";
import { test } from "node:test";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  formatSource,
  FormatterResolutionError,
  resolveFormatter,
} from "../npm/esm/main.js";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

test("the generated Node entry exercises the public resolution paths", async () => {
  const disabled = await formatSource("const  value=1", {
    formatter: "none",
    filePath: "generated.ts",
    projectRoot,
  });
  assert.equal(disabled, "const  value=1");

  const resolution = await resolveFormatter({
    filePath: "tests/fixtures/prettier/generated.ts",
    projectRoot,
  });
  assert.equal(resolution.status, "selected");
  assert.equal(resolution.formatter, "prettier");

  const prettier = await formatSource('const value="node"', {
    formatter: "prettier",
    filePath: "tests/fixtures/prettier/generated.ts",
    projectRoot,
  });
  assert.equal(prettier, "const value = 'node'\n");

  const biome = await formatSource('const value="node"', {
    formatter: "biome",
    filePath: "tests/fixtures/biome/generated.ts",
    projectRoot,
  });
  assert.match(biome, /const value = 'node';/);

  const deno = await formatSource('{"runtime":"node"}', {
    formatter: "deno",
    filePath: "tests/fixtures/deno/generated.json",
    projectRoot,
  });
  assert.equal(deno, '{ "runtime": "node" }\n');

  await assert.rejects(
    resolveFormatter({
      filePath: "tests/fixtures/ambiguous/generated.ts",
      projectRoot,
      strict: true,
    }),
    FormatterResolutionError,
  );
});
