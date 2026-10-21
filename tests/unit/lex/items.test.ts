/**
 * @module lex/items.test - verifies trivia partitioning and lossless reconstruction.
 *
 * Checks `tokenize→itemize→reconstructDocument` round-trip, `before` ordering
 * for same-line/leading comments, blank-line retention, EOF-only trailing trivia,
 * and multiline block comment handling.
 */

import { describe, expect, it } from "vitest";
import { itemize, reconstructDocument } from "../../../src/lex/items.js";
import { tokenize } from "../../../src/lex/tokenizer.js";

describe("itemize", () => {
  it("partitions significant tokens without dropping trivia", () => {
    const source = "define x = 1";
    const document = itemize(tokenize(source));
    expect(document.items.map((item) => item.token.text)).toEqual(["define", "x", "=", "1"]);
    expect(reconstructDocument(document)).toBe(source);
  });

  it("retains a same-line comment in source order before the next token", () => {
    const source = "x // note\nnext";
    const document = itemize(tokenize(source));
    const next = document.items.find((item) => item.token.text === "next")!;
    expect(next.before.map((entry) => entry.token.text)).toEqual([" ", "// note", "\n"]);
    expect(next.before[1]!.kind).toBe("line-comment");
    expect(next.lineBreakBefore).toBe(true);
    expect(reconstructDocument(document)).toBe(source);
  });

  it("retains leading comments and physical blank lines", () => {
    const source = "// note\n\nvalue";
    const document = itemize(tokenize(source));
    const value = document.items[0]!;
    expect(value.before.map((entry) => entry.token.text)).toEqual(["// note", "\n\n"]);
    expect(value.lineBreakBefore).toBe(true);
    expect(reconstructDocument(document)).toBe(source);
  });

  it("retains EOF-only comments as document trailing trivia", () => {
    const source = "value\n// final note";
    const document = itemize(tokenize(source));
    expect(document.trailingTrivia.map((entry) => entry.token.text)).toEqual(["\n", "// final note"]);
    expect(reconstructDocument(document)).toBe(source);
  });

  it("retains multiline block comments and empty-file trivia", () => {
    const source = "\n/* one\ntwo */\n";
    const document = itemize(tokenize(source));
    expect(document.items).toHaveLength(0);
    expect(document.trailingTrivia).toHaveLength(3);
    expect(reconstructDocument(document)).toBe(source);
  });
});
