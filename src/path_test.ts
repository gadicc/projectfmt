import { assertEquals } from "@std/assert";
import { join, resolve } from "node:path";

import { ancestorDirectories } from "./path.ts";

Deno.test("ancestorDirectories stays within the project root", () => {
  const projectRoot = resolve("project");

  assertEquals(
    ancestorDirectories(
      join(projectRoot, "src", "generated", "schema.ts"),
      projectRoot,
    ),
    [
      join(projectRoot, "src", "generated"),
      join(projectRoot, "src"),
      projectRoot,
    ],
  );
  assertEquals(ancestorDirectories(projectRoot, projectRoot), []);
  assertEquals(
    ancestorDirectories(join(projectRoot, "..", "outside.ts"), projectRoot),
    [],
  );
});
