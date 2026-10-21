/**
 * @module lex/tokenizer.test - verifies the lossless scanner without parser EOS.
 *
 * Covers declarations/builtin types, string/rune literals, numeric families
 * (hex/bin/octal/float/imaginary), colors, longest-operator matching, comment/CRLF/Unicode
 * preservation, and half-open span/EOF sentinel invariants.
 */

import { describe, expect, it } from "vitest";
import { TokenId } from "../../../src/lex/grammar.generated.js";
import { isTrivia } from "../../../src/lex/grammar.js";
import { reconstructTokens } from "../../../src/lex/tokens.js";
import { tokenize } from "../../../src/lex/tokenizer.js";

/**
 * Non-trivial token kinds for a source (trivia + EOF removed).
 *
 * @param source - FC source.
 * @returns token kinds.
 */
function kinds(source: string): number[] {
  return tokenize(source).filter((token) => !isTrivia(token.kind) && token.kind !== TokenId.EOF).map((token) => token.kind);
}

describe("tokenize", () => {
  it("recognizes declarations, builtin types, and object", () => {
    expect(kinds("define value = List<object>{}")).toEqual([
      TokenId.DEFINE,
      TokenId.IDENTIFIER,
      TokenId.ASSIGN,
      TokenId.LIST,
      TokenId.LESS,
      TokenId.OBJECT,
      TokenId.GREATER,
      TokenId.L_CURLY,
      TokenId.R_CURLY,
    ]);
  });

  it("keeps raw, interpreted, and rune literals atomic", () => {
    expect(kinds("`first\nsecond` \"a\\\"b\" 'x'")).toEqual([
      TokenId.RAW_STRING_LIT,
      TokenId.INTERPRETED_STRING_LIT,
      TokenId.RUNE_LIT,
    ]);
  });

  it("recognizes numeric families, colors, and longest operators", () => {
    expect(kinds("0x1F 0b101 0o77 3.14 1e3 5i #FF00AA a <<= b && c")).toEqual([
      TokenId.HEX_LIT,
      TokenId.BINARY_LIT,
      TokenId.OCTAL_LIT,
      TokenId.FLOAT_LIT,
      TokenId.FLOAT_LIT,
      TokenId.IMAGINARY_LIT,
      TokenId.COLOR_HEX_LIT,
      TokenId.IDENTIFIER,
      TokenId.LSHIFT_ASSIGN,
      TokenId.IDENTIFIER,
      TokenId.LOGICAL_AND,
      TokenId.IDENTIFIER,
    ]);
  });

  it("preserves comments, CRLF, Unicode, and source text exactly", () => {
    const source = "// ghi chú\r\nname_é // inline\r\n/* block\ncomment */ `raw\ntext`";
    const tokens = tokenize(source);
    expect(reconstructTokens(tokens)).toBe(source);
    expect(tokens.some((token) => token.kind === TokenId.LINE_COMMENT)).toBe(true);
    expect(tokens.some((token) => token.kind === TokenId.COMMENT_NLSEMI)).toBe(true);
    expect(tokens.some((token) => token.kind === TokenId.EOS)).toBe(false);
  });

  it("uses half-open UTF-16 spans and a zero-width EOF sentinel", () => {
    const tokens = tokenize("a\nb");
    expect(tokens[0]!.span).toMatchObject({ start: { offset: 0, line: 1, column: 1 }, end: { offset: 1, line: 1, column: 2 } });
    const eof = tokens.at(-1)!;
    expect(eof.kind).toBe(TokenId.EOF);
    expect(eof.span.start).toEqual(eof.span.end);
    expect(eof.span.start).toMatchObject({ offset: 3, line: 2, column: 2 });
  });
});
