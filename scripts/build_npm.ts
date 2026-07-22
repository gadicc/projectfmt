import { build } from "@deno/dnt";
import { join } from "node:path";

import denoJson from "../deno.json" with { type: "json" };

const repositoryRoot = Deno.cwd();
const outputDirectory = join(repositoryRoot, "npm");
const testInternals = Deno.args.length === 1 &&
  Deno.args[0] === "--test-internals";
if (Deno.args.length > 0 && !testInternals) {
  throw new Error(`Unknown build_npm argument: ${Deno.args.join(" ")}`);
}
const stagingDirectory = await Deno.makeTempDir({
  prefix: ".projectfmt-npm-",
});

async function removeIfPresent(path: string): Promise<void> {
  try {
    await Deno.remove(path, { recursive: true });
  } catch (error) {
    if (!(error instanceof Deno.errors.NotFound)) throw error;
  }
}

async function copyDirectory(
  source: string,
  destination: string,
): Promise<void> {
  await Deno.mkdir(destination, { recursive: true });
  for await (const entry of Deno.readDir(source)) {
    const sourcePath = join(source, entry.name);
    const destinationPath = join(destination, entry.name);
    if (entry.isDirectory) {
      await copyDirectory(sourcePath, destinationPath);
    } else if (entry.isFile) {
      await Deno.copyFile(sourcePath, destinationPath);
    } else if (entry.isSymlink) {
      await Deno.symlink(await Deno.readLink(sourcePath), destinationPath);
    }
  }
}

const npmBuild = build({
  entryPoints: [
    "./main.ts",
    ...(testInternals
      ? [{
        name: "./__test__/process",
        path: "./scripts/node_process_harness.ts",
        kind: "export" as const,
      }]
      : []),
  ],
  outDir: stagingDirectory,
  importMap: "deno.json",
  shims: { deno: false },
  skipNpmInstall: true,
  test: false,
  // Deno type-checks the source in the normal gate. dnt's isolated compiler
  // does not install @types/node when skipNpmInstall is enabled.
  typeCheck: false,
  package: {
    name: "projectfmt",
    version: denoJson.version,
    description: denoJson.description,
    author: "Gadi Cohen <dragon@wastelands.net>",
    license: "MIT",
    type: "module",
    repository: {
      type: "git",
      url: "git+https://github.com/gadicc/projectfmt.git",
    },
    bugs: { url: "https://github.com/gadicc/projectfmt/issues" },
    homepage: "https://github.com/gadicc/projectfmt#readme",
    keywords: [
      "formatter",
      "codegen",
      "prettier",
      "biome",
      "deno",
      "monorepo",
      "typescript",
    ],
    engines: { node: ">=22.0.0" },
    peerDependencies: {
      "@biomejs/biome": denoJson.imports["@biomejs/biome"].split("@").pop()!,
      "prettier": denoJson.imports.prettier.split("@").pop()!,
    },
    peerDependenciesMeta: {
      "@biomejs/biome": { optional: true },
      prettier: { optional: true },
    },
  },
  postBuild() {
    const packageJsonPath = join(stagingDirectory, "package.json");
    const packageJson = JSON.parse(Deno.readTextFileSync(packageJsonPath));
    packageJson.types = "./esm/main.d.ts";
    packageJson.sideEffects = false;
    packageJson.exports["."] = {
      types: "./esm/main.d.ts",
      ...packageJson.exports["."],
    };
    const harnessPath = join(
      stagingDirectory,
      "esm",
      "scripts",
      "node_process_harness.js",
    );
    const harnessExport = packageJson.exports["./__test__/process"];
    let harnessExists = true;
    try {
      if (!Deno.statSync(harnessPath).isFile) harnessExists = false;
    } catch (error) {
      if (error instanceof Deno.errors.NotFound) harnessExists = false;
      else throw error;
    }
    if (testInternals) {
      if (!harnessExists) {
        throw new Error(`Expected generated test harness at ${harnessPath}`);
      }
      if (
        !harnessExport || typeof harnessExport !== "object" ||
        harnessExport.import !== "./esm/scripts/node_process_harness.js"
      ) {
        throw new Error(
          "Generated package is missing ./__test__/process import export",
        );
      }
    } else if (harnessExists || harnessExport !== undefined) {
      throw new Error(
        "Ordinary npm build unexpectedly exposed the test harness",
      );
    }
    Deno.writeTextFileSync(
      packageJsonPath,
      `${JSON.stringify(packageJson, null, 2)}\n`,
    );
    Deno.copyFileSync("LICENSE.txt", join(stagingDirectory, "LICENSE.txt"));
    Deno.copyFileSync("README.md", join(stagingDirectory, "README.md"));
  },
});

try {
  await npmBuild;
  await removeIfPresent(outputDirectory);
  await copyDirectory(stagingDirectory, outputDirectory);
} finally {
  await removeIfPresent(stagingDirectory);
}
