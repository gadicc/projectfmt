import {
  assert,
  assertEquals,
  assertInstanceOf,
  assertRejects,
  assertStringIncludes,
} from "@std/assert";
import { describe, it } from "@std/testing/bdd";
import { join } from "node:path";

import {
  formatSource,
  formatSourceWithResult,
  type FormatterAdapter,
  FormatterExecutionError,
  FormatterResolutionError,
  resolveFormatter,
} from "./main.ts";

const root = Deno.cwd();
const fixture = (...parts: string[]) =>
  join(root, "tests", "fixtures", ...parts);

describe("resolveFormatter", () => {
  it("detects a Deno formatter task as project evidence", async () => {
    const resolution = await resolveFormatter({
      filePath: "src/generated/root.ts",
      projectRoot: root,
    });
    assertEquals(resolution.formatter, "deno");
    assert(
      resolution.evidence.some((item) =>
        item.formatter === "deno" && item.kind === "script"
      ),
    );
  });

  it("finds parent configuration relative to a virtual intended file", async () => {
    const resolution = await resolveFormatter({
      filePath: "tests/fixtures/prettier/src/generated/schema.ts",
      projectRoot: root,
    });
    assertEquals(resolution.status, "selected");
    assertEquals(resolution.formatter, "prettier");
    assertEquals(resolution.configRoot, fixture("prettier"));
    assertStringIncludes(resolution.reason, "nearest strongest");
    assert(resolution.availability?.implementation?.includes("node_modules"));
  });

  it("selects a nested monorepo formatter before a root formatter", async () => {
    const resolution = await resolveFormatter({
      filePath: "packages/biome/src/generated.ts",
      projectRoot: fixture("monorepo"),
    });
    // This fixture root intentionally cannot resolve the repository's dev
    // dependency; resolution selection remains independently diagnostic.
    assertEquals(resolution.formatter, "biome");
    assertEquals(
      resolution.configRoot,
      fixture("monorepo", "packages", "biome"),
    );
  });

  it("chooses configuration evidence over multiple installed hints", async () => {
    const resolution = await resolveFormatter({
      filePath: "tests/fixtures/multiple/generated.ts",
      projectRoot: root,
    });
    assertEquals(resolution.formatter, "prettier");
    assertEquals(resolution.ambiguous, false);
    assert(
      resolution.evidence.some((item) =>
        item.formatter === "biome" && item.kind === "dependency"
      ),
    );
  });

  it("uses deterministic precedence and reports equal-ranked ambiguity", async () => {
    const options = {
      filePath: "tests/fixtures/ambiguous/generated.ts",
      projectRoot: root,
    };
    const resolution = await resolveFormatter(options);
    assertEquals(resolution.formatter, "biome");
    assertEquals(resolution.ambiguous, true);
    assertStringIncludes(resolution.reason, "biome > prettier");
    await assertRejects(
      () => resolveFormatter({ ...options, strict: true }),
      FormatterResolutionError,
      "Equal-ranked",
    );
  });

  it("returns not-configured by default and errors in strict mode", async () => {
    const directory = await Deno.makeTempDir({ prefix: "projectfmt empty " });
    try {
      const options = { filePath: "generated.ts", projectRoot: directory };
      assertEquals((await resolveFormatter(options)).status, "not-configured");
      await assertRejects(
        () => resolveFormatter({ ...options, strict: true }),
        FormatterResolutionError,
        "No supported formatter",
      );
    } finally {
      await Deno.remove(directory, { recursive: true });
    }
  });

  it("reports an explicitly selected but unavailable formatter", async () => {
    const directory = await Deno.makeTempDir({
      prefix: "projectfmt unavailable ",
    });
    try {
      await Deno.writeTextFile(join(directory, ".prettierrc"), "{}");
      const options = {
        formatter: "prettier" as const,
        filePath: "generated.ts",
        projectRoot: directory,
      };
      const resolution = await resolveFormatter(options);
      assertEquals(resolution.status, "unavailable");
      assertStringIncludes(
        resolution.availability?.reason ?? "",
        "project-local",
      );
      await assertRejects(
        () => formatSource("const x=1", options),
        FormatterResolutionError,
        "unavailable",
      );
    } finally {
      await Deno.remove(directory, { recursive: true });
    }
  });
});

