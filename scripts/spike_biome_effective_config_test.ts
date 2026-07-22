import { assertEquals } from "@std/assert";

import { formatSourceWithResult } from "../main.ts";

interface Observation {
  rowId: string;
  repeat: number;
  code: number;
  signal: string | null;
  stdout: string;
  stderr: string;
  classification: string;
}

interface Report {
  schemaVersion: number;
  biomeVersion: string;
  rows: Observation[];
}

async function report(command: string, args: string[]): Promise<Report> {
  const output = await new Deno.Command(command, {
    args,
    cwd: Deno.cwd(),
    stdout: "piped",
    stderr: "piped",
  }).output();
  assertEquals(output.code, 0, new TextDecoder().decode(output.stderr));
  return JSON.parse(new TextDecoder().decode(output.stdout)) as Report;
}

function normalized(row: Observation) {
  return {
    rowId: row.rowId,
    code: row.code,
    signal: row.signal,
    classification: row.classification,
  };
}

Deno.test("Biome effective-config probes agree across Deno and Node", async () => {
  const deno = await report(Deno.execPath(), [
    "run",
    "-A",
    "scripts/spike_biome_effective_config.ts",
    "--self-test",
  ]);
  const node = await report("node", [
    "scripts/spike_biome_effective_config_node.mjs",
    "--self-test",
  ]);
  assertEquals(deno.schemaVersion, 1);
  assertEquals(node.schemaVersion, 1);
  assertEquals(deno.biomeVersion, node.biomeVersion);
  assertEquals(deno.rows.length, 6 * 4 * 2);
  assertEquals(node.rows.length, deno.rows.length);

  for (const current of [deno, node]) {
    const groups = Map.groupBy(current.rows, (row) => row.rowId);
    assertEquals(groups.size, 6 * 4);
    for (const rows of groups.values()) {
      assertEquals(rows.length, 2);
      const [first, second] = rows;
      assertEquals(
        { ...first, repeat: 0 },
        { ...second, repeat: 0 },
        first.rowId,
      );
    }
  }
  assertEquals(deno.rows.map(normalized), node.rows.map(normalized));

  const combined = deno.rows.find((row) =>
    row.rowId === "lint-only/check-write" && row.repeat === 1
  )!;
  const format = deno.rows.find((row) =>
    row.rowId === "lint-only/format" && row.repeat === 1
  )!;
  assertEquals(combined.stdout, "let value = 1;\nconsole.log(value);\n");
  assertEquals(format.stdout, "let value: number = 1;\nconsole.log(value);\n");
  assertEquals(
    deno.rows.find((row) =>
      row.rowId === "empty-success/check-write" && row.repeat === 1
    )?.classification,
    "empty-success",
  );
});

Deno.test("the current adapter preserves the exact lint-only contract", async () => {
  const source = "let     value: number=1;console.log(value)";
  const options = {
    formatter: "biome" as const,
    filePath: "tests/fixtures/biome/src/lint-only/rule.ts",
    projectRoot: Deno.cwd(),
  };
  const defaultResult = await formatSourceWithResult(source, options);
  assertEquals(defaultResult.source, "let     value=1;console.log(value)");
  assertEquals(defaultResult.ignored, false);
  const formatOnly = await formatSourceWithResult(source, {
    ...options,
    formatOnly: true,
  });
  assertEquals(formatOnly.source, source);
  assertEquals(formatOnly.ignored, true);
});
