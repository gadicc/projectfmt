import { build } from "@deno/dnt";
import { join } from "node:path";

import denoJson from "../deno.json" with { type: "json" };

const repositoryRoot = Deno.cwd();
const outputDirectory = join(repositoryRoot, "npm");
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
  entryPoints: ["./main.ts"],
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
    engines: { node: ">=20.0.0" },
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
