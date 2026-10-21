import { describe, expect, it } from "vitest";
import { DEFAULT_FORMAT_OPTIONS } from "../../src/format/options.js";
import { formatSource } from "../../src/format/formatter.js";

describe("formatter hardening", () => {
  it("shares the 120-column default", () => {
    expect(DEFAULT_FORMAT_OPTIONS.printWidth).toBe(120);
  });

  it("repairs parser-proven unary and shift spacing plus flat call trailing commas", () => {
    const source = "graph Repairs {func Demo(flag bool,digit int,shift int){if ! flag {var shifted int=digit < < shift\nFooBar( a,b,c, )}}}";
    const expected = [
      "graph Repairs {",
      "  func Demo(flag bool, digit int, shift int) {",
      "    if !flag {",
      "      var shifted int = digit << shift",
      "      FooBar(a, b, c)",
      "    }",
      "  }",
      "}",
      "",
    ].join("\n");
    const first = formatSource(source, { fileName: "Repairs.fcg" });
    expect(first.diagnostics).toEqual([]);
    expect(first.code).toBe(expected);
    expect(formatSource(first.code!, { fileName: "Repairs.fcg" }).code).toBe(first.code);
  });

  it("converges deterministic whitespace perturbations that include comments and nested expressions", () => {
    const variants = [
      "graph Stable{func Demo(flag bool,digit int,shift int){if ! flag&&digit < < shift{\n// keep\nFooBar(List<int>{1,2},flag,)}}}",
      "graph Stable { func Demo(flag bool, digit int, shift int) { if !flag && digit< <shift {\n// keep\nFooBar( List < int > { 1 , 2 }, flag, ) } } }",
      "graph Stable{\nfunc Demo(flag bool,digit int,shift int){\nif ! flag && digit < < shift {\n// keep\nFooBar(List<int>{1,2},flag,)\n}\n}\n}\n",
    ];
    const formatted = variants.map((source) => formatSource(source, { fileName: "Stable.fcg" }));
    for (const result of formatted) {
      expect(result.diagnostics).toEqual([]);
      expect(result.code).toContain("// keep");
      expect(formatSource(result.code!, { fileName: "Stable.fcg" }).code).toBe(result.code);
    }
    expect(formatted.map((result) => result.code)).toEqual([formatted[0]?.code, formatted[0]?.code, formatted[0]?.code]);
  });

  it("aligns parsed map and struct separators only after a composite breaks", () => {
    const source = "graph Align {func Demo(){var map Map<string,int> = Map<string,int>{\"id\":1,\"displayName\":2}\nvar value SpawnInfo=SpawnInfo{short=1,longerName=2}}}";
    const multiline = formatSource(source, { fileName: "Align.fcg", wrapCollections: "always" });
    expect(multiline.diagnostics).toEqual([]);
    expect(multiline.code).toContain("\"id\"         : 1,");
    expect(multiline.code).toContain("\"displayName\": 2,");
    expect(multiline.code).toContain("short      = 1,");
    expect(multiline.code).toContain("longerName = 2,");
    expect(formatSource(multiline.code!, { fileName: "Align.fcg", wrapCollections: "always" }).code).toBe(multiline.code);

    const flat = formatSource(source, { fileName: "Align.fcg", wrapCollections: "never" });
    expect(flat.diagnostics).toEqual([]);
    expect(flat.code).toContain("\"id\": 1, \"displayName\": 2");
    expect(flat.code).toContain("short = 1, longerName = 2");
    expect(flat.code).not.toContain("\"id\"         :");

    const tightOperators = formatSource(source, { fileName: "Align.fcg", wrapCollections: "always", spaceAroundOperators: false });
    expect(tightOperators.diagnostics).toEqual([]);
    expect(tightOperators.code).toContain("short     =1,");
    expect(tightOperators.code).toContain("longerName=2,");
  });
});
