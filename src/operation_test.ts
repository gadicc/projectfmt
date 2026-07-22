import { assertEquals, assertInstanceOf, assertRejects } from "@std/assert";
import { realpath } from "node:fs/promises";
import { join } from "node:path";

import { FormatterExecutionError } from "./errors.ts";
import { formatSource } from "../main.ts";
import {
  defaultOperationServices,
  formatOperation,
  type OperationServices,
  resolveOperation,
} from "./operation.ts";
import type { FormatterAdapter } from "./types.ts";

function countingAdapter(
  counters: { probes: number; formats: number },
): FormatterAdapter {
  return {
    name: "counting",
    priority: 100,
    discover(directory, context) {
      return Promise.resolve(
        directory === context.projectRoot
          ? [{
            formatter: "counting",
            kind: "custom",
            path: join(directory, "counting.config"),
            description: "counting adapter",
            strength: 30,
          }]
          : [],
      );
    },
    probe() {
      counters.probes++;
      return Promise.resolve({
        available: true,
        implementation: "in-process counting adapter",
      });
    },
    format(source) {
      counters.formats++;
      return Promise.resolve({ source: source.toUpperCase() });
    },
  };
}

function countingServices(counter: { adapterMaps: number }): OperationServices {
  return {
    ...defaultOperationServices,
    createAdapterMap(adapters, filePath, projectRoot) {
      counter.adapterMaps++;
      return defaultOperationServices.createAdapterMap(
        adapters,
        filePath,
        projectRoot,
      );
    },
  };
}

async function linkDirectory(target: string, path: string): Promise<void> {
  await Deno.symlink(target, path, {
    type: Deno.build.os === "windows" ? "junction" : "dir",
  });
}

async function writePrettierPackage(
  directory: string,
  label: string,
  counterKey: string,
): Promise<void> {
  await Deno.mkdir(directory, { recursive: true });
  await Deno.writeTextFile(
    join(directory, "package.json"),
    JSON.stringify({
      name: "prettier",
      version: `0.0.0-${label}`,
      type: "module",
      main: "index.mjs",
    }),
  );
  await Deno.writeTextFile(
    join(directory, "index.mjs"),
    `const counters = globalThis[${JSON.stringify(counterKey)}] ??= {};
const counter = counters[${JSON.stringify(label)}] ??= { loads: 0, formats: 0 };
counter.loads++;
export const version = "0.0.0-${label}";
export async function resolveConfig() { return {}; }
export async function getFileInfo() {
  return { ignored: false, inferredParser: "typescript" };
}
export async function format(source) {
  counter.formats++;
  return ${JSON.stringify(label)} + ":" + source;
}
`,
  );
}

Deno.test("one operation builds one adapter map and probes once", async () => {
  const projectRoot = await Deno.makeTempDir({
    prefix: "projectfmt operation counts ",
  });
  try {
    const counters = { adapterMaps: 0, probes: 0, formats: 0 };
    const adapter = countingAdapter(counters);
    const options = {
      formatter: "counting",
      filePath: "generated.custom",
      projectRoot,
      adapters: [adapter],
    };

    const formatted = await formatOperation(
      "source",
      options,
      countingServices(counters),
    );
    assertEquals(formatted.source, "SOURCE");
    assertEquals(counters, { adapterMaps: 1, probes: 1, formats: 1 });

    counters.adapterMaps = 0;
    counters.probes = 0;
    counters.formats = 0;
    const operation = await resolveOperation(
      options,
      countingServices(counters),
    );
    assertEquals(counters, { adapterMaps: 1, probes: 1, formats: 0 });
    const serialized = JSON.parse(JSON.stringify(operation.resolution));
    assertEquals(serialized.status, "selected");
    assertEquals(serialized.formatter, "counting");
    assertEquals("adapters" in serialized, false);
    assertEquals("formatContext" in serialized, false);
  } finally {
    await Deno.remove(projectRoot, { recursive: true });
  }
});

