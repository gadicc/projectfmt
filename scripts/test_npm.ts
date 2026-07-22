import { join } from "node:path";

const root = Deno.cwd();
const npmDirectory = join(root, "npm");
const tempDirectory = await Deno.makeTempDir({
  prefix: "projectfmt npm smoke ",
});

async function run(
  command: string,
  args: string[],
  cwd: string,
): Promise<string> {
  const output = await new Deno.Command(command, {
    args,
    cwd,
    env: {
      ...Deno.env.toObject(),
      npm_config_cache: join(tempDirectory, "npm-cache"),
    },
    stdout: "piped",
    stderr: "piped",
  }).output();
  const stdout = new TextDecoder().decode(output.stdout);
  const stderr = new TextDecoder().decode(output.stderr);
  if (!output.success) {
    throw new Error(`${command} ${args.join(" ")} failed:\n${stdout}${stderr}`);
  }
  return stdout;
}

try {
  const packageJson = JSON.parse(
    await Deno.readTextFile(join(npmDirectory, "package.json")),
  );
  if (!packageJson.exports || !packageJson.types) {
    throw new Error("Built package is missing exports or declarations");
  }
  if (
    packageJson.name !== "projectfmt" || packageJson.dependencies ||
    packageJson.sideEffects !== false
  ) {
    throw new Error(
      "Built package metadata does not match the public contract",
    );
  }
  for (
    const target of [
      packageJson.types,
      packageJson.exports["."].types,
      packageJson.exports["."].import,
      packageJson.exports["."].require,
    ]
  ) {
    if (!(await Deno.stat(join(npmDirectory, target))).isFile) {
      throw new Error(`Built package export target is missing: ${target}`);
    }
  }
  const tarballName = (await run(
    "npm",
    ["pack", npmDirectory, "--pack-destination", tempDirectory, "--json"],
    root,
  )).trim();
  const packed = JSON.parse(tarballName) as Array<{ filename: string }>;
  const tarball = join(tempDirectory, packed[0].filename);
  await Deno.writeTextFile(
    join(tempDirectory, "package.json"),
    JSON.stringify({ private: true, type: "module" }),
  );
  await run(
    "npm",
    [
      "install",
      "--offline",
      "--ignore-scripts",
      "--no-audit",
      "--no-fund",
      tarball,
    ],
    tempDirectory,
  );
  await Deno.writeTextFile(
    join(tempDirectory, "smoke.mjs"),
    `import { formatSource, resolveFormatter } from "projectfmt";
const source = "const  value=1";
const output = await formatSource(source, {
  formatter: "none",
  filePath: "src/generated.ts",
  projectRoot: process.cwd(),
});
if (output !== source) throw new Error("none changed source");
const resolution = await resolveFormatter({
  formatter: "none",
  filePath: "src/generated.ts",
  projectRoot: process.cwd(),
});
if (resolution.status !== "disabled") throw new Error("bad resolution");
const projectRoot = ${JSON.stringify(root)};
const prettier = await formatSource('const value="node"', {
  formatter: "prettier",
  filePath: "tests/fixtures/prettier/node-smoke.ts",
  projectRoot,
});
if (prettier !== "const value = 'node'\\n") throw new Error("Prettier mismatch");
const biome = await formatSource('let value: number="node"', {
  formatter: "biome",
  filePath: "tests/fixtures/biome/node-smoke.ts",
  projectRoot,
});
if (biome !== "let value = 'node';\\n") throw new Error("Biome mismatch");
const deno = await formatSource('{"runtime":"node"}', {
  formatter: "deno",
  filePath: "tests/fixtures/deno/node-smoke.json",
  projectRoot,
});
if (deno !== '{ "runtime": "node" }\\n') throw new Error("Deno mismatch");
`,
  );
  await run("node", ["smoke.mjs"], tempDirectory);
  console.log(`npm tarball smoke passed: ${packed[0].filename}`);
} finally {
  await Deno.remove(tempDirectory, { recursive: true });
}
