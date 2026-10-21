import { describe, expect, it } from "vitest";
import { TokenId } from "../../src/grammar/token-vocabulary.generated.js";
import { lex } from "../../src/lex/index.js";
import { parseDomainType, parseExpression } from "../../src/parser/index.js";

describe("FC type and expression parser", () => {
  it("parses nested generic types only in type position", () => {
    const parsed = parseDomainType(lex("Std.List<List<int>>"));
    expect(parsed.diagnostics).toEqual([]);
    expect(parsed.consumedThroughEof).toBe(true);
    expect(parsed.node).toMatchObject({
      kind: "domain-type",
      domain: { text: "Std" },
      type: {
        kind: "generic-type",
        constructorName: { text: "List" },
        arguments: [{ type: { kind: "generic-type", constructorName: { text: "List" } } }],
      },
    });

    const arbitrary = parseDomainType(lex("Foo<Bar>"));
    expect(arbitrary.node).toMatchObject({ kind: "domain-type", type: { kind: "scalar-type", name: { text: "Foo" } } });
    expect(arbitrary.diagnostics.map((diagnostic) => diagnostic.code)).toEqual([
      "unexpected-token",
      "unexpected-token",
      "unexpected-token",
    ]);
  });

  it("parses function-point types with typed parameters and a result", () => {
    const parsed = parseDomainType(lex("func(player entity<Player>, count int) bool"));
    expect(parsed.diagnostics).toEqual([]);
    expect(parsed.node).toMatchObject({
      type: {
        kind: "function-type",
        parameters: [{ name: { text: "player" } }, { name: { text: "count" } }],
        result: { type: { name: { text: "bool" } } },
      },
    });
  });

  it("parses function-point types with out var parameters", () => {
    const parsed = parseDomainType(lex("func(player entity<Player>, out var payload List<object>) int"));
    expect(parsed.diagnostics).toEqual([]);
    expect(parsed.consumedThroughEof).toBe(true);
    expect(parsed.node).toMatchObject({
      type: {
        kind: "function-type",
        parameters: [
          { name: { text: "player" }, outTokenIndex: undefined },
          { name: { text: "payload" }, outTokenIndex: expect.any(Number), varTokenIndex: expect.any(Number) },
        ],
        result: { type: { name: { text: "int" } } },
      },
    });

    const nested = parseDomainType(
      lex(
        "Map<int, func(player entity<Player>, itemId int, target List<object>, out var payload List<object>) int>",
      ),
    );
    expect(nested.diagnostics).toEqual([]);
    expect(nested.consumedThroughEof).toBe(true);
    expect(nested.node).toMatchObject({
      type: {
        kind: "generic-type",
        constructorName: { text: "Map" },
        arguments: [{}, { type: { kind: "function-type", parameters: [{}, {}, {}, { name: { text: "payload" } }] } }],
      },
    });
  });

  it.each([
    ["List", "List<int>", 1],
    ["Map", "Map<string, int>", 2],
    ["entity", "entity<Player>", 1],
  ])("parses %s generic type arity", (_name, source, argumentCount) => {
    const parsed = parseDomainType(lex(source));
    expect(parsed.diagnostics).toEqual([]);
    expect(parsed.node).toMatchObject({ type: { kind: "generic-type", arguments: expect.any(Array) } });
    expect((parsed.node?.type as { arguments: readonly unknown[] }).arguments).toHaveLength(argumentCount);
  });

  it("models precedence, casts, shifts, calls, members, indexes, and out vars structurally", () => {
    const precedence = parseExpression(lex("a < b || a >= c"));
    expect(precedence.diagnostics).toEqual([]);
    expect(precedence.node).toMatchObject({
      kind: "binary-expression",
      operator: TokenId.LOGICAL_OR,
      left: { kind: "binary-expression", operator: TokenId.LESS },
      right: { kind: "binary-expression", operator: TokenId.GREATER_OR_EQUALS },
    });

    const shift = parseExpression(lex("a >> b"));
    expect(shift.diagnostics).toEqual([]);
    expect(shift.node).toMatchObject({
      kind: "binary-expression",
      operator: TokenId.GREATER,
      operatorTokenIndices: expect.any(Array),
    });
    expect((shift.node as { operatorTokenIndices: readonly number[] }).operatorTokenIndices).toHaveLength(2);

    const call = parseExpression(lex("foo(1, out var result).bar[0] as List<int>"));
    expect(call.diagnostics).toEqual([]);
    expect(call.node).toMatchObject({
      kind: "cast-expression",
      expression: {
        kind: "index-expression",
        object: {
          kind: "member-expression",
          object: {
            kind: "call-expression",
            arguments: [{ kind: "literal-expression" }, { kind: "out-var-argument", name: { text: "result" } }],
          },
        },
      },
      type: { type: { kind: "generic-type", constructorName: { text: "List" } } },
    });
  });

  it("matches the extension's ambiguous generic-access and cast behavior", () => {
    const genericMember = parseExpression(lex("Foo<Bar>.Baz"));
    expect(genericMember.diagnostics).toEqual([]);
    expect(genericMember.node).toMatchObject({
      kind: "member-expression",
      object: { kind: "generic-access-expression" },
    });

    const relationalCall = parseExpression(lex("Foo<Bar>(x)"));
    expect(relationalCall.diagnostics).toEqual([]);
    expect(relationalCall.node).toMatchObject({ kind: "binary-expression", operator: TokenId.GREATER });

    const unaryCast = parseExpression(lex("-a as int"));
    expect(unaryCast.diagnostics).toEqual([]);
    expect(unaryCast.node).toMatchObject({ kind: "unary-expression", operand: { kind: "cast-expression" } });

    const castCall = parseExpression(lex("a as int()"));
    expect(castCall.diagnostics).toEqual([]);
    expect(castCall.node).toMatchObject({ kind: "call-expression", callee: { kind: "cast-expression" } });
  });

  it.each([
    ["logical or", "||", TokenId.LOGICAL_OR],
    ["logical and", "&&", TokenId.LOGICAL_AND],
    ["equal", "==", TokenId.EQUALS],
    ["not equal", "!=", TokenId.NOT_EQUALS],
    ["less", "<", TokenId.LESS],
    ["less or equal", "<=", TokenId.LESS_OR_EQUALS],
    ["greater", ">", TokenId.GREATER],
    ["greater or equal", ">=", TokenId.GREATER_OR_EQUALS],
    ["bitwise or", "|", TokenId.OR],
    ["bitwise xor", "^", TokenId.XOR],
    ["bitwise and", "&", TokenId.AND],
    ["add", "+", TokenId.PLUS],
    ["subtract", "-", TokenId.MINUS],
    ["multiply", "*", TokenId.STAR],
    ["divide", "/", TokenId.DIV],
    ["modulo", "%", TokenId.MOD],
  ])("parses %s as a binary operator", (_name, spelling, operator) => {
    const parsed = parseExpression(lex(`left ${spelling} right`));
    expect(parsed.diagnostics).toEqual([]);
    expect(parsed.node).toMatchObject({ kind: "binary-expression", operator });
  });

  it("keeps binary chains left-associative and gives cast its verified high binding", () => {
    const subtraction = parseExpression(lex("a - b - c"));
    expect(subtraction.diagnostics).toEqual([]);
    expect(subtraction.node).toMatchObject({
      kind: "binary-expression",
      operator: TokenId.MINUS,
      left: { kind: "binary-expression", operator: TokenId.MINUS },
    });

    const shift = parseExpression(lex("a >> b >> c"));
    expect(shift.diagnostics).toEqual([]);
    expect(shift.node).toMatchObject({
      kind: "binary-expression",
      operator: TokenId.GREATER,
      left: { kind: "binary-expression", operator: TokenId.GREATER },
    });

    const additiveCast = parseExpression(lex("a + b as int"));
    expect(additiveCast.diagnostics).toEqual([]);
    expect(additiveCast.node).toMatchObject({
      kind: "binary-expression",
      operator: TokenId.PLUS,
      right: { kind: "cast-expression" },
    });
  });

  it.each([
    ["true", "boolean"],
    ["nil", "nil"],
    ["123", "integer"],
    ["0b101", "integer"],
    ["0o17", "integer"],
    ["0xFF", "integer"],
    ["1.5", "float"],
    ["2i", "imaginary"],
    ["#aabbcc", "color"],
    ["'x'", "rune"],
    ["`raw`", "raw-string"],
    ['"text"', "string"],
  ])("parses %s as a protected %s literal", (source, literalKind) => {
    const parsed = parseExpression(lex(source));
    expect(parsed.diagnostics).toEqual([]);
    expect(parsed.node).toMatchObject({ kind: "literal-expression", literalKind });
  });

  it("keeps AST source ranges in UTF-16 token coordinates", () => {
    const parsed = parseExpression(lex("α + β"));
    expect(parsed.diagnostics).toEqual([]);
    expect(parsed.node).toMatchObject({
      range: { start: { offset: 0, line: 0, column: 0 }, end: { offset: 5, line: 0, column: 5 } },
      tokenRange: { start: 0, end: 5 },
    });
  });

  it("returns diagnostics and consumes input for incomplete syntax", () => {
    const parsed = parseExpression(lex("foo(1,"));
    expect(parsed.diagnostics.length).toBeGreaterThan(0);
    expect(parsed.consumedThroughEof).toBe(true);
  });
});
