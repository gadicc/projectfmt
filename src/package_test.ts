import { assertEquals } from "@std/assert";
import { realpath } from "node:fs/promises";
import { join } from "node:path";

import { resolveProjectPackage } from "./package.ts";

async function writePackage(directory: string, name: string): Promise<void> {
  await Deno.mkdir(directory, { recursive: true });
  await Deno.writeTextFile(
    join(directory, "package.json"),
    JSON.stringify({ name, main: "index.cjs" }),
  );
  await Deno.writeTextFile(
    join(directory, "index.cjs"),
    "module.exports = {};\n",
  );
}

async function linkDirectory(target: string, path: string): Promise<void> {
  await Deno.symlink(target, path, {
    type: Deno.build.os === "windows" ? "junction" : "dir",
  });
}

Deno.test("resolveProjectPackage accepts a local package through a symlinked root", async () => {
  const parent = await Deno.makeTempDir({ prefix: "projectfmt package root " });
  const physicalRoot = join(parent, "physical");
  const linkedRoot = join(parent, "linked");
  const packageEntry = join(
    physicalRoot,
    "node_modules",
    "local-package",
    "index.cjs",
  );
  try {
    await writePackage(join(packageEntry, ".."), "local-package");
    await Deno.mkdir(join(physicalRoot, "src"));
    await linkDirectory(physicalRoot, linkedRoot);
    assertEquals(
      resolveProjectPackage(
        "local-package",
        join(linkedRoot, "src"),
        linkedRoot,
      ),
      await realpath(packageEntry),
    );
  } finally {
    await Deno.remove(parent, { recursive: true });
  }
});

Deno.test("resolveProjectPackage rejects a package symlink escaping the physical root", async () => {
  const parent = await Deno.makeTempDir({
    prefix: "projectfmt package escape ",
  });
  const physicalRoot = join(parent, "physical");
  const outsidePackage = join(parent, "outside-package");
  const linkedRoot = join(parent, "linked");
  try {
    await writePackage(outsidePackage, "escaping-package");
    await Deno.mkdir(join(physicalRoot, "node_modules"), { recursive: true });
    await Deno.mkdir(join(physicalRoot, "src"));
    await linkDirectory(
      outsidePackage,
      join(physicalRoot, "node_modules", "escaping-package"),
    );
    await linkDirectory(physicalRoot, linkedRoot);
    assertEquals(
      resolveProjectPackage(
        "escaping-package",
        join(linkedRoot, "src"),
        linkedRoot,
      ),
      null,
    );
  } finally {
    await Deno.remove(parent, { recursive: true });
  }
});

Deno.test("resolveProjectPackage returns null for a missing package", async () => {
  const root = await Deno.makeTempDir({
    prefix: "projectfmt package missing ",
  });
  try {
    assertEquals(resolveProjectPackage("missing-package", root, root), null);
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});
