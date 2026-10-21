import { describe, expect, it } from "vitest";
import { formatDiagnostic, formatDiagnosticList } from "../../src/cli/diagnostics.js";
import type { ParseDiagnostic } from "../../src/parser/diagnostic.js";

function diagnostic(line: number, column: number, message = "Expected an FC expression."): ParseDiagnostic {
  return {
    code: "expected-expression",
    message,
    range: { start: { offset: 0, line, column }, end: { offset: 0, line, column } },
  };
}

describe("cli diagnostics", () => {
  it("renders one-based file:line:column with code and message", () => {
    expect(formatDiagnostic("World.fcg", diagnostic(0, 0))).toBe(
      "World.fcg:1:1 expected-expression Expected an FC expression.",
    );
    expect(formatDiagnostic("World.fcg", diagnostic(11, 4))).toContain("World.fcg:12:5");
  });

  it("joins diagnostics and caps long lists", () => {
    const diagnostics = Array.from({ length: 12 }, (_, index) => diagnostic(index, 0, `problem ${index}`));
    const rendered = formatDiagnosticList("World.fcg", diagnostics);
    expect(rendered).toContain("World.fcg:1:1 expected-expression problem 0");
    expect(rendered).toContain("World.fcg:10:1 expected-expression problem 9");
    expect(rendered).not.toContain("problem 10");
    expect(rendered).toContain("...and 2 more");
  });
});
