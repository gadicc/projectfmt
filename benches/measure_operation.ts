import { cpus } from "node:os";

import { operationScenarios, runOperationScenario } from "./operation_bench.ts";

interface ScenarioMeasurement {
  batchMediansMs: number[];
  medianOfMediansMs: number;
  p95Ms: number;
}

interface MeasurementFile {
  metadata: {
    commit: string;
    deno: string;
    v8: string;
    typescript: string;
    os: string;
    arch: string;
    cpu: string;
  };
  parameters: {
    warmups: number;
    batches: number;
    iterations: number;
  };
  scenarios: Record<string, ScenarioMeasurement>;
  comparison?: Record<string, { changePercent: number }>;
}

function option(name: string): string | undefined {
  const index = Deno.args.indexOf(name);
  return index === -1 ? undefined : Deno.args[index + 1];
}

function positiveInteger(name: string, fallback: number): number {
  const raw = option(name);
  if (raw === undefined) return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`${name} must be a positive integer`);
  }
  return value;
}

function median(values: readonly number[]): number {
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[middle - 1] + sorted[middle]) / 2
    : sorted[middle];
}

function percentile(values: readonly number[], percentile: number): number {
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.ceil(percentile * sorted.length) - 1];
}

async function gitCommit(): Promise<string> {
  const output = await new Deno.Command("git", {
    args: ["rev-parse", "HEAD"],
    stdout: "piped",
  }).output();
  if (!output.success) throw new Error("Could not determine benchmark commit");
  return new TextDecoder().decode(output.stdout).trim();
}

const outputPath = option("--output");
if (!outputPath) throw new Error("--output is required");
const baselinePath = option("--baseline");
const batches = positiveInteger("--batches", 3);
const iterations = positiveInteger("--iterations", 30);
const warmups = 5;

const measurement: MeasurementFile = {
  metadata: {
    commit: await gitCommit(),
    deno: Deno.version.deno,
    v8: Deno.version.v8,
    typescript: Deno.version.typescript,
    os: Deno.build.os,
    arch: Deno.build.arch,
    cpu: cpus()[0]?.model ?? "unknown",
  },
  parameters: { warmups, batches, iterations },
  scenarios: {},
};

for (const scenario of operationScenarios) {
  for (let index = 0; index < warmups; index++) {
    await runOperationScenario(scenario);
  }
  const observations: number[] = [];
  const batchMediansMs: number[] = [];
  for (let batch = 0; batch < batches; batch++) {
    const batchObservations: number[] = [];
    for (let iteration = 0; iteration < iterations; iteration++) {
      const start = performance.now();
      await runOperationScenario(scenario);
      const elapsed = performance.now() - start;
      observations.push(elapsed);
      batchObservations.push(elapsed);
    }
    batchMediansMs.push(median(batchObservations));
  }
  measurement.scenarios[scenario.name] = {
    batchMediansMs,
    medianOfMediansMs: median(batchMediansMs),
    p95Ms: percentile(observations, 0.95),
  };
  try {
    await Deno.stat(scenario.options.filePath);
    throw new Error(`${scenario.name} wrote its virtual destination file`);
  } catch (error) {
    if (!(error instanceof Deno.errors.NotFound)) throw error;
  }
}

if (baselinePath) {
  const baseline = JSON.parse(
    await Deno.readTextFile(baselinePath),
  ) as MeasurementFile;
  const comparison: Record<string, { changePercent: number }> = {};
  for (const scenario of operationScenarios) {
    const before = baseline.scenarios[scenario.name]?.medianOfMediansMs;
    const after = measurement.scenarios[scenario.name].medianOfMediansMs;
    if (typeof before !== "number" || before <= 0) {
      throw new Error(`Baseline is missing scenario ${scenario.name}`);
    }
    const changePercent = ((after / before) - 1) * 100;
    comparison[scenario.name] = { changePercent };
    if (changePercent > 5) {
      throw new Error(
        `${scenario.name} regressed ${changePercent.toFixed(2)}% (limit 5%)`,
      );
    }
  }
  measurement.comparison = comparison;
}

await Deno.writeTextFile(
  outputPath,
  `${JSON.stringify(measurement, null, 2)}\n`,
);
console.log(JSON.stringify(measurement, null, 2));