describe("formatSource", () => {
  it("passes the intended TypeScript path and project configuration to Prettier", async () => {
    const output = await formatSource(
      'function value(){return {message:"hello"}}',
      {
        formatter: "prettier",
        filePath: "tests/fixtures/prettier/src/generated/schema.ts",
        projectRoot: root,
      },
    );
    assertEquals(
      output,
      "function value() {\n    return { message: 'hello' }\n}\n",
    );
    await assertRejects(
      () => Deno.stat(fixture("prettier", "src", "generated", "schema.ts")),
      Deno.errors.NotFound,
    );
  });

  it("infers JSON from the intended Prettier path", async () => {
    const output = await formatSource('{"name":"projectfmt","items":[1,2]}', {
      formatter: "prettier",
      filePath: "tests/fixtures/prettier/src/generated/data.json",
      projectRoot: root,
    });
    assertEquals(
      output,
      '{ "name": "projectfmt", "items": [1, 2] }\n',
    );
  });

  it("loads project-local Prettier plugins from executable configuration", async () => {
    const output = await formatSource("hello plugin", {
      formatter: "prettier",
      filePath: "tests/fixtures/plugin/generated.upper",
      projectRoot: root,
    });
    assertEquals(output, "HELLO PLUGIN\n");
  });

  it("honors Prettier ignore files", async () => {
    const source = "const     untouched=1";
    const result = await formatSourceWithResult(source, {
      filePath: "tests/fixtures/prettier/src/generated/ignored.ts",
      projectRoot: root,
    });
    assertEquals(result.source, source);
    assertEquals(result.ignored, true);
  });

  it("applies Biome formatting and safe lint fixes by default", async () => {
    const output = await formatSource(
      "let value: number=1;console.log(value)",
      {
        formatter: "biome",
        filePath: "tests/fixtures/biome/src/generated/schema.ts",
        projectRoot: root,
      },
    );
    assertEquals(output, "let value = 1;\nconsole.log(value);\n");
  });

  it("applies configured Biome import organization by default", async () => {
    const output = await formatSource(
      'import { z } from "z";import { a } from "a";console.log(z,a)',
      {
        formatter: "biome",
        filePath: "tests/fixtures/biome/src/generated/imports.ts",
        projectRoot: root,
      },
    );
    assertEquals(
      output,
      "import { a } from 'a';\nimport { z } from 'z';\nconsole.log(z, a);\n",
    );
  });

  it("does not apply Biome rules disabled by repository configuration", async () => {
    const output = await formatSource("let value=1;console.log(value)", {
      formatter: "biome",
      filePath: "tests/fixtures/biome/src/generated/disabled-rule.ts",
      projectRoot: root,
    });
    assertEquals(output, "let value = 1;\nconsole.log(value);\n");
  });

  it("does not enable unsafe Biome lint fixes", async () => {
    const output = await formatSource(
      "interface Example{property?:string}\ndeclare const example: Example;\nconsole.log(example.property!.length)",
      {
        formatter: "biome",
        filePath: "tests/fixtures/biome/src/generated/rules.ts",
        projectRoot: root,
      },
    );
    assertStringIncludes(output, "example.property!.length");
  });

  it("supports Biome formatting-only as an opt-out", async () => {
    const output = await formatSource(
      'import { z } from "z";import { a } from "a";let value: number=1;console.log(z,a,value)',
      {
        formatter: "biome",
        filePath: "tests/fixtures/biome/src/generated/format-only.ts",
        projectRoot: root,
        formatOnly: true,
      },
    );
    assertEquals(
      output,
      "import { z } from 'z';\nimport { a } from 'a';\nlet value: number = 1;\nconsole.log(z, a, value);\n",
    );
  });

  it("honors Biome file includes for virtual intended paths", async () => {
    const source = "const     untouched=1";

    const ignored = await formatSourceWithResult(source, {
      formatter: "biome",
      filePath: "tests/fixtures/biome/src/generated/ignored.ts",
      projectRoot: root,
    });
    assertEquals(ignored.source, source);
    assertEquals(ignored.ignored, true);
  });

  it("honors operation-specific Biome includes", async () => {
    const source = "let     value: number=1;console.log(value)";
    const linted = await formatSourceWithResult(source, {
      formatter: "biome",
      filePath: "tests/fixtures/biome/src/lint-only/rule.ts",
      projectRoot: root,
    });
    assertEquals(linted.source, "let     value=1;console.log(value)");
    assertEquals(linted.ignored, false);

    const formatOnly = await formatSourceWithResult(source, {
      formatter: "biome",
      filePath: "tests/fixtures/biome/src/lint-only/rule.ts",
      projectRoot: root,
      formatOnly: true,
    });
    assertEquals(formatOnly.source, source);
    assertEquals(formatOnly.ignored, true);
  });

  it("runs Deno fmt with configuration and intended JSON file type", async () => {
    const output = await formatSource('{"nested":{"value":1}}', {
      formatter: "deno",
      filePath: "tests/fixtures/deno/src/generated/data.json",
      projectRoot: root,
    });
    assertEquals(output, '{ "nested": { "value": 1 } }\n');
  });

  it("runs Deno fmt with TypeScript style and honors excludes", async () => {
    const output = await formatSource('const value={message:"hello"};', {
      formatter: "deno",
      filePath: "tests/fixtures/deno/src/generated/schema.ts",
      projectRoot: root,
    });
    assertEquals(output, "const value = { message: 'hello' }\n");

    const source = "const     untouched=1";
    const ignored = await formatSourceWithResult(source, {
      filePath: "tests/fixtures/deno/src/generated/ignored.ts",
      projectRoot: root,
    });
    assertEquals(ignored.source, source);
    assertEquals(ignored.ignored, true);
  });

  it("supports none and no configured formatter without side effects", async () => {
    const source = "const     untouched=1";
    assertEquals(
      await formatSource(source, {
        formatter: "none",
        filePath: "generated.ts",
        projectRoot: root,
      }),
      source,
    );
    const directory = await Deno.makeTempDir();
    try {
      assertEquals(
        await formatSource(source, {
          filePath: "generated.ts",
          projectRoot: directory,
        }),
        source,
      );
    } finally {
      await Deno.remove(directory, { recursive: true });
    }
  });

  it("supports custom adapters", async () => {
    const adapter: FormatterAdapter = {
      name: "uppercase",
      priority: 100,
      discover(directory, context) {
        return Promise.resolve(
          directory === context.projectRoot
            ? [{
              formatter: "uppercase",
              kind: "custom",
              path: join(directory, "uppercase.config"),
              description: "test adapter",
              strength: 30,
            }]
            : [],
        );
      },
      probe() {
        return Promise.resolve({
          available: true,
          implementation: "in-process test adapter",
        });
      },
      format(source) {
        return Promise.resolve({ source: source.toUpperCase() });
      },
    };
    const result = await formatSourceWithResult("hello", {
      formatter: "uppercase",
      filePath: "generated.custom",
      projectRoot: root,
      adapters: [adapter],
    });
    assertEquals(result.source, "HELLO");
    assertEquals(result.resolution.formatter, "uppercase");
  });

  it("preserves formatter failures, cause, stderr, and diagnostics", async () => {
    const error = await assertRejects(
      () =>
        formatSource("const =", {
          formatter: "prettier",
          filePath: "tests/fixtures/prettier/broken.ts",
          projectRoot: root,
        }),
      FormatterExecutionError,
    );
    assertInstanceOf(error.cause, Error);
    assertEquals(error.formatter, "prettier");
    assert(error.evidence.length > 0);
    assertStringIncludes(error.message, "broken.ts");

    const biomeError = await assertRejects(
      () =>
        formatSource("const =", {
          formatter: "biome",
          filePath: "tests/fixtures/biome/broken.ts",
          projectRoot: root,
        }),
      FormatterExecutionError,
    );
    assert((biomeError.stderr?.length ?? 0) > 0);
  });

  it("handles paths containing spaces", async () => {
    const output = await formatSource('const value="space"', {
      filePath: "tests/fixtures/with spaces/nested output/value.ts",
      projectRoot: root,
    });
    assertEquals(output, "const value = 'space';\n");
  });

  it("rejects paths outside the project boundary", async () => {
    await assertRejects(
      () =>
        formatSource("x", {
          formatter: "none",
          filePath: "../outside.ts",
          projectRoot: root,
        }),
      FormatterResolutionError,
      "within projectRoot",
    );
  });

  it("contains no runtime install, download, or network code", async () => {
    for (
      const directory of [join(root, "src"), join(root, "src", "adapters")]
    ) {
      for await (const entry of Deno.readDir(directory)) {
        if (!entry.isFile || !entry.name.endsWith(".ts")) continue;
        const source = await Deno.readTextFile(join(directory, entry.name));
        assertEquals(/\bfetch\s*\(/.test(source), false);
        assertEquals(
          /\b(?:npm|pnpm|yarn|deno)\s+(?:install|add)\b/.test(source),
          false,
        );
      }
    }
  });
});
