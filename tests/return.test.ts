import { describe, expect, it } from "vitest";
import { lex } from "../src/lex/lexer.js";
import { parseGraphFile } from "../src/parser/file-parser.js";
import type { FunctionDeclarationNode } from "../src/syntax/nodes.js";

describe("bare return before new statements", () => {
  it("does not parse a return value from statement-only keywords", () => {
    const source = "graph Foo { func Run() { Hide() return\nvar end int = NEXT\nHide() } }";
    const result = parseGraphFile(lex(source));
    expect(result.diagnostics).toEqual([]);
    const fn = result.node?.graph?.members?.[0] as FunctionDeclarationNode | undefined;
    const statements = fn?.body?.statements ?? [];
    expect(statements.map((statement) => statement.kind)).toEqual([
      "expression-statement",
      "return-statement",
      "variable-statement",
      "expression-statement",
    ]);
    const returned = statements[1];
    if (returned?.kind === "return-statement") expect(returned.expression).toBeUndefined();
    const declared = statements[2];
    if (declared?.kind === "variable-statement") {
      expect(declared.name?.text).toBe("end");
      expect(declared.value?.kind).toBe("name-expression");
    }
  });

  it("still parses return values", () => {
    const source = "graph Foo { func Run() int { return NEXT } }";
    const result = parseGraphFile(lex(source));
    expect(result.diagnostics).toEqual([]);
    const fn = result.node?.graph?.members?.[0] as FunctionDeclarationNode | undefined;
    const returned = fn?.body?.statements[0];
    expect(returned?.kind).toBe("return-statement");
    if (returned?.kind === "return-statement") expect(returned.expression?.kind).toBe("name-expression");
  });
});
