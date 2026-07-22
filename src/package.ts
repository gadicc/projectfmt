import { realpathSync } from "node:fs";
import { createRequire } from "node:module";
import { isAbsolute, join, relative, sep } from "node:path";
import { pathToFileURL } from "node:url";

export function resolveProjectPackage(
  specifier: string,
  fromDirectory: string,
  projectRoot: string,
): string | null {
  try {
    const require = createRequire(
      pathToFileURL(join(fromDirectory, "__projectfmt_resolve__.cjs")),
    );
    const resolved = require.resolve(specifier);
    const physicalRoot = realpathSync(projectRoot);
    const physicalResolved = realpathSync(resolved);
    const fromRoot = relative(physicalRoot, physicalResolved);
    if (
      fromRoot === ".." || fromRoot.startsWith(`..${sep}`) ||
      isAbsolute(fromRoot)
    ) return null;
    return resolved;
  } catch {
    return null;
  }
}
