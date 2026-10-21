import { describe, expect, it } from "vitest";
import { formatSource } from "../../src/format/formatter.js";

describe("fc-format customization options", () => {
  it("supports bracketSpacing: true for single-line composites", () => {
    const input = "graph Demo { func Run() { var v = Vector3{0, 0, 0} } }";
    const tight = formatSource(input, { fileName: "Demo.fcg", bracketSpacing: false });
    expect(tight.code).toContain("Vector3{0, 0, 0}");

    const spaced = formatSource(input, { fileName: "Demo.fcg", bracketSpacing: true });
    expect(spaced.code).toContain("Vector3{ 0, 0, 0 }");
  });

  it("supports alignCompositeSeparators: false to disable column alignment", () => {
    const input = [
      "graph Demo {",
      "  func Run() {",
      '    var m = Map<string, int>{"short": 1, "veryLongKeyName": 2}',
      "  }",
      "}",
    ].join("\n");

    const aligned = formatSource(input, { fileName: "Demo.fcg", wrapCollections: "always", alignCompositeSeparators: true });
    expect(aligned.code).toContain('"short"          : 1,');

    const unaligned = formatSource(input, { fileName: "Demo.fcg", wrapCollections: "always", alignCompositeSeparators: false });
    expect(unaligned.code).toContain('"short": 1,');
    expect(unaligned.code).toContain('"veryLongKeyName": 2,');
  });

  it("supports sortImports: false to preserve author's import order", () => {
    const input = [
      'import "Z.fcg" as Z',
      'import "A.fcg" as A',
      "",
      "graph Demo {}",
    ].join("\n");

    const sorted = formatSource(input, { fileName: "Demo.fcg", sortImports: true });
    expect(sorted.code).toBe('import "A.fcg" as A\nimport "Z.fcg" as Z\n\ngraph Demo {\n}\n');

    const preserved = formatSource(input, { fileName: "Demo.fcg", sortImports: false });
    expect(preserved.code).toBe('import "Z.fcg" as Z\nimport "A.fcg" as A\n\ngraph Demo {\n}\n');
  });

  it("supports endOfLine: 'crlf' and 'lf'", () => {
    const input = "graph Demo {\n  func Run() {\n  }\n}";

    const lf = formatSource(input, { fileName: "Demo.fcg", endOfLine: "lf" });
    expect(lf.code).not.toContain("\r\n");
    expect(lf.code).toContain("\n");

    const crlf = formatSource(input, { fileName: "Demo.fcg", endOfLine: "crlf" });
    expect(crlf.code).toContain("\r\n");
  });
});
