import { describe, expect, it } from "vitest";
import { concat, group, hardline, indent, line, text } from "../src/doc/document.js";
import { printDocument } from "../src/doc/printer.js";

describe("layout document printer", () => {
  it("flattens a group when it fits", () => {
    const document = group(concat(text("a"), line(), text("b")));
    expect(printDocument(document, { printWidth: 3 })).toBe("a b");
  });

  it("breaks groups and applies indentation when they do not fit", () => {
    const document = group(concat(text("a"), line(), indent(1, text("long-value"))));
    expect(printDocument(document, { printWidth: 5, indentWidth: 2 })).toBe("a\n  long-value");
  });

  it("keeps hard lines hard in flat groups", () => {
    expect(printDocument(group(concat(text("a"), hardline(), text("b"))))).toBe("a\nb");
  });
});
