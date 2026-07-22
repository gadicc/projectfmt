import { assertEquals, assertThrows } from "@std/assert";

import { parseJsonc } from "./fs.ts";

Deno.test("parseJsonc preserves comma-delimiter text inside strings", () => {
  const expected = {
    objectDelimiter: ",}",
    arrayDelimiter: ",]",
    glob: "**/*.{ts,}",
    escaped: 'quote: ",} backslash: \\\\,]',
    commentLike: "https://example.test/a//b/*c*/,]",
  };

  assertEquals(parseJsonc(JSON.stringify(expected)), expected);
});

Deno.test("parseJsonc accepts comments and true trailing commas", () => {
  assertEquals(
    parseJsonc(`{
      // Leading comment.
      "items": [1, 2, // Before the array close.
      ],
      "nested": {
        "ok": true, /* Before the object close. */
      },
    }`),
    { items: [1, 2], nested: { ok: true } },
  );
});

Deno.test("parseJsonc retains JSON syntax errors", () => {
  assertThrows(() => parseJsonc("{ unquoted: 'json5' }"), SyntaxError);
});
