import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { type FormatSourceOptions, formatSourceWithResult } from "../main.ts";

const projectRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const fixtureRoot = join(projectRoot, "tests", "fixtures", "prettier");
const source = 'export const value={message:"benchmark",items:[1,2,3]}';

export interface OperationScenario {
  name: string;
  options: FormatSourceOptions;
}

export const operationScenarios: readonly OperationScenario[] = [
  {
    name: "explicit-shallow",
    options: {
      formatter: "prettier",
      filePath: join(fixtureRoot, "generated-benchmark.ts"),
      projectRoot,
    },
  },
  {
    name: "explicit-nested",
    options: {
      formatter: "prettier",
      filePath: join(
        fixtureRoot,
        "src",
        "virtual",
        "deep",
        "generated-benchmark.ts",
      ),
      projectRoot,
    },
  },
  {
    name: "auto-shallow",
    options: {
      filePath: join(fixtureRoot, "generated-benchmark.ts"),
      projectRoot,
    },
  },
  {
    name: "auto-nested",
    options: {
      filePath: join(
        fixtureRoot,
        "src",
        "virtual",
        "deep",
        "generated-benchmark.ts",
      ),
      projectRoot,
    },
  },
];

export async function runOperationScenario(
  scenario: OperationScenario,
): Promise<void> {
  const result = await formatSourceWithResult(source, scenario.options);
  if (
    result.resolution.status !== "selected" ||
    result.resolution.formatter !== "prettier" || !result.changed
  ) {
    throw new Error(`${scenario.name} did not format with Prettier`);
  }
}

for (const scenario of operationScenarios) {
  Deno.bench(scenario.name, async () => {
    await runOperationScenario(scenario);
  });
}
