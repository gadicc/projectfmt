import { spawn } from "node:child_process";
import { readFile, realpath, stat } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { arch, platform } from "node:process";
import { fileURLToPath } from "node:url";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const fixtureRoot = join(
  projectRoot,
  "tests",
  "fixtures",
  "biome-effective-probe",
);

function inside(path) {
  const fromRoot = relative(projectRoot, path);
  return fromRoot === "" || (!isAbsolute(fromRoot) && fromRoot !== ".." &&
    !fromRoot.startsWith(`..${sep}`));
}

async function resolveBiome() {
  const require = createRequire(import.meta.url);
  const shim = await realpath(require.resolve("@biomejs/biome/bin/biome"));
  const names = {
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

function candidates(row) {
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

function parse(text) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function classify(code, stdout, stderr) {
  if (code !== 0) return /parse/i.test(stderr) ? "failed-parse" : "failed";
  if (/ignored|no files were processed/i.test(stderr)) return "ignored";
  if (stdout.length === 0) return "empty-success";
  return "processed";
}

function run(binary, args, cwd, input = "") {
  return new Promise((resolve, reject) => {
    const child = spawn(binary, args, {
      cwd,
      shell: false,
      windowsHide: true,
      stdio: ["pipe", "pipe", "pipe"],
    });
    const stdout = [];
    const stderr = [];
    let settled = false;
    const rejectOnce = (error) => {
      if (!settled) {
        settled = true;
        reject(error);
      }
    };
    child.once("error", rejectOnce);
    child.stdin.on("error", (error) => {
      if (error.code !== "EPIPE" && error.code !== "ERR_STREAM_DESTROYED") {
        rejectOnce(error);
      }
    });
    child.stdout.on("data", (chunk) => stdout.push(chunk));
    child.stderr.on("data", (chunk) => stderr.push(chunk));
    child.once("close", (code, signal) => {
      if (settled) return;
      settled = true;
      resolve({
        code: code ?? 1,
        signal,
        stdout: Buffer.concat(stdout).toString(),
        stderr: Buffer.concat(stderr).toString(),
      });
    });
    child.stdin.end(input);
  });
}

async function absent(path) {
  try {
    await stat(path);
    return false;
  } catch (error) {
    if (error.code === "ENOENT") return true;
    throw error;
  }
}

async function observe(binary, row, candidate, args, repeat) {
  const destination = join(fixtureRoot, row.filePath);
  if (!await absent(destination)) {
    throw new Error(`Virtual destination exists: ${destination}`);
  }
  const output = await run(
    binary,
    args,
    dirname(join(fixtureRoot, row.config)),
    row.source,
  );
  if (!await absent(destination)) {
    throw new Error(`Probe wrote destination: ${destination}`);
  }
  return {
    rowId: `${row.id}/${candidate}`,
    fixture: row.id,
    candidate,
    repeat,
    command: "biome",
    args: args.map((arg) => arg.replaceAll(projectRoot, "<projectRoot>")),
    code: output.code,
    signal: output.signal,
    stdout: output.stdout,
    stderr: output.stderr.replaceAll(projectRoot, "<projectRoot>"),
    parsed: parse(output.stdout) ?? parse(output.stderr),
    classification: classify(output.code, output.stdout, output.stderr),
  };
}

export async function buildReport() {
  const binary = await resolveBiome();
  const manifest = JSON.parse(
    await readFile(join(fixtureRoot, "manifest.json"), "utf8"),
  );
  const versionOutput = await run(binary, ["--version"], projectRoot);
  const biomeVersion = versionOutput.stdout.match(/\d+\.\d+\.\d+/)?.[0] ??
    "unknown";
  const rows = [];
  for (const row of manifest) {
    for (const [candidate, args] of Object.entries(candidates(row))) {
      for (const repeat of [1, 2]) {
        rows.push(await observe(binary, row, candidate, args, repeat));
      }
    }
  }
  return { schemaVersion: 1, biomeVersion, rows };
}

if (process.argv.length !== 3 || process.argv[2] !== "--self-test") {
  throw new Error("Expected --self-test");
}
console.log(JSON.stringify(await buildReport()));
