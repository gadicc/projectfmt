import type { FormatterAdapter } from "../types.ts";
import { biomeAdapter } from "./biome.ts";
import { denoAdapter } from "./deno.ts";
import { prettierAdapter } from "./prettier.ts";

export { biomeAdapter, denoAdapter, prettierAdapter };

/** Built-in adapters in stable precedence order. */
export const builtinAdapters: readonly FormatterAdapter[] = Object.freeze([
  biomeAdapter,
  denoAdapter,
  prettierAdapter,
]);
