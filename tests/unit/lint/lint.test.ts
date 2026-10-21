/**
 * @module lint/lint.test - verifies the FC linter rules and fixes.
 *
 * Covers import forms (library alias, dotted alias, alias mismatch, order),
 * `condition-no-parens` range/fix, event prefix lifecycle allowlist, graph
 * decorators, shape `no-constructor-call`/`no-wait-dot`/`ts-param-syntax`,
 * `line-too-long` with `printWidth`, `bracketSpacing` block exception,
 * and `spaceInsideBrackets/Parens/Braces` precise ranges, empty/multiline skips,
 * and fix idempotency.
 */

import { describe, expect, it } from "vitest";
import { lintDocument, lintSource, type LintOptions } from "../../../src/lint/index.js";
import { itemize } from "../../../src/lex/items.js";
import { tokenize } from "../../../src/lex/tokenizer.js";

/**
 * Rule ids for a source (test helper).
 *
 * @param source - FC source.
 * @param options - lint options.
 * @returns rule ids.
 */
function rules(source: string, options?: LintOptions): string[] {
  return lintSource(source, options).map((diagnostic) => diagnostic.ruleId);
}

describe("FC linter", () => {
  it("accepts the corpus library/script import forms", () => {
    const source = ['import "StdLibrary.fcc" as StdLibrary', 'import Res from "EditorGenLib.fcc"'].join("\n");
    expect(rules(source)).toEqual([]);
  });

  it("reports a missing library alias and offers a precise range", () => {
    const diagnostic = lintSource('import "StdLibrary.fcc"\n')[0];
    if (!diagnostic) {
      throw new Error("expected an import diagnostic");
    }
    expect(diagnostic).toMatchObject({ ruleId: "import-library-alias", line: 1, column: 1, severity: "error" });
    expect(diagnostic.fix).toBeUndefined();
  });

  it("reports import alias/order conventions without moving comments", () => {
    const source = ['import Foo as Bar from "../../../src/lint/Foo.fcg"', 'import "StdLibrary.fcc" as StdLibrary'].join("\n");
    expect(rules(source)).toEqual(["import-order", "import-alias-mismatch"]);
  });

  it("reports the complete range of a dotted alias", () => {
    const source = 'import Foo as Bad.Alias from "../../../src/lint/Foo.fcg"\n';
    const diagnostic = lintSource(source).find((entry) => entry.ruleId === "import-alias-dotted");
    if (!diagnostic) {
      throw new Error("expected a dotted-alias diagnostic");
    }
    expect(diagnostic).toMatchObject({ line: 1, column: 15, length: 9, severity: "error" });
  });

  it("only flags the parentheses immediately following a control keyword", () => {
    const source = [
      "[platform_server]",
      "graph G {",
      "  if (ready || List.Length(items) == 0) {",
      "  }",
      "}",
    ].join("\n");
    const diagnostics = lintSource(source);
    expect(diagnostics.filter((diagnostic) => diagnostic.ruleId === "condition-no-parens")).toHaveLength(1);
    const condition = diagnostics.find((diagnostic) => diagnostic.ruleId === "condition-no-parens")!;
    expect(condition.fix).toMatchObject({ replacement: "ready || List.Length(items) == 0" });
  });

  it("allows lifecycle events and checks contract event prefixes", () => {
    const source = [
      "[platform_server]",
      "graph G {",
      "  /** lifecycle */",
      "  event OnAwake() {}",
      "  /** request */",
      "  event Request_Do() {}",
      "  /** invalid */",
      "  event Bad() {}",
      "}",
    ].join("\n");
    expect(rules(source)).toEqual(["event-name-prefix"]);
  });

  it("checks graph decorators and does not flag a decorated graph", () => {
    expect(rules("graph MissingPlatform {}\n")).toContain("graph-missing-platform");
    expect(rules("[platform_client]\ngraph ClientGraph {}\n")).not.toContain("graph-missing-platform");
  });

  it("reports grammar-invalid shape patterns", () => {
    const source = [
      "[platform_server]",
      "graph G {",
      "  Vector3(1, 2)",
      "  target.wait()",
      "  /** invalid parameter syntax */",
      "  func Bad(value: int) int {}",
      "}",
    ].join("\n");
    expect(rules(source)).toEqual(["no-constructor-call", "no-wait-dot", "ts-param-syntax"]);
  });

  it("uses the configured width and preserves document identity", () => {
    const source = "x = 123456789\n";
    expect(rules(source, { printWidth: 8 })).toEqual(["line-too-long"]);
    const document = itemize(tokenize(source));
    expect(lintDocument(document, source, { printWidth: 8 })).toEqual(lintSource(source, { printWidth: 8 }));
  });

  it("reports bracketSpacing mismatches with a single-char fix", () => {
    expect(rules("Vector3 {0}", { bracketSpacing: "none" })).toContain("bracket-spacing");
    expect(rules("Vector3{0}", { bracketSpacing: "none" })).not.toContain("bracket-spacing");
    expect(rules("Vector3{0}", { bracketSpacing: "space" })).toContain("bracket-spacing");
    expect(rules("Vector3 {0}", { bracketSpacing: "space" })).not.toContain("bracket-spacing");
    const d = lintSource("Vector3 {0}", { bracketSpacing: "none" }).find((x) => x.ruleId === "bracket-spacing")!;
    expect(d.fix).toMatchObject({ replacement: "" });
    // Block braces always require a space even when bracketSpacing is none
    expect(rules("func F(){}", { bracketSpacing: "none" })).toContain("bracket-spacing");
    expect(rules("func F() {}", { bracketSpacing: "none" })).not.toContain("bracket-spacing");
  });

  it("reports spaceInsideBrackets with precise ranges and skips multiline", () => {
    expect(rules("x = arr[ 0 ]", { spaceInsideBrackets: false })).toEqual(expect.arrayContaining(["space-inside-brackets"]));
    expect(rules("x = arr[0]", { spaceInsideBrackets: false })).not.toContain("space-inside-brackets");
    expect(rules("x = arr[0]", { spaceInsideBrackets: true })).toEqual(expect.arrayContaining(["space-inside-brackets"]));
    expect(rules("x = arr[ 0 ]", { spaceInsideBrackets: true })).not.toContain("space-inside-brackets");
    // Empty brackets are not flagged
    expect(rules("x = arr[]", { spaceInsideBrackets: true })).not.toContain("space-inside-brackets");
    // Multiline inside is skipped (newline is allowed)
    expect(rules("arr[\n 0\n]", { spaceInsideBrackets: true })).not.toContain("space-inside-brackets");
    const diags = lintSource("x = arr[ 0 ]", { spaceInsideBrackets: false });
    expect(diags.filter((d) => d.ruleId === "space-inside-brackets")).toHaveLength(2);
    expect(diags[0]!.fix).toMatchObject({ replacement: "" });
  });

  it("reports spaceInsideParens and spaceInsideBraces and preserves fix idempotency", () => {
    expect(rules("func F( a int ) int {}", { spaceInsideParens: false })).toContain("space-inside-parens");
    expect(rules("func F(a int) int {}", { spaceInsideParens: false })).not.toContain("space-inside-parens");
    expect(rules("func F(a int) int {}", { spaceInsideParens: true })).toContain("space-inside-parens");
    expect(rules("x = Com{ 1 }", { spaceInsideBraces: false })).toContain("space-inside-braces");
    expect(rules("x = Com{1}", { spaceInsideBraces: true })).toContain("space-inside-braces");
    expect(rules("x = Com{ 1 }", { spaceInsideBraces: true })).not.toContain("space-inside-braces");
    // Empty braces not flagged
    expect(rules("x = Com{}", { spaceInsideBraces: true })).not.toContain("space-inside-braces");
  });
});
