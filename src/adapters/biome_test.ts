import { assertEquals, assertRejects } from "@std/assert";
import { dirname } from "node:path";
import { readFile, stat } from "node:fs/promises";

import { withGeneratedBiomeConfig } from "./biome.ts";

Deno.test("withGeneratedBiomeConfig removes its directory after success", async () => {
  let directory = "";
  const result = await withGeneratedBiomeConfig(async (configPath) => {
    directory = dirname(configPath);
    assertEquals(await readFile(configPath, "utf8"), "{}\n");
    assertEquals((await stat(configPath)).isFile(), true);
    return "complete";
  });
  assertEquals(result, "complete");
  await assertRejects(() => stat(directory));
});

Deno.test("withGeneratedBiomeConfig removes its directory after failure", async () => {
  let directory = "";
  const expected = new Error("callback failed");
  const error = await assertRejects(() =>
    withGeneratedBiomeConfig((configPath) => {
      directory = dirname(configPath);
      return Promise.reject(expected);
    })
  );
  assertEquals(error, expected);
  await assertRejects(() => stat(directory));
});
