import { describe, expect, it } from "vitest";
import { lex } from "../../src/lex/lexer.js";
import { parseGraphFile } from "../../src/parser/file-parser.js";
import { parseExpression } from "../../src/parser/type-expression-parser.js";

/**
 * Qualified-name triage matrix. Multi-segment dotted names are a contract in
 * event names and struct-literal type heads; decorator names are
 * intentionally single-segment (fc-syntax.md shows only bracketed
 * identifiers such as [platform_client], never [A.B]).
 */
describe("qualified-name matrix", () => {
  it("accepts deeply qualified event names", () => {
    const result = parseGraphFile(lex("graph Foo { event A.B.C() {} }"));
    expect(result.diagnostics).toEqual([]);
    expect(result.consumedThroughEof).toBe(true);
    expect(result.node).toMatchObject({ kind: "graph-file" });
    const declaration = result.node?.graph?.members?.[0];
    expect(declaration).toMatchObject({
      kind: "event-declaration",
      name: {
        kind: "qualified-name",
        text: "A.B.C",
        segments: [{ text: "A" }, { text: "B" }, { text: "C" }],
      },
    });
  });

  it("accepts deeply qualified struct-literal type heads", () => {
    const result = parseExpression(lex("A.B.C{x = 1}"));
    expect(result.diagnostics).toEqual([]);
    expect(result.consumedThroughEof).toBe(true);
    expect(result.node).toMatchObject({
      kind: "struct-composite-expression",
      typeName: {
        kind: "qualified-name",
        text: "A.B.C",
        segments: [{ text: "A" }, { text: "B" }, { text: "C" }],
      },
    });
  });

  it("accepts qualified struct literals nested in field values", () => {
    const result = parseExpression(lex("Outer{child = Inner.Deep{x = 1}}"));
    expect(result.diagnostics).toEqual([]);
    expect(result.consumedThroughEof).toBe(true);
    expect(result.node).toMatchObject({
      kind: "struct-composite-expression",
      typeName: { text: "Outer" },
      fields: [{
        name: { text: "child" },
        value: {
          kind: "struct-composite-expression",
          typeName: { kind: "qualified-name", text: "Inner.Deep" },
        },
      }],
    });
  });

  it("keeps decorator names single-segment", () => {
    const result = parseGraphFile(lex("[platform_client] graph Foo {}"));
    expect(result.diagnostics).toEqual([]);
    expect(result.consumedThroughEof).toBe(true);
    expect(result.node?.graph).toMatchObject({
      kind: "graph-declaration",
      decorators: [{ kind: "decorator", name: { text: "platform_client" } }],
    });
  });

  it("rejects qualified decorator names", () => {
    const result = parseGraphFile(lex("[A.B] graph Foo {}"));
    expect(result.diagnostics.length).toBeGreaterThan(0);
  });
});
