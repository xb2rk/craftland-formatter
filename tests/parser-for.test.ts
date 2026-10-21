import { describe, expect, it } from "vitest";
import { lex } from "../src/lex/lexer.js";
import { parseGraphFile } from "../src/parser/file-parser.js";
import type { FunctionDeclarationNode } from "../src/syntax/nodes.js";

describe("structured for-loop syntax", () => {
  it("retains index and range bindings as source-referential nodes", () => {
    const source = "graph Foo { func Run() { for i = 0, 3, 1 { break } for key, value in values { continue } } }";
    const result = parseGraphFile(lex(source));
    expect(result.diagnostics).toEqual([]);
    const fn = result.node?.graph?.members?.[0] as FunctionDeclarationNode | undefined;
    const statements = fn?.body?.statements ?? [];
    const indexLoop = statements[0];
    const rangeLoop = statements[1];
    expect(indexLoop?.kind).toBe("for-index-statement");
    if (indexLoop?.kind === "for-index-statement") {
      expect(indexLoop.binding?.text).toBe("i");
      expect(indexLoop.start?.kind).toBe("literal-expression");
      expect(indexLoop.end?.kind).toBe("literal-expression");
      expect(indexLoop.step?.kind).toBe("literal-expression");
    }
    expect(rangeLoop?.kind).toBe("for-range-statement");
    if (rangeLoop?.kind === "for-range-statement") {
      expect(rangeLoop.binding?.text).toBe("key");
      expect(rangeLoop.keyBinding?.text).toBe("value");
      expect(rangeLoop.iterable?.kind).toBe("name-expression");
    }
  });

  it("accepts parenthesized index and range headers", () => {
    const source = "graph Foo { func Run() { for (i = 0, 3, 1) { break } for (key, value in values) { continue } } }";
    const result = parseGraphFile(lex(source));
    expect(result.diagnostics).toEqual([]);
    const fn = result.node?.graph?.members?.[0] as FunctionDeclarationNode | undefined;
    const statements = fn?.body?.statements ?? [];
    const indexLoop = statements[0];
    const rangeLoop = statements[1];
    expect(indexLoop?.kind).toBe("for-index-statement");
    if (indexLoop?.kind === "for-index-statement") {
      expect(indexLoop.binding?.text).toBe("i");
      expect(indexLoop.leftParenTokenIndex).toEqual(expect.any(Number));
      expect(indexLoop.rightParenTokenIndex).toEqual(expect.any(Number));
    }
    expect(rangeLoop?.kind).toBe("for-range-statement");
    if (rangeLoop?.kind === "for-range-statement") {
      expect(rangeLoop.binding?.text).toBe("key");
      expect(rangeLoop.keyBinding?.text).toBe("value");
      expect(rangeLoop.iterable?.kind).toBe("name-expression");
      expect(rangeLoop.leftParenTokenIndex).toEqual(expect.any(Number));
      expect(rangeLoop.rightParenTokenIndex).toEqual(expect.any(Number));
    }
  });

  it("retains qualified event-name segments", () => {
    const result = parseGraphFile(lex("graph Foo { event Lifecycle.OnStarted() {} }"));
    expect(result.diagnostics).toEqual([]);
    const event = result.node?.graph?.members?.[0];
    expect(event?.kind).toBe("event-declaration");
    if (event?.kind === "event-declaration") {
      expect(event.name?.text).toBe("Lifecycle.OnStarted");
      expect(event.name?.segments.map((segment) => segment.text)).toEqual(["Lifecycle", "OnStarted"]);
    }
  });
});
