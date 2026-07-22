import { assertEquals, assertRejects } from "@std/assert";

import { runCommand } from "./process.ts";

const largeInput = "x".repeat(8 * 1024 * 1024);

Deno.test("runCommand survives a child that exits before reading stdin", async () => {
  const result = await runCommand(
    Deno.execPath(),
    ["eval", "Deno.exit(7)"],
    { cwd: Deno.cwd(), input: largeInput },
  );
  assertEquals(result.code, 7);
  assertEquals(result.signal, null);
});

Deno.test("runCommand rejects when the executable cannot be spawned", async () => {
  await assertRejects(() =>
    runCommand(
      `projectfmt-missing-${crypto.randomUUID()}`,
      [],
      { cwd: Deno.cwd() },
    )
  );
});
