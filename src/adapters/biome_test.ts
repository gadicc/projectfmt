import { assertEquals, assertRejects } from "@std/assert";
import { dirname } from "node:path";
import { readFile, stat } from "node:fs/promises";

import {
  biomeAvailabilityFromVersionResult,
  withGeneratedBiomeConfig,
} from "./biome.ts";

Deno.test("Biome availability requires a successful version command", () => {
  assertEquals(
    biomeAvailabilityFromVersionResult("/project/biome", {
      code: 0,
      signal: null,
      stdout: "Version: 2.5.5\n",
      stderr: "",
    }),
    {
      available: true,
      implementation: "/project/biome",
      version: "2.5.5",
    },
  );
  assertEquals(
    biomeAvailabilityFromVersionResult("/project/biome", {
      code: 7,
      signal: null,
      stdout: "",
      stderr: "broken config\n",
    }),
    {
      available: false,
      implementation: "/project/biome",
      reason: "Biome --version exited 7: broken config",
    },
  );
  assertEquals(
    biomeAvailabilityFromVersionResult("/project/biome", {
      code: null,
      signal: "SIGTERM",
      stdout: "",
      stderr: "",
    }),
    {
      available: false,
      implementation: "/project/biome",
      reason: "Biome --version exited SIGTERM",
    },
  );
});

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