Deno.test("a format call snapshots its probed Prettier implementation", async () => {
  const projectRoot = await Deno.makeTempDir({
    prefix: "projectfmt operation snapshot ",
  });
  const original = join(projectRoot, "packages", "original");
  const replacement = join(projectRoot, "packages", "replacement");
  const packageLink = join(projectRoot, "node_modules", "prettier");
  const counterKey = `__projectfmt_${crypto.randomUUID().replaceAll("-", "")}`;
  const globalCounters = globalThis as
    & typeof globalThis
    & Record<string, Record<string, { loads: number; formats: number }>>;
  try {
    await writePrettierPackage(original, "original", counterKey);
    await writePrettierPackage(replacement, "replacement", counterKey);
    await Deno.mkdir(join(projectRoot, "node_modules"));
    await Deno.writeTextFile(join(projectRoot, ".prettierrc"), "{}");
    await linkDirectory(original, packageLink);

    const services: OperationServices = {
      ...defaultOperationServices,
      async afterProbe(operation) {
        assertEquals(
          operation.resolution.availability?.implementation,
          await realpath(join(original, "index.mjs")),
        );
        await Deno.remove(packageLink);
        await linkDirectory(replacement, packageLink);
      },
    };
    const options = {
      formatter: "prettier",
      filePath: "generated.ts",
      projectRoot,
    };
    const current = await formatOperation("source", options, services);
    assertEquals(current.source, "original:source");
    assertEquals(globalCounters[counterKey], {
      original: { loads: 1, formats: 1 },
    });

    assertEquals(globalCounters[counterKey].replacement, undefined);
  } finally {
    delete globalCounters[counterKey];
    await Deno.remove(projectRoot, { recursive: true });
  }
});

Deno.test("separate public calls observe fresh adapter availability", async () => {
  const projectRoot = await Deno.makeTempDir({
    prefix: "projectfmt operation freshness ",
  });
  try {
    let implementation = "original";
    const adapter: FormatterAdapter = {
      name: "freshness",
      discover(directory, context) {
        return Promise.resolve(
          directory === context.projectRoot
            ? [{
              formatter: "freshness",
              kind: "custom",
              path: join(directory, "freshness.config"),
              description: "freshness test",
              strength: 30,
            }]
            : [],
        );
      },
      probe() {
        return Promise.resolve({ available: true, implementation });
      },
      format(_source, context) {
        return Promise.resolve({
          source: context.availability!.implementation!,
        });
      },
    };
    const options = {
      formatter: adapter.name,
      filePath: "generated.custom",
      projectRoot,
      adapters: [adapter],
    };

    assertEquals(await formatSource("source", options), "original");
    implementation = "replacement";
    assertEquals(await formatSource("source", options), "replacement");
  } finally {
    await Deno.remove(projectRoot, { recursive: true });
  }
});

Deno.test("a missing snapshotted implementation fails during formatting", async () => {
  const projectRoot = await Deno.makeTempDir({
    prefix: "projectfmt operation missing snapshot ",
  });
  const implementation = join(projectRoot, "formatter.bin");
  try {
    await Deno.writeTextFile(implementation, "available");
    const adapter: FormatterAdapter = {
      name: "snapshot-missing",
      discover(directory, context) {
        return Promise.resolve(
          directory === context.projectRoot
            ? [{
              formatter: "snapshot-missing",
              kind: "custom",
              path: join(directory, "snapshot.config"),
              description: "snapshot test",
              strength: 30,
            }]
            : [],
        );
      },
      probe() {
        return Promise.resolve({ available: true, implementation });
      },
      async format(source, context) {
        await Deno.readTextFile(context.availability!.implementation!);
        return { source };
      },
    };
    const error = await assertRejects(
      () =>
        formatOperation("source", {
          formatter: adapter.name,
          filePath: "generated.custom",
          projectRoot,
          adapters: [adapter],
        }, {
          ...defaultOperationServices,
          async afterProbe() {
            await Deno.remove(implementation);
          },
        }),
      FormatterExecutionError,
    );
    assertEquals(error.code, "FORMATTER_FAILED");
    assertEquals(error.formatter, adapter.name);
    assertEquals(error.filePath, join(projectRoot, "generated.custom"));
    assertEquals(error.projectRoot, projectRoot);
    assertInstanceOf(error.cause, Deno.errors.NotFound);
    assertEquals(error.stderr, undefined);
  } finally {
    await Deno.remove(projectRoot, { recursive: true });
  }
});
