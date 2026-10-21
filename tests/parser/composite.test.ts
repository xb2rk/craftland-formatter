import { describe, expect, it } from "vitest";
import { lex } from "../../src/lex/index.js";
import { parseExpression } from "../../src/parser/index.js";

describe("FC composite expression parser", () => {
  it("parses tagged and bare positional composites, including nested values", () => {
    const vector = parseExpression(lex("Vector3{0, -1, 2}"));
    expect(vector.diagnostics).toEqual([]);
    expect(vector.node).toMatchObject({
      kind: "positional-composite-expression",
      type: { type: { name: { text: "Vector3" } } },
      entries: [{ kind: "literal-expression" }, { kind: "unary-expression" }, { kind: "literal-expression" }],
    });

    const bare = parseExpression(lex("{1, List<int>{2}}"));
    expect(bare.diagnostics).toEqual([]);
    expect(bare.node).toMatchObject({
      kind: "positional-composite-expression",
      type: undefined,
      entries: [{ kind: "literal-expression" }, { kind: "positional-composite-expression" }],
    });
  });

  it("parses map and struct entries with exact separators and trailing commas", () => {
    const map = parseExpression(lex('Map<string, int>{"seed": List<object>{},}'));
    expect(map.diagnostics).toEqual([]);
    expect(map.node).toMatchObject({
      kind: "map-composite-expression",
      type: { type: { kind: "generic-type", constructorName: { text: "Map" } } },
      entries: [{ key: { kind: "literal-expression" }, value: { kind: "positional-composite-expression" } }],
      trailingCommaTokenIndex: expect.any(Number),
    });

    const struct = parseExpression(lex("SpawnInfo{position = Vector3{0, 0, 0}, yaw = 0,}"));
    expect(struct.diagnostics).toEqual([]);
    expect(struct.node).toMatchObject({
      kind: "struct-composite-expression",
      typeName: { text: "SpawnInfo" },
      fields: [{ name: { text: "position" } }, { name: { text: "yaw" } }],
      trailingCommaTokenIndex: expect.any(Number),
    });
  });

  it("parses qualified struct literals such as import-alias types", () => {
    const qualified = parseExpression(lex("CustomTuple.JsonDocument{Nodes = snapshot, RootIndex = 0}"));
    expect(qualified.diagnostics).toEqual([]);
    expect(qualified.consumedThroughEof).toBe(true);
    expect(qualified.node).toMatchObject({
      kind: "struct-composite-expression",
      typeName: {
        kind: "qualified-name",
        text: "CustomTuple.JsonDocument",
        segments: [{ text: "CustomTuple" }, { text: "JsonDocument" }],
      },
      fields: [{ name: { text: "Nodes" } }, { name: { text: "RootIndex" } }],
    });

    const empty = parseExpression(lex("CustomTuple.JsonDocument{}"));
    expect(empty.diagnostics).toEqual([]);
    expect(empty.consumedThroughEof).toBe(true);
    expect(empty.node).toMatchObject({
      kind: "struct-composite-expression",
      typeName: { text: "CustomTuple.JsonDocument" },
      fields: [],
    });
  });

  it("models LocString as its dedicated key-plus-list grammar", () => {
    const parsed = parseExpression(lex('LocString{"UI_KEY", List<object>{value}}'));
    expect(parsed.diagnostics).toEqual([]);
    expect(parsed.node).toMatchObject({
      kind: "loc-string-expression",
      key: { kind: "literal-expression" },
      arguments: {
        kind: "positional-composite-expression",
        type: { type: { kind: "generic-type", constructorName: { text: "List" } } },
      },
    });

    const missingArguments = parseExpression(lex('LocString{"UI_KEY"}'));
    expect(missingArguments.diagnostics.length).toBeGreaterThan(0);
    expect(missingArguments.consumedThroughEof).toBe(true);

    const mapArguments = parseExpression(lex('LocString{"UI_KEY", {"name": value}}'));
    expect(mapArguments.diagnostics.length).toBeGreaterThan(0);
    expect(mapArguments.consumedThroughEof).toBe(true);
  });

  it("does not invent an entity composite production", () => {
    const parsed = parseExpression(lex("entity<Player>{1}"));
    expect(parsed.diagnostics).toEqual([]);
    expect(parsed.node).toMatchObject({ kind: "binary-expression", operator: 81 });
  });

  it("requires named tuple composites to use field assignments", () => {
    const parsed = parseExpression(lex("SpawnInfo{1, 2}"));
    expect(parsed.diagnostics.length).toBeGreaterThan(0);
    expect(parsed.consumedThroughEof).toBe(true);
  });
});
