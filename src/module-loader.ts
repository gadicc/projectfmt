import { pathToFileURL } from "node:url";

type ModuleNamespace = Record<string, unknown>;

const runtimeImport = new Function(
  "specifier",
  "return import(specifier)",
) as (specifier: string) => Promise<ModuleNamespace>;

/** Import an absolute module path without build-time dynamic-import rewriting. */
export async function importModule(path: string): Promise<ModuleNamespace> {
  return await runtimeImport(pathToFileURL(path).href);
}
