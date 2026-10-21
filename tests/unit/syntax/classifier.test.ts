/**
 * @module syntax/classifier.test - verifies delimiter-tree classification and query predicates.
 *
 * Covers nesting order preservation, block/map/struct/data discrimination,
 * direct separator search, malformed closer handling, statement-call detection,
 * and unary sign classification from the preceding item.
 */

import { describe, expect, it } from "vitest";
import { classify, DelimKind, isNode, type Node } from "../../../src/syntax/classifier.js";
import { itemize } from "../../../src/lex/items.js";
import { findTopLevelSeparator, isStatementCall, isUnary, splitSegments } from "../../../src/syntax/query.js";
import { tokenize } from "../../../src/lex/tokenizer.js";
import { TokenId } from "../../../src/lex/grammar.generated.js";

/**
 * Collect all nested delimiter nodes in source order.
 *
 * @param root - classified root.
 * @returns nested nodes.
 */
function nodesIn(root: Node): Node[] {
  return root.content.flatMap((entry) => (isNode(entry) ? [entry, ...nodesIn(entry)] : []));
}

/**
 * Classify a source string.
 *
 * @param source - FC source.
 * @returns classified root.
 */
function classified(source: string): Node {
  return classify(itemize(tokenize(source)));
}

describe("classifier", () => {
  it("keeps nested delimiters in exact source order", () => {
    const source = "func F() int { return Track(Vector3{1, 2, 3}) }";
    const root = classified(source);
    const block = nodesIn(root).find((node) => node.kind === DelimKind.Block)!;
    const call = nodesIn(block).find((node) => node.kind === DelimKind.Paren)!;
    const data = nodesIn(call).find((node) => node.kind === DelimKind.Data)!;
    expect(block.open?.token.text).toBe("{");
    expect(call.open?.token.text).toBe("(");
    expect(data.open?.token.text).toBe("{");
    expect(splitSegments(call)).toHaveLength(1);
    expect(data.content.map((entry) => (isNode(entry) ? entry.open?.token.text : entry.token.text))).toEqual([
      "1",
      ",",
      "2",
      ",",
      "3",
    ]);
  });

  it("distinguishes block, map, struct, and positional data braces", () => {
    const root = classified("if ready { value = Plan{ Source = Vector3{0, 0, 0}, } } Map<int,int>{ 1: 2 }");
    expect(nodesIn(root).map((node) => node.kind)).toEqual([
      DelimKind.Block,
      DelimKind.Struct,
      DelimKind.Data,
      DelimKind.Map,
    ]);
  });

  it("finds only direct separators and keeps malformed closers as items", () => {
    const root = classified("Map<int,int>{ key: List<int>{1, 2} }");
    const map = nodesIn(root).find((node) => node.kind === DelimKind.Map)!;
    expect(findTopLevelSeparator(map, TokenId.COLON)?.token.text).toBe(":");
    expect(splitSegments(map)).toHaveLength(1);
    const malformed = classified("}");
    expect(malformed.content).toHaveLength(1);
    expect(isNode(malformed.content[0]!)).toBe(false);
  });

  it("identifies standalone, wait, and start calls without treating declarations as calls", () => {
    const root = classified("func F() int { Foo(1) wait Bar(2) start Baz(3) }");
    const calls = nodesIn(root).filter((node) => node.kind === DelimKind.Paren);
    expect(calls.map(isStatementCall)).toEqual([false, true, true, true]);
  });

  it("classifies signs from their preceding item", () => {
    const document = itemize(tokenize("return -x + y"));
    const minus = document.items.find((item) => item.token.kind === TokenId.MINUS)!;
    const plus = document.items.find((item) => item.token.kind === TokenId.PLUS)!;
    expect(isUnary(document.items[document.items.indexOf(minus) - 1], minus)).toBe(true);
    expect(isUnary(document.items[document.items.indexOf(plus) - 1], plus)).toBe(false);
  });
});
