import assert from "node:assert/strict";
import { test } from "node:test";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  formatSource,
  formatSourceWithResult,
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

  const absolutePrettierPath = resolve(
    projectRoot,
    "tests/fixtures/prettier/shorthand.ts",
  );
  const shorthandResolution = await resolveFormatter(absolutePrettierPath);
  assert.equal(shorthandResolution.formatter, "prettier");
  assert.equal(
    await formatSource('const shorthand="node"', absolutePrettierPath),
    "const shorthand = 'node'\n",
  );
  const shorthandResult = await formatSourceWithResult(
    'const result="node"',
    absolutePrettierPath,
  );
  assert.equal(shorthandResult.source, "const result = 'node'\n");
  assert.equal(shorthandResult.changed, true);

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
