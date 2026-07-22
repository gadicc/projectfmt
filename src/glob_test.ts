import { assertEquals } from "@std/assert";

import { isExcluded, isIncluded, matchesGlob } from "./glob.ts";

Deno.test("matchesGlob supports Deno-style wildcards and directories", () => {
  assertEquals(matchesGlob("src/**/*.ts", "src/a/value.ts"), true);
  assertEquals(matchesGlob("src/**/*.tsx", "src/a/value.tsx"), true);
  assertEquals(matchesGlob("src/**/*.ts", "src/a/value.js"), false);
  assertEquals(matchesGlob("src/generated/", "src/generated/a.ts"), true);
  assertEquals(matchesGlob("src/generated/", "src/other/a.ts"), false);
});

Deno.test("ordered patterns support exclusions and negated exceptions", () => {
  assertEquals(
    isIncluded(["src/**", "!src/generated/**"], "src/generated/a.ts"),
    false,
  );
  assertEquals(
    isIncluded(
      ["src/**", "!src/generated/**", "src/generated/keep.ts"],
      "src/generated/keep.ts",
    ),
    true,
  );
  assertEquals(
    isExcluded(["src/**", "!src/keep.ts"], "src/keep.ts"),
    false,
  );
  assertEquals(
    isExcluded(["src/**", "!src/keep.ts"], "src/other.ts"),
    true,
  );
  assertEquals(isExcluded(["other/**"], "src/value.ts"), false);
});
