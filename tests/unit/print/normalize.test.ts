/**
 * @module print/normalize.test - verifies EOL/BOM/whitespace/blank-line normalization.
 *
 * Checks BOM stripping, CRLF→LF, trailing whitespace trimming, blank-run collapsing,
 * final newline insertion, and protection of raw strings/block comments.
 */

import { describe, expect, it } from "vitest";
import { resolveConfig } from "../../../src/format/config.js";
import { normalize } from "../../../src/print/normalize.js";

describe("normalize", () => {
  it("normalizes BOM, EOL, trailing whitespace, blank runs, and final newline", () => {
    expect(normalize("\uFEFFa\r\n  \r\n\r\n b  \r\n", resolveConfig())).toBe("a\n\n b\n");
  });

  it("does not trim or collapse multiline raw strings and block comments", () => {
    const source = "`raw  \n\n  value  `\n/* block  \n\n  body  */\n";
    expect(normalize(source, resolveConfig())).toBe(source);
  });

  it("supports CRLF and omitting the final newline", () => {
    expect(normalize("a\n\n", resolveConfig({ endOfLine: "crlf", insertFinalNewline: false }))).toBe("a");
  });
});
