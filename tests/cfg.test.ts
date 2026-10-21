import { describe, expect, it } from "vitest";
import { lintSource } from "../src/lint/linter.js";

function diagnostics(source: string): readonly ReturnType<typeof lintSource>["diagnostics"][number][] {
  return lintSource(source, { fileName: "CfgFixture.fcg" }).diagnostics;
}

describe("P7C control-flow and data-flow analysis", () => {
  it("uses CFG reachability for constant branches", () => {
    const result = diagnostics("graph Foo { func Run() { if false { use(1) } use(2) } }");
    expect(result.filter((item) => item.ruleId === "fc/no-constant-condition").map((item) => item.message)).toEqual([
      "Condition is always false.",
    ]);
    expect(result.filter((item) => item.ruleId === "fc/no-unreachable")).toHaveLength(1);
  });

  it("models loop back-edges, break, and continue", () => {
    const reachableAfterBreak = diagnostics("graph Foo { func Run() { while true { break } use(1) } }");
    expect(reachableAfterBreak.some((item) => item.ruleId === "fc/no-unreachable" && item.message === "Unreachable statement.")).toBe(false);

    const unreachableAfterContinue = diagnostics("graph Foo { func Run() { while true { continue } use(1) } }");
    expect(unreachableAfterContinue.filter((item) => item.ruleId === "fc/no-unreachable")).toHaveLength(1);
  });

  it("prunes constant expression-for branches and nested unreachable conditions", () => {
    const infinite = diagnostics("graph Foo { func Run() { for true { continue } use(1) } }");
    expect(infinite.filter((item) => item.ruleId === "fc/no-constant-condition").map((item) => item.message)).toEqual([
      "Condition is always true.",
    ]);
    expect(infinite.filter((item) => item.ruleId === "fc/no-unreachable")).toHaveLength(1);

    const nested = diagnostics("graph Foo { func Run() { if false { if true { use(1) } } use(2) } }");
    expect(nested.filter((item) => item.ruleId === "fc/no-constant-condition")).toHaveLength(1);
    expect(nested.filter((item) => item.ruleId === "fc/no-unreachable")).toHaveLength(2);
  });

  it("keeps nested loop exits and if/else joins independent", () => {
    const nestedLoops = diagnostics("graph Foo { func Run() { while true { while true { break } use(1) break } use(2) } }");
    expect(nestedLoops.filter((item) => item.ruleId === "fc/no-constant-condition")).toHaveLength(2);
    expect(nestedLoops.some((item) => item.ruleId === "fc/no-unreachable")).toBe(false);

    const branch = diagnostics("graph Foo { func Run() { var value int\n if flag { value = 1 } else { value = 2 }\n use(value) } }");
    expect(branch.some((item) => item.ruleId === "fc/no-dead-store")).toBe(false);
  });

  it("reports a write overwritten before a read", () => {
    const result = diagnostics("graph Foo { func Run() { var value int = 0\n value = 1\n value = 2\n use(value) } }");
    expect(result.filter((item) => item.ruleId === "fc/no-dead-store").map((item) => item.message)).toEqual([
      "Assignment to 'value' is never read.",
    ]);
  });

  it("keeps dead-store conclusions conservative across calls and branches", () => {
    const call = diagnostics("graph Foo { func Run() { var value int = 0\n value = 1\n DoSomething() } }");
    expect(call.some((item) => item.ruleId === "fc/no-dead-store")).toBe(false);

    const branch = diagnostics("graph Foo { func Run() { var value int = 0\n value = 1\n if flag { use(value) } } }");
    expect(branch.some((item) => item.ruleId === "fc/no-dead-store")).toBe(false);

    for (const prefix of ["wait", "start"]) {
      const result = lintSource(`graph Foo { func Run() { var value int\n value = 1\n ${prefix} Pause() } }`, {
        fileName: "CfgFixture.fcg",
        rules: { "fc/no-unused-local": "off" },
      });
      expect(result.diagnostics.some((item) => item.ruleId === "fc/no-dead-store")).toBe(false);
    }
  });

  it("preserves parameter reads through calls and treats formal out vars as caller-visible", () => {
    const clampedParameter = diagnostics([
      "graph Foo {",
      "  func StartAlphaPulse(minAlpha float) {",
      "    if minAlpha < 0.0 { minAlpha = 0.0 } else if minAlpha > 1.0 { minAlpha = 1.0 }",
      "    start AlphaPulseLoop(minAlpha)",
      "  }",
      "}",
    ].join("\n"));
    expect(clampedParameter.some((item) => item.ruleId === "fc/no-dead-store")).toBe(false);

    const outParameter = diagnostics("graph Foo { func Split(out var shards List<List<ItemInstance>>) int { shards = List<List<ItemInstance>>{}\n return 0 } }");
    expect(outParameter.some((item) => item.ruleId === "fc/no-dead-store")).toBe(false);
  });

  it("does not treat graph fields as function-local dead stores", () => {
    const result = diagnostics("graph Foo { State int\n func Run() { State = 1 } }");
    expect(result.some((item) => item.ruleId === "fc/no-dead-store")).toBe(false);
  });

  it("supports P7C suppression, severity, UTF-16 ranges, and repeat-run determinism", () => {
    const source = "graph Foo { func Run() { var value int\n // fc-lint-disable-next-line fc/no-dead-store\n value = 1\n value = 2\n use(value) } }";
    const suppressed = lintSource(source, { fileName: "CfgFixture.fcg", rules: { "fc/no-unused-local": "off" } });
    expect(suppressed.diagnostics.some((item) => item.ruleId === "fc/no-dead-store")).toBe(false);

    const emojiSource = "graph Foo { func Run() { // 😀\n var value int\n value = 1\n } }";
    const errored = lintSource(emojiSource, {
      fileName: "CfgFixture.fcg",
      rules: { "fc/no-unused-local": "off", "fc/no-dead-store": "error" },
    });
    const deadStore = errored.diagnostics.find((item) => item.ruleId === "fc/no-dead-store");
    expect(deadStore?.severity).toBe("error");
    expect(deadStore?.range.start.offset).toBe(emojiSource.lastIndexOf("value"));

    const repeatSource = "graph Foo { func Run() { var value int\n value = 1\n value = 2\n } }";
    const first = lintSource(repeatSource, {
      fileName: "CfgFixture.fcg",
      rules: { "fc/no-unused-local": "off" },
    });
    const second = lintSource(repeatSource, {
      fileName: "CfgFixture.fcg",
      rules: { "fc/no-unused-local": "off" },
    });
    expect(second.diagnostics).toEqual(first.diagnostics);
  });
});
