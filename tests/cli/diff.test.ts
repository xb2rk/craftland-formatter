import { describe, expect, it } from "vitest";
import { createUnifiedDiff } from "../../src/cli/diff.js";

describe("createUnifiedDiff", () => {
  it("returns empty string when texts are identical", () => {
    const text = "graph Server_Test {}\n";
    expect(createUnifiedDiff("Test.fcg", text, text)).toBe("");
  });

  it("produces standard unified diff hunks on modifications", () => {
    const original = "func Foo() {\n  var x=1\n  return x\n}\n";
    const formatted = "func Foo() {\n  var x = 1\n  return x\n}\n";

    const diff = createUnifiedDiff("Test.fcg", original, formatted);
    expect(diff).toContain("--- Test.fcg");
    expect(diff).toContain("+++ Test.fcg (formatted)");
    expect(diff).toContain("-  var x=1");
    expect(diff).toContain("+  var x = 1");
    expect(diff).toContain("@@ -1,");
  });

  it("handles insertions and deletions cleanly", () => {
    const original = "import \"A.fcc\" as A\n\ngraph Test {}\n";
    const formatted = "import \"A.fcc\" as A\nimport \"B.fcc\" as B\n\ngraph Test {}\n";

    const diff = createUnifiedDiff("Test.fcg", original, formatted);
    expect(diff).toContain("+import \"B.fcc\" as B");
  });
});
