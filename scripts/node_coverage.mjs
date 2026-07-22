import assert from "node:assert/strict";
import { test } from "node:test";
import { cp, mkdir, mkdtemp, readdir, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  formatSource,
  formatSourceWithResult,
  FormatterResolutionError,
  resolveFormatter,
} from "../npm/esm/main.js";
import { runCommand } from "../npm/esm/scripts/node_process_harness.js";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const largeInput = "x".repeat(8 * 1024 * 1024);

async function copyPackage(source, packageName, destinationRoot) {
  const destination = join(
    destinationRoot,
    "node_modules",
    ...packageName.split("/"),
  );
  await mkdir(dirname(destination), { recursive: true });
  await cp(source, destination, { recursive: true, dereference: true });
}

test("the generated process wrapper handles early stdin closure", async () => {
  const result = await runCommand(
    process.execPath,
    ["-e", "process.exit(9)"],
    { cwd: projectRoot, input: largeInput },
  );
  assert.equal(result.code, 9);
  assert.equal(result.signal, null);
});

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

  const temporaryParent = await mkdtemp(
    join(tmpdir(), "projectfmt-node-biome-"),
  );
  const configlessRoot = join(temporaryParent, "project");
  const temporaryVariables = ["TMPDIR", "TMP", "TEMP"];
  const previousTemporaryVariables = Object.fromEntries(
    temporaryVariables.map((name) => [name, process.env[name]]),
  );
  try {
    await mkdir(configlessRoot);
    const biomePackage = await realpath(
      join(projectRoot, "node_modules", "@biomejs", "biome"),
    );
    const cliPackageName = process.platform === "win32"
      ? `@biomejs/cli-win32-${process.arch}`
      : `@biomejs/cli-${process.platform}-${process.arch}`;
    const cliPackage = await realpath(
      join(biomePackage, "..", cliPackageName.split("/")[1]),
    );
    await copyPackage(biomePackage, "@biomejs/biome", configlessRoot);
    await copyPackage(cliPackage, cliPackageName, configlessRoot);
    for (const name of temporaryVariables) process.env[name] = temporaryParent;

    assert.equal(
      await formatSource('const value="configless"', {
        formatter: "biome",
        filePath: "src/generated.ts",
        projectRoot: configlessRoot,
        formatOnly: true,
      }),
      'const value = "configless";\n',
    );
    assert.equal(
      (await readdir(temporaryParent)).some((name) =>
        name.startsWith("projectfmt-biome-")
      ),
      false,
    );
  } finally {
    for (const name of temporaryVariables) {
      const previous = previousTemporaryVariables[name];
      if (previous === undefined) delete process.env[name];
      else process.env[name] = previous;
    }
    await rm(temporaryParent, { recursive: true, force: true });
  }

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
