import { basename, join } from "node:path";

import { readJsoncIfPresent, readTextIfPresent } from "../fs.ts";
import { packageYamlHasPrettier } from "../config-names.ts";
import type { DiscoveryEvidence, FormatterName } from "../types.ts";

export type DirectoryEvidence = Omit<DiscoveryEvidence, "distance">;

export async function configFileEvidence(
  formatter: FormatterName,
  directory: string,
  names: readonly string[],
): Promise<DirectoryEvidence[]> {
  const evidence: DirectoryEvidence[] = [];
  for (const name of names) {
    const path = join(directory, name);
    if (await readTextIfPresent(path) !== null) {
      evidence.push({
        formatter,
        kind: "config",
        path,
        description: `${formatter} configuration (${basename(path)})`,
        strength: 30,
      });
    }
  }
  return evidence;
}

export async function packageEvidence(
  formatter: FormatterName,
  directory: string,
  options: {
    packageKey?: string;
    packages: readonly string[];
    commandPattern: RegExp;
  },
): Promise<DirectoryEvidence[]> {
  const path = join(directory, "package.json");
  const pkg = await readJsoncIfPresent(path);
  if (!pkg) return [];
  const evidence: DirectoryEvidence[] = [];
  if (options.packageKey && options.packageKey in pkg) {
    evidence.push({
      formatter,
      kind: "package-key",
      path,
      description: `package.json ${JSON.stringify(options.packageKey)} key`,
      strength: 30,
    });
  }

  const scripts = asRecord(pkg.scripts);
  for (const [name, command] of Object.entries(scripts)) {
    if (typeof command === "string" && options.commandPattern.test(command)) {
      evidence.push({
        formatter,
        kind: "script",
        path,
        description: `package.json script ${
          JSON.stringify(name)
        } invokes ${formatter}`,
        strength: 20,
      });
      break;
    }
  }

  for (
    const section of [
      "devDependencies",
      "dependencies",
      "peerDependencies",
      "optionalDependencies",
    ]
  ) {
    const dependencies = asRecord(pkg[section]);
    const packageName = options.packages.find((name) => name in dependencies);
    if (packageName) {
      evidence.push({
        formatter,
        kind: "dependency",
        path,
        description: `${packageName} declared in package.json ${section}`,
        strength: 10,
      });
      break;
    }
  }
  return evidence;
}

export async function prettierPackageYamlEvidence(
  directory: string,
): Promise<DirectoryEvidence[]> {
  const path = join(directory, "package.yaml");
  return await packageYamlHasPrettier(path)
    ? [{
      formatter: "prettier",
      kind: "config",
      path,
      description: "package.yaml prettier key",
      strength: 30,
    }]
    : [];
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object"
    ? value as Record<string, unknown>
    : {};
}
