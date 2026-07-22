import { parse } from "@std/yaml";

type Mapping = Record<string, unknown>;

function fail(message: string): never {
  throw new Error(`CI configuration contract: ${message}`);
}

function mapping(value: unknown, name: string): Mapping {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    fail(`${name} must be a mapping`);
  }
  return value as Mapping;
}

function sequence(value: unknown, name: string): unknown[] {
  if (!Array.isArray(value)) fail(`${name} must be a sequence`);
  return value;
}

function steps(value: unknown, name: string): Mapping[] {
  return sequence(value, name).map((step, index) =>
    mapping(step, `${name}[${index}]`)
  );
}

function assertExact(
  actual: unknown,
  expected: unknown,
  message: string,
): void {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    fail(
      `${message}; expected ${JSON.stringify(expected)}, got ${
        JSON.stringify(actual)
      }`,
    );
  }
}

const setup = mapping(
  parse(await Deno.readTextFile(".github/actions/setup/action.yml")),
  "setup action",
);
const inputs = mapping(setup.inputs, "setup action inputs");
const nodeVersionInput = mapping(
  inputs["node-version"],
  "setup action node-version input",
);
assertExact(
  nodeVersionInput.default,
  "22",
  "setup action node-version default changed",
);

const setupRuns = mapping(setup.runs, "setup action runs");
const setupSteps = steps(setupRuns.steps, "setup action steps");
const setupNode = setupSteps.find((step) =>
  typeof step.uses === "string" &&
  /^actions\/setup-node@[0-9a-f]{40}$/.test(step.uses)
);
if (!setupNode) fail("pinned actions/setup-node step is missing");
assertExact(
  mapping(setupNode.with, "setup-node inputs")["node-version"],
  "${{ inputs.node-version }}",
  "setup-node must use the composite action input",
);

const tests = mapping(
  parse(await Deno.readTextFile(".github/workflows/tests.yml")),
  "tests workflow",
);
const jobs = mapping(tests.jobs, "tests workflow jobs");
const npmSmoke = mapping(jobs["npm-smoke"], "npm-smoke job");
const npmStrategy = mapping(npmSmoke.strategy, "npm-smoke strategy");
const npmMatrix = mapping(npmStrategy.matrix, "npm-smoke matrix");
assertExact(
  npmMatrix["node-version"],
  [22, 24, 26],
  "npm-smoke Node matrix changed",
);

const npmSteps = steps(npmSmoke.steps, "npm-smoke steps");
const localSetup = npmSteps.find((step) =>
  step.uses === "./.github/actions/setup"
);
if (!localSetup) fail("npm-smoke local setup step is missing");
assertExact(
  mapping(localSetup.with, "npm-smoke setup inputs")["node-version"],
  "${{ matrix.node-version }}",
  "npm-smoke setup must use the matrix Node version",
);
const npmRuns = npmSteps.map((step) => step.run).filter((run) =>
  typeof run === "string"
);
for (const command of ["deno task build:npm", "deno task test:npm"]) {
  if (!npmRuns.includes(command)) fail(`npm-smoke must run ${command}`);
}

const checks = mapping(jobs.checks, "checks job");
const checkRuns = steps(checks.steps, "checks steps").map((step) => step.run)
  .filter((run) => typeof run === "string");
for (const command of ["deno task check:ci", "deno task test:packages"]) {
  if (!checkRuns.includes(command)) fail(`checks must run ${command}`);
}

const platforms = mapping(jobs.platforms, "platforms job");
const platformStrategy = mapping(platforms.strategy, "platforms strategy");
const platformMatrix = mapping(platformStrategy.matrix, "platforms matrix");
assertExact(
  platformMatrix.os,
  ["macos-latest", "windows-latest"],
  "platform OS matrix changed",
);
const platformRuns = steps(platforms.steps, "platform steps").map((step) =>
  step.run
).filter((run) => typeof run === "string");
if (!platformRuns.includes("deno task check")) {
  fail("platform jobs must run deno task check");
}
