import { describe, expect, it } from "vitest";
import { formatSource } from "../../src/format/formatter.js";

describe("fc-format pragmas", () => {
  it("preserves exact code following // fc-format-ignore", () => {
    const input = [
      "graph Demo {",
      "  func Run() {",
      "    // fc-format-ignore",
      "    var   unformatted   =    1   +   2",
      "    var formatted = 1 + 2",
      "  }",
      "}",
    ].join("\n");

    const result = formatSource(input, { fileName: "Demo.fcg" });
    expect(result.diagnostics).toEqual([]);
    expect(result.code).toContain("// fc-format-ignore\n    var   unformatted   =    1   +   2");
    expect(result.code).toContain("var formatted = 1 + 2");
  });

  it("preserves exact block between /* fc-format-ignore-start */ and /* fc-format-ignore-end */", () => {
    const input = [
      "graph Demo {",
      "  /* fc-format-ignore-start */",
      "  func   Messy1 (   )   {   }",
      "  func   Messy2 ( a int , b string )   {   }",
      "  /* fc-format-ignore-end */",
      "  func Clean(a int, b string) {",
      "  }",
      "}",
    ].join("\n");

    const result = formatSource(input, { fileName: "Demo.fcg" });
    expect(result.diagnostics).toEqual([]);
    expect(result.code).toContain("/* fc-format-ignore-start */\n  func   Messy1 (   )   {   }\n  func   Messy2 ( a int , b string )   {   }\n  /* fc-format-ignore-end */");
    expect(result.code).toContain("func Clean(a int, b string) {");
  });
});
