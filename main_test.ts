import {
  assert,
  assertEquals,
  assertInstanceOf,
  assertRejects,
  assertStringIncludes,
} from "@std/assert";
import { describe, it } from "@std/testing/bdd";
import { cp, mkdir, realpath } from "node:fs/promises";
import { isAbsolute, join, parse, relative, sep } from "node:path";
import { arch, platform } from "node:process";

import {
  clearProjectRootCache,
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

async function copyPackageIntoProject(
  packageName: string,
  projectRoot: string,
): Promise<string> {
  const source = await realpath(
    join(root, "node_modules", ...packageName.split("/")),
  );
  return await copyPackageDirectory(source, packageName, projectRoot);
}

async function copyPackageDirectory(
  source: string,
  packageName: string,
  projectRoot: string,
): Promise<string> {
  const destination = join(
    projectRoot,
    "node_modules",
    ...packageName.split("/"),
  );
  await mkdir(join(destination, ".."), { recursive: true });
  await cp(source, destination, { recursive: true, dereference: true });
  return destination;
}

function biomeCliPackage(): { name: string; executable: string } {
  const names: Record<string, Partial<Record<string, string>>> = {
    darwin: { arm64: "cli-darwin-arm64", x64: "cli-darwin-x64" },
    linux: { arm64: "cli-linux-arm64", x64: "cli-linux-x64" },
    win32: { arm64: "cli-win32-arm64", x64: "cli-win32-x64" },
  };
  const name = names[platform]?.[arch];
  if (!name) {
    throw new Error(`No locked Biome CLI package for ${platform}/${arch}`);
  }
  return {
    name: `@biomejs/${name}`,
    executable: platform === "win32" ? "biome.exe" : "biome",
  };
}

describe("resolveFormatter", () => {
  it("infers a project boundary for an absolute intended path", async () => {
    const resolution = await resolveFormatter(
      fixture("prettier", "src", "generated", "schema.ts"),
    );
    assertEquals(resolution.projectRoot, root);
    assertEquals(resolution.formatter, "prettier");
  });

  it("requires projectRoot for a relative intended path", async () => {
    await assertRejects(
      () => resolveFormatter({ filePath: "src/generated.ts" }),
      FormatterResolutionError,
      "required when filePath is relative",
    );
    await assertRejects(
      () => resolveFormatter("src/generated.ts"),
      FormatterResolutionError,
      "required when filePath is relative",
    );
  });

  it("retains an explicit boundary for an absolute intended path", async () => {
    const projectRoot = fixture("prettier");
    const resolution = await resolveFormatter({
      formatter: "none",
      filePath: join(projectRoot, "src", "generated.ts"),
      projectRoot,
    });
    assertEquals(resolution.projectRoot, projectRoot);
  });

  it("rejects an intended path equal to projectRoot", async () => {
    const parent = await Deno.makeTempDir({ prefix: "projectfmt boundary " });
    const projectRoot = join(parent, "project");
    try {
      await Deno.mkdir(projectRoot);
      await Deno.writeTextFile(join(parent, ".prettierrc"), "{}");
      const error = await assertRejects(
        () => resolveFormatter({ filePath: projectRoot, projectRoot }),
        FormatterResolutionError,
        "file below projectRoot",
      );
      assertEquals(error.code, "INVALID_OPTIONS");
      assertEquals(error.filePath, projectRoot);
      assertEquals(error.projectRoot, projectRoot);
    } finally {
      await Deno.remove(parent, { recursive: true });
    }
  });

  it("prefers a workspace boundary over a nested package marker", async () => {
    const directory = await Deno.makeTempDir({
      prefix: "projectfmt workspace ",
    });
    const packageDirectory = join(directory, "packages", "api");
    try {
      await Deno.mkdir(packageDirectory, { recursive: true });
      await Deno.writeTextFile(
        join(directory, "package.json"),
        JSON.stringify({ workspaces: ["packages/*"] }),
      );
      await Deno.writeTextFile(join(packageDirectory, "package.json"), "{}");
      const resolution = await resolveFormatter({
        formatter: "none",
        filePath: join(packageDirectory, "src", "generated.ts"),
      });
      assertEquals(resolution.projectRoot, directory);
    } finally {
      clearProjectRootCache();
      await Deno.remove(directory, { recursive: true });
    }
  });

  it("prefers a surrounding VCS boundary over a nested project marker", async () => {
    const directory = await Deno.makeTempDir({ prefix: "projectfmt root " });
    const nested = join(directory, "nested");
    try {
      await Deno.mkdir(nested);
      await Deno.writeTextFile(join(directory, ".git"), "gitdir: elsewhere");
      await Deno.writeTextFile(join(nested, "package.json"), "{}");
      const resolution = await resolveFormatter({
        formatter: "none",
        filePath: join(nested, "src", "generated.ts"),
      });
      assertEquals(resolution.projectRoot, directory);
    } finally {
      clearProjectRootCache();
      await Deno.remove(directory, { recursive: true });
    }
  });

  it("rejects automatic inference without a defensible project marker", async () => {
    const filePath = join(
      parse(root).root,
      `projectfmt-unrooted-${crypto.randomUUID()}`,
      "src",
      "generated.ts",
    );
    await assertRejects(
      () => resolveFormatter({ formatter: "none", filePath }),
      FormatterResolutionError,
      "Could not infer projectRoot",
    );
    clearProjectRootCache();
  });

  it("can clear cached roots after the project structure changes", async () => {
    const directory = await Deno.makeTempDir({ prefix: "projectfmt cached " });
    const nested = join(directory, "projects", "nested");
    const gitMarker = join(nested, ".git");
    const filePath = join(nested, "src", "generated.ts");
    try {
      await Deno.mkdir(nested, { recursive: true });
      await Deno.writeTextFile(
        join(directory, "package.json"),
        JSON.stringify({ workspaces: ["projects/*"] }),
      );
      await Deno.writeTextFile(gitMarker, "gitdir: elsewhere");
      assertEquals(
        (await resolveFormatter({ formatter: "none", filePath })).projectRoot,
        nested,
      );
      await Deno.remove(gitMarker);
      assertEquals(
        (await resolveFormatter({ formatter: "none", filePath })).projectRoot,
        nested,
      );
      clearProjectRootCache();
      assertEquals(
        (await resolveFormatter({ formatter: "none", filePath })).projectRoot,
        directory,
      );
    } finally {
      clearProjectRootCache();
      await Deno.remove(directory, { recursive: true });
    }
  });

  it("detects Deno formatter configuration as project evidence", async () => {
    const resolution = await resolveFormatter({
      filePath: "src/generated/root.ts",
      projectRoot: root,
    });
    assertEquals(resolution.formatter, "deno");
    assert(
      resolution.evidence.some((item) =>
        item.formatter === "deno" && item.kind === "config"
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
  it("does not load Prettier configuration above projectRoot", async () => {
    const parent = await Deno.makeTempDir({
      prefix: "projectfmt prettier boundary ",
    });
    const projectRoot = join(parent, "project");
    try {
      await Deno.mkdir(projectRoot);
      await Deno.writeTextFile(
        join(parent, ".prettierrc"),
        JSON.stringify({ singleQuote: true, tabWidth: 7 }),
      );
      await copyPackageIntoProject("prettier", projectRoot);
      assertEquals(
        await formatSource('function value(){return "parent"}', {
          formatter: "prettier",
          filePath: "src/generated.ts",
          projectRoot,
        }),
        'function value() {\n  return "parent";\n}\n',
      );
    } finally {
      await Deno.remove(parent, { recursive: true });
      await assertRejects(() => Deno.stat(parent), Deno.errors.NotFound);
    }
  });

  it("does not load Biome configuration above projectRoot", async () => {
    const parent = await Deno.makeTempDir({
      prefix: "projectfmt biome boundary ",
    });
    const projectRoot = join(parent, "project");
    try {
      await Deno.mkdir(projectRoot);
      await Deno.writeTextFile(
        join(parent, "biome.json"),
        JSON.stringify({
          formatter: { indentStyle: "space" },
          javascript: { formatter: { quoteStyle: "single" } },
        }),
      );
      await copyPackageIntoProject("@biomejs/biome", projectRoot);
      const cli = biomeCliPackage();
      const biomeRoot = await realpath(
        join(root, "node_modules", "@biomejs", "biome"),
      );
      const cliSource = await realpath(
        join(biomeRoot, "..", cli.name.split("/")[1]),
      );
      const cliRoot = await copyPackageDirectory(
        cliSource,
        cli.name,
        projectRoot,
      );
      const cliPath = await realpath(join(cliRoot, cli.executable));
      const fromRoot = relative(projectRoot, cliPath);
      assert(
        !isAbsolute(fromRoot) && fromRoot !== ".." &&
          !fromRoot.startsWith(`..${sep}`),
      );
      assertEquals(
        await formatSource('const value="parent"', {
          formatter: "biome",
          filePath: "src/generated.ts",
          projectRoot,
          formatOnly: true,
        }),
        'const value = "parent";\n',
      );
    } finally {
      await Deno.remove(parent, { recursive: true });
      await assertRejects(() => Deno.stat(parent), Deno.errors.NotFound);
    }
  });

  it("does not load Deno configuration or EditorConfig above projectRoot", async () => {
    const parent = await Deno.makeTempDir({
      prefix: "projectfmt deno boundary ",
    });
    const projectRoot = join(parent, "project");
    try {
      await Deno.mkdir(projectRoot);
      await Deno.writeTextFile(
        join(parent, "deno.json"),
        JSON.stringify({ fmt: { singleQuote: true, indentWidth: 7 } }),
      );
      await Deno.writeTextFile(
        join(parent, ".editorconfig"),
        "root = true\n[*]\nindent_style = space\nindent_size = 5\n",
      );
      assertEquals(
        await formatSource('function value(){return "parent"}', {
          formatter: "deno",
          filePath: "src/generated.ts",
          projectRoot,
        }),
        'function value() {\n  return "parent";\n}\n',
      );
    } finally {
      await Deno.remove(parent, { recursive: true });
      await assertRejects(() => Deno.stat(parent), Deno.errors.NotFound);
    }
  });

  it("accepts an absolute intended path as shorthand", async () => {
    const filePath = fixture("prettier", "src", "generated", "shorthand.ts");
    const source = "const answer={value:42}";
    const expected = "const answer = { value: 42 }\n";
    assertEquals(await formatSource(source, filePath), expected);

    const result = await formatSourceWithResult(source, filePath);
    assertEquals(result.source, expected);
    assertEquals(result.changed, true);
    assertEquals(result.resolution.filePath, filePath);
  });

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
    assertEquals(biomeError.code, "FORMATTER_FAILED");
    assertInstanceOf(biomeError.cause, Error);
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
