import { join } from "node:path";

import { assertEquals, assertRejects } from "@std/assert";

import { importModule } from "./module-loader.ts";

Deno.test("importModule loads an absolute ESM path", async () => {
  const directory = await Deno.makeTempDir({
    prefix: "projectfmt module loader ",
  });
  try {
    const path = join(directory, "implementation.mjs");
    await Deno.writeTextFile(path, "export const value = 'loaded';\n");

    const module = await importModule(path);

    assertEquals(module.value, "loaded");
  } finally {
    await Deno.remove(directory, { recursive: true });
  }
});

Deno.test("importModule preserves module evaluation failures", async () => {
  const directory = await Deno.makeTempDir({
    prefix: "projectfmt module loader failure ",
  });
  const marker = "projectfmt-module-loader-error";
  const cause = new Error("module evaluation failed");
  try {
    const path = join(directory, "broken.mjs");
    (globalThis as Record<string, unknown>)[marker] = cause;
    await Deno.writeTextFile(
      path,
      `throw globalThis[${JSON.stringify(marker)}];\n`,
    );

    const error = await assertRejects(() => importModule(path));

    assertEquals(error, cause);
  } finally {
    delete (globalThis as Record<string, unknown>)[marker];
    await Deno.remove(directory, { recursive: true });
  }
});
