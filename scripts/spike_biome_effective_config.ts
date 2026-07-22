import { createRequire } from "node:module";
import { dirname, isAbsolute, join, relative, sep } from "node:path";
import { arch, platform } from "node:process";
import { realpath } from "node:fs/promises";

interface FixtureRow {
  id: string;
  config: string;
  filePath: string;
  source: string;
}

interface Observation {
  rowId: string;
  fixture: string;
  candidate: string;
  repeat: number;
  command: string;
  args: string[];
  code: number;
  signal: null;
  stdout: string;
  stderr: string;
  parsed: unknown;
  classification: string;
}

const projectRoot = Deno.cwd();
const fixtureRoot = join(
  projectRoot,
  "tests",
  "fixtures",
  "biome-effective-probe",
);

function inside(path: string): boolean {
  const fromRoot = relative(projectRoot, path);
  return fromRoot === "" || (!isAbsolute(fromRoot) && fromRoot !== ".." &&
    !fromRoot.startsWith(`..${sep}`));
}

async function resolveBiome(): Promise<string> {
  const require = createRequire(import.meta.url);
  const shim = await realpath(require.resolve("@biomejs/biome/bin/biome"));
  const names: Record<string, Partial<Record<string, string>>> = {
    darwin: { arm64: "cli-darwin-arm64", x64: "cli-darwin-x64" },
    linux: { arm64: "cli-linux-arm64", x64: "cli-linux-x64" },
    win32: { arm64: "cli-win32-arm64", x64: "cli-win32-x64" },
  };
  const name = names[platform]?.[arch];
  if (!name) throw new Error(`Unsupported platform ${platform}/${arch}`);
  const binary = await realpath(require.resolve(
    `@biomejs/${name}/${platform === "win32" ? "biome.exe" : "biome"}`,
    { paths: [dirname(shim)] },
  ));
  if (!inside(shim) || !inside(binary)) {
    throw new Error("Biome package resolution escaped projectRoot");
  }
  return binary;
}

function candidates(row: FixtureRow): Record<string, string[]> {
  const config = join(fixtureRoot, row.config);
  const filePath = join(fixtureRoot, row.filePath);
  return {
    format: ["format", "--config-path", config, "--stdin-file-path", filePath],
    "lint-json": [
      "lint",
      "--reporter=json",
      "--config-path",
      config,
      "--stdin-file-path",
      filePath,
    ],
    "check-write": [
      "check",
      "--write",
      "--config-path",
      config,
      "--stdin-file-path",
      filePath,
    ],
    "rage-tools": ["rage", "--formatter", "--linter", "--config-path", config],
  };
}

function parsed(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function classify(code: number, stdout: string, stderr: string): string {
  if (code !== 0) return /parse/i.test(stderr) ? "failed-parse" : "failed";
  if (/ignored|no files were processed/i.test(stderr)) return "ignored";
  if (stdout.length === 0) return "empty-success";
  return "processed";
}

async function observe(
  binary: string,
  row: FixtureRow,
  candidate: string,
  args: string[],
  repeat: number,
): Promise<Observation> {
  const destination = join(fixtureRoot, row.filePath);
  try {
    await Deno.stat(destination);
    throw new Error(`Virtual destination unexpectedly exists: ${destination}`);
  } catch (error) {
    if (!(error instanceof Deno.errors.NotFound)) throw error;
  }
  const child = new Deno.Command(binary, {
    args,
    cwd: dirname(join(fixtureRoot, row.config)),
    stdin: "piped",
    stdout: "piped",
    stderr: "piped",
  }).spawn();
  const writer = child.stdin.getWriter();
  try {
    await writer.write(new TextEncoder().encode(row.source));
    await writer.close();
  } catch (error) {
    if (!(error instanceof Deno.errors.BrokenPipe)) throw error;
  } finally {
    writer.releaseLock();
  }
  const output = await child.output();
  const stdout = new TextDecoder().decode(output.stdout);
  const stderr = new TextDecoder().decode(output.stderr);
  try {
    await Deno.stat(destination);
    throw new Error(`Probe wrote virtual destination: ${destination}`);
  } catch (error) {
    if (!(error instanceof Deno.errors.NotFound)) throw error;
  }
  return {
    rowId: `${row.id}/${candidate}`,
    fixture: row.id,
    candidate,
    repeat,
    command: "biome",
    args: args.map((arg) => arg.replaceAll(projectRoot, "<projectRoot>")),
    code: output.code,
    signal: null,
    stdout,
    stderr: stderr.replaceAll(projectRoot, "<projectRoot>"),
    parsed: parsed(stdout) ?? parsed(stderr),
    classification: classify(output.code, stdout, stderr),
  };
}

export async function buildReport() {
  const binary = await resolveBiome();
  const manifest = JSON.parse(
    await Deno.readTextFile(join(fixtureRoot, "manifest.json")),
  ) as FixtureRow[];
  const versionOutput = await new Deno.Command(binary, { args: ["--version"] })
    .output();
  const biomeVersion =
    new TextDecoder().decode(versionOutput.stdout).match(/\d+\.\d+\.\d+/)
      ?.[0] ?? "unknown";
  const rows: Observation[] = [];
  for (const row of manifest) {
    for (const [candidate, args] of Object.entries(candidates(row))) {
      for (const repeat of [1, 2]) {
        rows.push(await observe(binary, row, candidate, args, repeat));
      }
    }
  }
  return { schemaVersion: 1, biomeVersion, rows };
}

if (import.meta.main) {
  if (Deno.args.length !== 1 || Deno.args[0] !== "--self-test") {
    throw new Error("Expected --self-test");
  }
  console.log(JSON.stringify(await buildReport()));
}
