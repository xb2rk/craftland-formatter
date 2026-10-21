/**
 * @module print/doc.test - verifies the Wadler/Prettier Doc algebra printer.
 *
 * Checks flat group fitting, `line` as space vs break, `softline` breaking,
 * and `indent` + `hardline` honoring.
 */

import { describe, expect, it } from "vitest";
import { resolveConfig } from "../../../src/format/config.js";
import { concat, group, hardline, indent, line, printDoc, softline, text } from "../../../src/print/doc.js";

describe("Doc printer", () => {
  it("keeps a fitting group flat", () => {
    const document = group(concat([text("A"), softline, text("B")]));
    expect(printDoc(document, resolveConfig({ printWidth: 10 }))).toBe("AB");
  });

  it("keeps a regular line as a space when flat", () => {
    const document = group(concat([text("A"), line, text("B")]));
    expect(printDoc(document, resolveConfig({ printWidth: 10 }))).toBe("A B");
  });

  it("breaks softlines when the group does not fit", () => {
    const document = group(concat([text("A"), softline, text("B")]));
    expect(printDoc(document, resolveConfig({ printWidth: 1 }))).toBe("A\nB");
  });

  it("indents broken content and always honors hardline", () => {
    const document = concat([text("A"), indent(concat([hardline, text("B"), hardline, text("C")]))]);
    expect(printDoc(document, resolveConfig({ tabWidth: 3 }))).toBe("A\n   B\n   C");
  });
});
