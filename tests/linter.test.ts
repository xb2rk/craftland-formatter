import { describe, expect, it } from "vitest";
import { lintSource } from "../src/lint/linter.js";

function ruleIds(source: string, options: Parameters<typeof lintSource>[1] = {}): string[] {
  return lintSource(source, { fileName: "Fixture.fcg", ...options }).diagnostics.map((diagnostic) => diagnostic.ruleId);
}

describe("FC P7B linter", () => {
  it("reports unused locals, exact self-assignment, and straight-line unreachable code", () => {
    const source = "graph Foo { func Run() { var unused int = 1\n unused = unused\n return true\n var dead int = 2\n } }";
    expect(ruleIds(source)).toEqual([
      "fc/no-self-assignment",
      "fc/no-unreachable",
      "fc/no-unused-local",
    ]);
  });

  it("binds loop variables in the loop scope", () => {
    const source = "graph Foo { func Run() { for i = 0, 2, 1 { break }\n for key, value in values { use(value) } } }";
    const diagnostics = lintSource(source, { fileName: "Fixture.fcg" }).diagnostics;
    expect(diagnostics.filter((diagnostic) => diagnostic.ruleId === "fc/no-unused-local").map((diagnostic) => diagnostic.message)).toEqual([
      "Local 'i' is never read.",
      "Local 'key' is never read.",
    ]);
  });

  it("reports duplicate import aliases and local declarations", () => {
    const imports = "import One as Shared from \"one\"\nimport Two as Shared from \"two\"\ndefine Value:int\n";
    expect(ruleIds(imports.replaceAll("\n", "\n"), { fileName: "Fixture.fcc" })).toContain("fc/no-duplicate-import-alias");
    const locals = "graph Foo { func Run() { var value int = 1\n var value int = 2\n } }";
    expect(ruleIds(locals)).toContain("fc/no-duplicate-declaration");
  });

  it("reports empty control-flow blocks and honors next-line suppression", () => {
    const empty = "graph Foo { func Run() { if true {} } }";
    expect(ruleIds(empty)).toContain("fc/no-empty-block");
    const suppressed = "graph Foo { func Run() { // fc-lint-disable-next-line fc/no-unused-local\n var ignored int = 1\n } }";
    expect(ruleIds(suppressed)).not.toContain("fc/no-unused-local");
  });

  it("does not report underscore or ignored out-var bindings", () => {
    const source = "graph Foo { func Run() { Do(out var status)\n var _ignored int = 1\n } }";
    expect(ruleIds(source)).not.toContain("fc/no-unused-local");
  });

  it("returns only blocking parse diagnostics for malformed input", () => {
    const result = lintSource("graph Foo {", { fileName: "Fixture.fcg" });
    expect(result.parsed).toBe(false);
    expect(result.diagnostics.every((diagnostic) => diagnostic.ruleId === "fc/parse")).toBe(true);
  });

  it("allows explicit severity overrides and preserves UTF-16 ranges", () => {
    const source = "graph Foo { func Run() { var café int = 1 } }";
    const result = lintSource(source, {
      fileName: "Fixture.fcg",
      rules: { "fc/no-unused-local": "error" },
    });
    const diagnostic = result.diagnostics.find((item) => item.ruleId === "fc/no-unused-local");
    expect(diagnostic?.severity).toBe("error");
    expect(diagnostic?.range.start.offset).toBe(source.indexOf("café"));
    expect(diagnostic?.range.end.offset).toBe(source.indexOf("café") + "café".length);
  });

  it("rejects unknown rule configuration and supports block-comment suppression", () => {
    const source = "graph Foo { func Run() { /* fc-lint-disable-next-line fc/no-unused-local */\n var ignored int = 1 } }";
    expect(ruleIds(source)).not.toContain("fc/no-unused-local");
    const result = lintSource("graph Foo {}", {
      fileName: "Fixture.fcg",
      rules: { "fc/not-a-rule": "warning" } as never,
    });
    expect(result.diagnostics.some((diagnostic) => diagnostic.ruleId === "fc/config")).toBe(true);
    const unknownSuppression = lintSource("graph Foo { // fc-lint-disable-next-line fc/not-a-rule\n }", { fileName: "Fixture.fcg" });
    expect(unknownSuppression.diagnostics.some((diagnostic) => diagnostic.ruleId === "fc/config")).toBe(true);
  });
});
